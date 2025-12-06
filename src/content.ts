import LoggerCore from "@App/app/logger/core";
import type { Logger } from "@App/app/repo/logger";
import MessageWriter from "./app/logger/message_writer";
import { ExtensionMessage } from "@Packages/message/extension_message";
import { CustomEventMessage } from "@Packages/message/custom_event_message";
import { Server } from "@Packages/message/server";
import { ScriptExecutor } from "./app/service/content/script_executor";
import { randomMessageFlag } from "./pkg/utils/utils";
import type { Message } from "@Packages/message/types";
import { forwardMessage } from "@Packages/message/server";
import { makeBlobURL } from "@App/pkg/utils/utils";
import { RuntimeClient } from "@App/app/service/service_worker/client";
import type { TScriptInfo } from "@App/app/repo/scripts";
import type { GMInfoEnv } from "@App/app/service/content/types";

// 建立与service_worker页面的连接
// 发送给扩展service_worker的通信接口
const extMsgComm: Message = new ExtensionMessage(false);
// 初始化日志组件
const loggerCore = new LoggerCore({
  writer: new MessageWriter(extMsgComm, "serviceWorker/logger"),
  labels: { env: "content" },
});

loggerCore.logger().debug("content start");

const eventTargetMap = new Map();

let MessageFlag: string = "";

let currentEventTarget: EventTarget | null = null;

const getEventTargetByFlag = (flag: string) => {
  let evtTarget = eventTargetMap.get(flag);
  if (!evtTarget) {
    eventTargetMap.set(flag, (evtTarget = new EventTarget()));
  }
  return evtTarget;
};

let currentFlag = "";

const didSetupSet = new WeakSet();

// 运行在content页面的脚本
const contentScriptSet = new Set<string>();

const setupFn = (evtTarget: EventTarget, flag: string) => {
  const MessageFlag = flag;
  // 发送给inject的消息接口
  const msgInject = new CustomEventMessage(MessageFlag, true);

  // 监听来自inject的消息
  const server = new Server("content", [msgInject, scriptExecutorMsg]);

  listenContentMessage(evtTarget, "emitEvent", MessageFlag, (data) => {
    scriptExecutor.emitEvent(data);
  });
  listenContentMessage(evtTarget, "valueUpdate", MessageFlag, (data) => {
    scriptExecutor.valueUpdate(data);
  });
  server.on("logger", (data: Logger) => {
    LoggerCore.logger().log(data.level, data.message, data.label);
  });
  forwardMessage("serviceWorker", "script/isInstalled", server, msgInject);
  forwardMessage("serviceWorker", "runtime/gmApi", server, msgInject, forwardGMApi);

  listenContentMessage(
    evtTarget,
    "pageLoad",
    MessageFlag,
    (data: { contentScriptList: TScriptInfo[]; envInfo: GMInfoEnv }) => {
      const { contentScriptList, envInfo } = data;
      // 处理注入到content环境的脚本
      for (const script of contentScriptList) {
        contentScriptSet.add(script.uuid);
      }
      // 监听事件
      scriptExecutor.setEnvInfo(envInfo);
      // 启动脚本
      scriptExecutor.startScripts(contentScriptList);
    }
  );
};

const promiseEventTarget = new Promise<void>((resolve) => {
  performance.addEventListener("scriptcat-from-inject", (ev: Event) => {
    ev.preventDefault();
    if (ev instanceof CustomEvent) {
      const flag = ev.detail.runtimeInjectFlag;
      if (!flag) return;
      currentFlag = flag;
      const evtTarget = getEventTargetByFlag(flag);
      currentEventTarget = evtTarget;
      if (!didSetupSet.has(evtTarget)) {
        MessageFlag = flag;
        setupFn(evtTarget, flag);
      }
      const mEvt = new MouseEvent(`scriptcat-evttarget-${flag}`, {
        relatedTarget: evtTarget,
      });
      performance.dispatchEvent(mEvt);
      resolve();
    }
  });
});

const eventTargetOnReady = (callback: () => any) => {
  if (currentEventTarget) {
    callback();
  } else {
    promiseEventTarget.then(callback);
  }
};

performance.dispatchEvent(new CustomEvent("script-wait-resent"));

// 处理scriptExecutor
const scriptExecutorFlag = randomMessageFlag();
// 脚本执行器消息接口
const scriptExecutorMsg = new CustomEventMessage(scriptExecutorFlag, true);
const scriptExecutor = new ScriptExecutor(new CustomEventMessage(scriptExecutorFlag, false));

