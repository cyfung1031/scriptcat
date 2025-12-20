import LoggerCore from "@App/app/logger/core";
import type Logger from "@App/app/logger/logger";
import { type Script, type SCRIPT_STATUS, ScriptDAO } from "@App/app/repo/scripts";
import { type Value, ValueDAO } from "@App/app/repo/value";
import type { IGetSender, Group } from "@Packages/message/server";
import { type RuntimeService } from "./runtime";
import { type PopupService } from "./popup";
import { aNow, type Deferred, deferred, getStorageName } from "@App/pkg/utils/utils";
import type {
  ValueUpdateDataEncoded,
  ValueUpdateDataREntry,
  ValueUpdateSendData,
  ValueUpdateSender,
} from "../content/types";
import type { TScriptValueUpdate } from "../queue";
import { type TDeleteScript } from "../queue";
import { type IMessageQueue } from "@Packages/message/message_queue";
import { CACHE_KEY_SET_VALUE } from "@App/app/cache_key";
import { stackAsyncTask } from "@App/pkg/utils/async_queue";
import type { TKeyValuePair } from "@App/pkg/utils/message_value";
import { decodeRValue, R_UNDEFINED, encodeRValue } from "@App/pkg/utils/message_value";
import { isEarlyStartScript } from "../content/utils";

type TUpdateParams = {
  uuid: string;
  isReplace: boolean;
  keyValuePairs: TKeyValuePair[];
};

type TOtherUpdateParams = {
  id: string;
  ts: number;
  valueSender: ValueUpdateSender;
};

type ValueUpdateTaskInfo = TUpdateParams &
  TOtherUpdateParams & {
    status: SCRIPT_STATUS;
    isEarlyStart: boolean;
  };
const valueUpdateTasks = new Map<string, ValueUpdateTaskInfo[]>();

export type TSetValuesParams = TUpdateParams & Partial<TOtherUpdateParams>;

const atomicLocks = new Map<string, { taskId: string; nextAtomicTaskId?: string; deferred?: Deferred<void> }>();
const valueFns = new Map<string, any>();

export class ValueService {
  logger: Logger;
  scriptDAO: ScriptDAO = new ScriptDAO();
  valueDAO: ValueDAO = new ValueDAO();
  private popup: PopupService | undefined;
  private runtime: RuntimeService | undefined;

  constructor(
    private group: Group,
    private mq: IMessageQueue
  ) {
    this.logger = LoggerCore.logger().with({ service: "value" });
    this.valueDAO.enableCache();
  }

  async getScriptValueDetails(script: Script) {
    let data: { [key: string]: any } = {};
    const ret = await this.valueDAO.get(getStorageName(script));
    if (ret) {
      data = ret.data;
    }
    const newValues = data;
    // 和userconfig组装
    const { config } = script;
    if (config) {
      for (const tabKey of Object.keys(config)) {
        const tab = config![tabKey];
        if (!(tab instanceof Object)) {
          continue;
        }
        for (const key of Object.keys(tab)) {
          if (!tab[key]) {
            continue;
          }
          // 动态变量
          if (tab[key].bind) {
            const bindKey = tab[key].bind!.substring(1);
            newValues[bindKey] = data[bindKey] === undefined ? undefined : data[bindKey];
          }
          newValues[`${tabKey}.${key}`] =
            data[`${tabKey}.${key}`] === undefined ? tab[key].default : data[`${tabKey}.${key}`];
        }
      }
    }
    return [newValues, ret] as const;
  }

  getScriptValue(script: Script): Promise<Record<string, any>> {
    return this.getScriptValueDetails(script).then((res) => res[0]);
  }

  async waitForFreshValueState(uuid: string, id: string, valueSender: ValueUpdateSender): Promise<number> {
    if (id) {
      await this.setValues({ uuid, id, keyValuePairs: [], valueSender, isReplace: false });
    }
    // 查询出脚本
    const script = await this.scriptDAO.get(uuid);
    if (!script) {
      throw new Error("script not found");
    }
    // 查询老的值
    const storageName = getStorageName(script);
    // 使用事务来保证数据一致性
    const cacheKey = `${CACHE_KEY_SET_VALUE}${storageName}`;
    const ret = await stackAsyncTask<number | undefined>(cacheKey, async () => {
      const valueModel: Value | undefined = await this.valueDAO.get(storageName);
      return valueModel?.updatetime;
    });
    return ret || 0;
  }

