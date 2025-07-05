import MessageContent from "./app/message/content";
import InjectRuntime from "./runtime/content/inject";

// 通过flag与content建立通讯,这个ScriptFlag是后端注入时候生成的
// eslint-disable-next-line no-undef
const flag = ScriptFlag;

const message = new MessageContent(flag, false);

message.setHandler("pageLoad", (_action, data) => {
  const runtime = new InjectRuntime(message, data.scripts, flag);
  runtime.start();
});