const listenContentMessage = (
  eventTarget: EventTarget,
  key: string,
  runtimeMessageFlag: string,
  callback: (data: any) => any
) => {
  eventTarget.addEventListener(`scriptcat-content-${key}`, (ev) => {
    if (ev instanceof CustomEvent) {
      const detail = ev.detail;
      if (detail && typeof detail === "object") {
        const { messageFlag, messageData } = detail;
        if (messageFlag !== runtimeMessageFlag) return;
        callback(messageData);
      }
    }
  });
};

const forwardGMApi = (data: { api: string; params: any; uuid: string }) => {
  // 拦截关注的api
  switch (data.api) {
    case "CAT_createBlobUrl": {
      const file = data.params[0] as File;
      const url = makeBlobURL({ blob: file, persistence: false }) as string;
      return url;
    }
    case "CAT_fetchBlob": {
      return fetch(data.params[0]).then((res) => res.blob());
    }
    case "CAT_fetchDocument": {
      return new Promise((resolve) => {
        const xhr = new XMLHttpRequest();
        xhr.responseType = "document";
        xhr.open("GET", data.params[0]);
        xhr.onload = () => {
          const nodeId = (this.senderToInject as CustomEventMessage).sendRelatedTarget(xhr.response);
          resolve(nodeId);
        };
        xhr.send();
      });
    }
    case "GM_addElement": {
      const [parentNodeId, tagName, tmpAttr] = data.params;
      let attr = { ...tmpAttr };
      let parentNode: EventTarget | undefined;
      // 判断是不是content脚本发过来的
      let msg: CustomEventMessage;
      if (contentScriptSet.has(data.uuid) || scriptExecutor.execMap.has(data.uuid)) {
        msg = scriptExecutorMsg;
      } else {
        msg = this.senderToInject;
      }
      if (parentNodeId) {
        parentNode = msg.getAndDelRelatedTarget(parentNodeId);
      }
      const el = <Element>document.createElement(tagName);

      let textContent = "";
      if (attr) {
        if (attr.textContent) {
          textContent = attr.textContent;
          delete attr.textContent;
        }
      } else {
        attr = {};
      }
      for (const key of Object.keys(attr)) {
        el.setAttribute(key, attr[key]);
      }
      if (textContent) {
        el.textContent = textContent;
      }
      (<Element>parentNode || document.head || document.body || document.querySelector("*")).appendChild(el);
      const nodeId = msg.sendRelatedTarget(el);
      return nodeId;
    }
    case "GM_log":
      // 拦截GM_log，打印到控制台
      // 由于某些页面会处理掉console.log，所以丢到这里来打印
      switch (data.params.length) {
        case 1:
          console.log(data.params[0]);
          break;
        case 2:
          console.log("[" + data.params[1] + "]", data.params[0]);
          break;
        case 3:
          console.log("[" + data.params[1] + "]", data.params[0], data.params[2]);
          break;
      }
      break;
  }
  return false;
};

chrome.storage.session.onChanged.addListener((changes: Record<string, chrome.storage.StorageChange>) => {
  const keys = Object.keys(changes);
  for (const key of keys) {
    const messagePayload = changes[key]?.newValue;
    if (!messagePayload) continue;
    if (!currentFlag) continue;
    const eventTarget = getEventTargetByFlag(currentFlag);
    eventTarget.dispatchEvent(
      new CustomEvent(`scriptcat-content-${key}`, {
        detail: {
          messageFlag: currentFlag,
          messageData: messagePayload.data,
        },
      })
    );
  }
});

const client = new RuntimeClient(extMsgComm);
// 向service_worker请求脚本列表及环境信息
client.pageLoad().then((o) => {
  if (!o.ok) return;
  const { injectScriptList, contentScriptList, envInfo } = o;
  eventTargetOnReady(() => {
    if (!MessageFlag || !currentEventTarget) return;
    const data = { injectScriptList, contentScriptList, envInfo };
    const key = "pageLoad";
    // 页面加载，注入脚本
    currentEventTarget.dispatchEvent(
      new CustomEvent(`scriptcat-content-${key}`, {
        detail: {
          messageFlag: MessageFlag,
          messageData: data,
        },
      })
    );
  });
});

eventTargetOnReady(() => {
  if (!MessageFlag || !currentEventTarget) return;
  scriptExecutor.checkEarlyStartScript("content", MessageFlag);
});