  // 推送值到tab
  async pushValueToTab<T extends Record<string, ValueUpdateDataEncoded[]>>(storageName: string, data: T) {
    const sendData: ValueUpdateSendData = { storageName, data };
    /*
    --- data structure ---
    {
      storageName: XXXX
      {
        uuid1: data1
        uuid2: data2
        ...
      }
    }
    */
    chrome.tabs.query({}, (tabs) => {
      const lastError = chrome.runtime.lastError;
      if (lastError) {
        console.error("chrome.runtime.lastError in chrome.tabs.query:", lastError);
        // 没有 tabs 资讯，无法发推送到 tabs
        return;
      }
      // 推送到所有加载了本脚本的tab中
      for (const tab of tabs) {
        const tabId = tab.id;
        if (tab.discarded || !tabId) continue;
        this.popup!.getScriptMenu(tabId).then((scriptMenu) => {
          if (scriptMenu.find((item) => item.storageName === storageName)) {
            this.runtime!.sendMessageToTab(
              {
                tabId,
              },
              "valueUpdate",
              sendData
            );
          }
        });
      }
    });
    // 推送到offscreen中
    this.runtime!.sendMessageToTab(
      {
        tabId: -1,
      },
      "valueUpdate",
      sendData
    );
  }

  setupAtomicLock(lockId: string, taskId: string, nextAtomicTaskId?: string) {
    const pStart = deferred();
    const pEndPromise = stackAsyncTask(lockId, () => {
      const m = deferred<void>();
      atomicLocks.set(lockId, { taskId: taskId, deferred: m, nextAtomicTaskId });
      pStart.resolve();
      return m.promise;
    });
    return {
      start: pStart.promise,
      end: pEndPromise,
    };
  }

  setupValueFn(valueId: string, valueFn: (prevValue: any) => any) {
    valueFns.set(valueId, valueFn);
  }

  async setValuesByStorageName(storageName: string) {
    const taskListRef = valueUpdateTasks.get(storageName);
    if (!taskListRef?.length) return;
    let valueModel: Value | undefined = await this.valueDAO.get(storageName);
    const taskList = taskListRef.slice(0);
    taskListRef.length = 0;
    valueUpdateTasks.delete(storageName);
    // ------ 读取 & 更新 ------
    let updatetime = 0;
    const listRetToTab: Record<string, ValueUpdateDataEncoded[]> = {};
    let valueModelUpdated = false;
    let hasValueUpdated = false;
    for (const task of taskList) {
      const entries = [] as ValueUpdateDataREntry[];
      const { uuid, isReplace, ts, keyValuePairs } = task;
      let oldValueRecord: { [key: string]: any } = {};
      const now = aNow(); // 保证严格递增
      let newData;
      let changed = false;
      let checkReplacement = false;
      let dataModel: { [key: string]: any };
      if (!valueModel) {
        dataModel = {};
        valueModel = {
          uuid: uuid,
          storageName: storageName,
          data: dataModel,
          createtime: ts ? Math.min(ts, now) : now,
          updatetime: ts ? Math.min(ts, now) : now,
        };
        // 即使是空 dataModel 也进行更新
        // 由于没entries, valueUpdated 是 false, 但 valueDAO 会有一个空的 valueModel 记录 updatetime
        changed = true;
      } else {
        oldValueRecord = valueModel.data;
        dataModel = { ...oldValueRecord };
        checkReplacement = isReplace;
      }
      const containedKeys = checkReplacement ? new Set<string>() : undefined;
      for (const pair of keyValuePairs) {
        const key = pair[0];
        let rTyped1 = pair[1];
        containedKeys?.add(key);
        const atomicLockId = `${storageName}::${key}`;
        const currentAtomicLock = atomicLocks.get(atomicLockId);
        if (currentAtomicLock && currentAtomicLock.taskId !== task.id) {
          // atomic 值更新期間忽略所有寫入該 key 的處理
        } else {
          const oldValue = dataModel[key];
          let value = decodeRValue(rTyped1);
          if (typeof value === "string" && valueFns.has(value)) {
            let v = valueFns.get(value);
            valueFns.delete(value);
            if (typeof v === "function") v = v(oldValue);
            value = v;
            rTyped1 = encodeRValue(value);
          }
          if (value !== oldValue) {
            changed = true;
            if (value === undefined) {
              delete dataModel[key];
            } else {
              dataModel[key] = value;
            }
            const rTyped2 = encodeRValue(oldValue);
            entries.push([key, rTyped1, rTyped2]);
          }
          if (currentAtomicLock) {
            if (currentAtomicLock.nextAtomicTaskId) {
              currentAtomicLock.taskId = currentAtomicLock.nextAtomicTaskId;
              currentAtomicLock.nextAtomicTaskId = undefined;
            } else {
              atomicLocks.delete(atomicLockId);
              currentAtomicLock.deferred?.resolve();
            }
          }
        }
      }
      if (checkReplacement) {
        // 处理oldValue有但是没有在data.values中的情况
        for (const key of Object.keys(oldValueRecord)) {
          if (!containedKeys!.has(key)) {
            changed = true;
            const oldValue = oldValueRecord[key];
            delete dataModel[key]; // 这里使用delete是因为保存不需要这个字段了
            const rTyped2 = encodeRValue(oldValue);
            entries.push([key, R_UNDEFINED, rTyped2]);
          }
        }
      }
      if (changed) {
        newData = dataModel;
      }
      if (newData) {
        valueModel.updatetime = now;
        valueModel.data = newData; // 每次储存使用新参考
        valueModelUpdated = true;
      }
      updatetime = valueModel.updatetime;

      {
        const { uuid, id, valueSender } = task;
        let list = listRetToTab[uuid];
        if (!list) {
          listRetToTab[uuid] = list = [];
        }
        const valueUpdated = entries.length > 0;
        if (valueUpdated) hasValueUpdated = true;
        list.push({
          id,
          entries: entries,
          uuid,
          storageName,
          sender: valueSender,
          updatetime,
        } as ValueUpdateDataEncoded);
      }
    }
    if (valueModelUpdated) {
      await this.valueDAO.save(storageName, valueModel!);
    }
    // ------ 推送 ------
    // 推送到所有加载了本脚本的tab中
    this.pushValueToTab(storageName, listRetToTab);
    // 针对各脚本，只需要发送一次最后的结果
    const valueUpdateEmits = new Map<string, { status: SCRIPT_STATUS; isEarlyStart: boolean }>();
    for (const task of taskList) {
      const { uuid, status, isEarlyStart } = task;
      valueUpdateEmits.set(uuid, { status, isEarlyStart });
    }
    for (const [uuid, { status, isEarlyStart }] of valueUpdateEmits.entries()) {
      // valueUpdate 消息用于 early script 的处理
      // 由于经过 await, 此处的 status 和 isEarlyStart 只供参考，应在接收端检查最新设置值
      this.mq.emit<TScriptValueUpdate>("valueUpdate", {
        uuid,
        valueUpdated: hasValueUpdated,
        status,
        isEarlyStart,
      });
    }
  }

