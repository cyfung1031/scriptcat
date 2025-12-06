import LoggerCore from "@App/app/logger/core";
import MessageWriter from "@App/app/logger/message_writer";
import { CustomEventMessage } from "@Packages/message/custom_event_message";
import type { TScriptInfo } from "@App/app/repo/scripts";
import type { GMInfoEnv, ValueUpdateDataEncoded } from "./app/service/content/types";
import { ScriptExecutor } from "./app/service/content/script_executor";
import type { Message } from "@Packages/message/types";
import { ExternalWhitelist } from "@App/app/const";
import { sendMessage } from "@Packages/message/client";
import type { EmitEventRequest } from "@App/app/service/service_worker/types";
import { DefinedFlags } from "./app/service/service_worker/runtime.consts";

/* global MessageFlag  */

let eventTarget: EventTarget | null = null;

const promiseEventTarget = new Promise<void>((resolve) => {
  performance.addEventListener(`script-eventtarget-${MessageFlag}`, (ev: Event) => {
    if (ev instanceof MouseEvent) {
      eventTarget = ev.relatedTarget;
      resolve();
    }
  });
});

const eventTargetOnReady = (callback: () => any) => {
  if (eventTarget) {
    callback();
  } else {
    promiseEventTarget.then(callback);
  }
};

let emitMessage: ((retry: boolean) => void) | null = (retry: boolean) => {
  const resContent = performance.dispatchEvent(
    new CustomEvent("scriptcat-from-inject", {
      detail: {
        runtimeInjectFlag: MessageFlag,
      },
      cancelable: true,
    })
  );
  if (retry && resContent === true) {
    performance.addEventListener(
      "script-wait-resent",
      () => {
        emitMessage?.(false);
      },
      { once: true }
    );
  } else {
    emitMessage = null;
  }
};
emitMessage(true);

performance.dispatchEvent(
  new CustomEvent("scriptcat-listen-inject", {
    detail: {
      runtimeInjectFlag: MessageFlag,
    },
  })
);

const msg: Message = new CustomEventMessage(MessageFlag, false);
const scriptExecutor = new ScriptExecutor(msg);

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

const setupExternalMessage = () => {
  // 对外接口白名单
  const hostname = window.location.hostname;
  if (
    ExternalWhitelist.some(
      // 如果当前页面的 hostname 是白名单的网域或其子网域
      (t) => hostname.endsWith(t) && (hostname.length === t.length || hostname.endsWith(`.${t}`))
    )
  ) {
    // 注入
    const external: External = window.external || (window.external = {} as External);
    const scriptExpose: App.ExternalScriptCat = {
      isInstalled(name: string, namespace: string, callback: (res: App.IsInstalledResponse | undefined) => unknown) {
        sendMessage<App.IsInstalledResponse>(msg, "content/script/isInstalled", {
          name,
          namespace,
        }).then(callback);
      },
    };
    try {
      external.Scriptcat = scriptExpose;
    } catch {
      // 无法注入到 external，忽略
    }
    const exposedTM = external.Tampermonkey;
    const isInstalledTM = exposedTM?.isInstalled;
    const isInstalledSC = scriptExpose.isInstalled;
    if (isInstalledTM && exposedTM?.getVersion && exposedTM.openOptions) {
      // 当TM和SC同时启动的特殊处理：如TM没有安装，则查SC的安装状态
      try {
        exposedTM.isInstalled = (
          name: string,
          namespace: string,
          callback: (res: App.IsInstalledResponse | undefined) => unknown
        ) => {
          isInstalledTM(name, namespace, (res) => {
            if (res?.installed) callback(res);
            else
              isInstalledSC(name, namespace, (res) => {
                callback(res);
              });
          });
        };
      } catch {
        // 忽略错误
      }
    } else {
      try {
        external.Tampermonkey = scriptExpose;
      } catch {
        // 无法注入到 external，忽略
      }
    }
  }
};

// 加载logger组件
const logger = new LoggerCore({
  writer: new MessageWriter(msg, "content/logger"),
  consoleLevel: "none", // 只让日志在content环境中打印
  labels: { env: "inject", href: window.location.href },
});

type PageLoadData = { injectScriptList: TScriptInfo[]; envInfo: GMInfoEnv };

const promiseOnPageLoad = new Promise<PageLoadData>((resolve) => {
  eventTargetOnReady(() => {
    const evtTarget = eventTarget!;
    listenContentMessage(evtTarget, "emitEvent", MessageFlag, (data: EmitEventRequest) => {
      // 转发给脚本
      scriptExecutor.emitEvent(data);
    });
    listenContentMessage(evtTarget, "valueUpdate", MessageFlag, (data: ValueUpdateDataEncoded) => {
      // 转发给脚本
      scriptExecutor.valueUpdate(data);
    });

    listenContentMessage(evtTarget, "pageLoad", MessageFlag, (data: PageLoadData) => {
      logger.logger().debug("inject start");
      resolve(data);
    });
  });
});

// 检查early-start的脚本
scriptExecutor.checkEarlyStartScript("inject", MessageFlag);

const helperFn = (messageFlag: string, isContent: boolean) => {
  const eventNamePrefix = `evt${messageFlag}${isContent ? DefinedFlags.contentFlag : DefinedFlags.injectFlag}`;
  const scriptLoadCompleteEvtName = `${eventNamePrefix}${DefinedFlags.scriptLoadComplete}`;
  const envLoadCompleteEvtName = `${eventNamePrefix}${DefinedFlags.envLoadComplete}`;
  // 监听 脚本加载
  // 适用于此「通知环境加载完成」代码执行后的脚本加载
  performance.addEventListener(scriptLoadCompleteEvtName, (ev) => {
    const detail = (ev as CustomEvent).detail;
    const scriptFlag = detail?.scriptFlag;
    if (typeof scriptFlag === "string") {
      ev.preventDefault(); // dispatchEvent 会回传 false -> 分离环境也能得知环境加载代码已执行
      if (!isContent) {
        if (detail.scriptInfo) {
          scriptExecutor.execEarlyScript(scriptFlag, detail.scriptInfo);
        } else {
          promiseOnPageLoad.then((data: PageLoadData) => {
            // 监听事件
            scriptExecutor.setEnvInfo(data.envInfo);
            scriptExecutor.startScripts(data.injectScriptList);
            setupExternalMessage();
          });
        }
      } else {
        eventTargetOnReady(() => {


        if (detail.scriptInfo) {
          scriptExecutor.execEarlyScript(scriptFlag, detail.scriptInfo);
        } else {
          promiseOnPageLoad.then((data: PageLoadData) => {
            // 监听事件
            scriptExecutor.setEnvInfo(data.envInfo);
            scriptExecutor.startScripts(data.injectScriptList);
            setupExternalMessage();
          });
        }

          eventTarget!.dispatchEvent(new CustomEvent("pageLoad", {
            detail: {
              data: data,
            },
          }));
        });
      }
    }
  });
  // 通知 环境 加载完成
  // 适用于此「通知环境加载完成」代码执行前的脚本加载
  const ev = new CustomEvent(envLoadCompleteEvtName);
  performance.dispatchEvent(ev);
};

helperFn(MessageFlag, true);
helperFn(MessageFlag, false);
