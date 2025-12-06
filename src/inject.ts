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

/* global MessageFlag  */

const msg: Message = new CustomEventMessage(MessageFlag, false);
const scriptExecutor = new ScriptExecutor(msg);

const listenContentMessage = (key: string, runtimeMessageFlag: string, callback: (data: any) => any) => {
  performance.addEventListener(`scriptcat-content-${key}`, (ev) => {
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

listenContentMessage("emitEvent", MessageFlag, (data: EmitEventRequest) => {
  // 转发给脚本
  scriptExecutor.emitEvent(data);
});
listenContentMessage("valueUpdate", MessageFlag, (data: ValueUpdateDataEncoded) => {
  // 转发给脚本
  scriptExecutor.valueUpdate(data);
});

listenContentMessage("pageLoad", MessageFlag, (data: { injectScriptList: TScriptInfo[]; envInfo: GMInfoEnv }) => {
  logger.logger().debug("inject start");
  // 监听事件
  scriptExecutor.setEnvInfo(data.envInfo);
  scriptExecutor.startScripts(data.injectScriptList);
  setupExternalMessage();
});

// 检查early-start的脚本
scriptExecutor.checkEarlyStartScript("inject", MessageFlag);