  // 批量设置
  async setValues(params: TSetValuesParams): Promise<void> {
    // stackAsyncTask 确保 setValues的 taskList阵列新增次序正确
    let storageName: string;
    let cacheKey: string;
    const { uuid, keyValuePairs, isReplace } = params;
    const id = params.id || "";
    const ts = params.ts || 0;
    const valueSender = params.valueSender || {
      runFlag: "user",
      tabId: -2,
    };
    await stackAsyncTask<void>("valueChangeOnSequence", async () => {
      // 查询出脚本
      const script = await this.scriptDAO.get(uuid);
      if (!script) {
        throw new Error("script not found");
      }
      storageName = getStorageName(script);
      cacheKey = `${CACHE_KEY_SET_VALUE}${storageName}`;
      let taskList = valueUpdateTasks.get(storageName);
      if (!taskList) {
        valueUpdateTasks.set(storageName, (taskList = []));
      }
      taskList.push({
        uuid,
        id,
        keyValuePairs,
        valueSender,
        isReplace,
        ts,
        status: script.status,
        isEarlyStart: isEarlyStartScript(script.metadata),
      } as ValueUpdateTaskInfo);
    });
    // valueDAO 次序依 storageName
    await stackAsyncTask<void>(cacheKey!, () => this.setValuesByStorageName(storageName!));
  }

  setScriptValues(params: TSetValuesParams, _sender: IGetSender) {
    return this.setValues(params);
  }

  init(runtime: RuntimeService, popup: PopupService) {
    this.popup = popup;
    this.runtime = runtime;
    this.group.on("getScriptValue", this.getScriptValue.bind(this));
    this.group.on("setScriptValues", this.setScriptValues.bind(this));

    this.mq.subscribe<TDeleteScript[]>("deleteScripts", async (data) => {
      for (const { storageName } of data) {
        // 判断还有没有其他同名storageName
        const list = await this.scriptDAO.find((_, script) => {
          return getStorageName(script) === storageName;
        });
        if (list.length === 0) {
          this.valueDAO.delete(storageName).then(() => {
            this.logger.trace("delete value", { storageName });
          });
        }
      }
    });
  }
}
