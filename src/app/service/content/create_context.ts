import { type ScriptRunResource } from "@App/app/repo/scripts";
import { v4 as uuidv4 } from "uuid";
import type { Message } from "@Packages/message/types";
import EventEmitter from "eventemitter3";
import { GMContextApiGet, protect } from "./gm_context";
import { GM_Base } from "./gm_api";

// 构建沙盒上下文
export function createContext(scriptRes: ScriptRunResource, GMInfo: any, envPrefix: string, message: Message): GM_Base {
  // 按照GMApi构建
  const valueChangeListener = new Map<number, { name: string; listener: GMTypes.ValueChangeListener }>();
  const EE: EventEmitter = new EventEmitter();
  const context = GM_Base.create({
    prefix: envPrefix,
    message,
    scriptRes,
    valueChangeListener,
    EE,
    runFlag: uuidv4(),
    eventId: 10000,
    GM: { info: GMInfo },
    GM_info: GMInfo,
    window: {
      onurlchange: null,
    },
    protect,
    __methodInject__(grant: string): boolean {
      const grantSet = this.grantSet || (this.grantSet = new Set());
      const s = GMContextApiGet(grant);
      if (!s) return false;
      if (grantSet.has(grant)) return true;
      grantSet.add(grant);
      for (const t of s) {
        const fnKeyArray = t.fnKey.split('.');
        const m = fnKeyArray.length - 1;
        let g = context;
        for (let i = 0; i < m; i++) {
          const part = fnKeyArray[i];
          g = g[part] || (g[part] = {});
        }
        const finalPart = fnKeyArray[m];
        if (g[finalPart]) continue;
        g[finalPart] = t.api.bind(this);
        const depend = t?.param?.depend;
        if (depend) {
          for (const grant of depend) {
            this.__methodInject__(grant);
          }
        }
      }
      return true;
    }
  });
  if (scriptRes.metadata.grant) {
    // 处理GM.与GM_，将GM_与GM.都复制一份
    const grant: string[] = [];
    scriptRes.metadata.grant.forEach((val) => {
      if (val.startsWith("GM_")) {
        const t = val.slice(3);
        grant.push(`GM.${t}`);
      } else if (val.startsWith("GM.")) {
        grant.push(val);
      }
      grant.push(val);
    });
    // 去重
    const uniqueGrant = new Set(grant);
    for(const grant of uniqueGrant){
      context.__methodInject__(grant);
    }
  }
  context.unsafeWindow = window;
  return <GM_Base>context;
}
