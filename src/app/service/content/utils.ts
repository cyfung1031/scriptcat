import type { ScriptRunResource } from "@App/app/repo/scripts";

import type { ScriptFunc } from "./types";
import { protect } from "./gm_context";

// undefined 和 null 以外，使用 hasOwnProperty 检查
// 不使用 != 避免类型转换比较
const has = (object: any, key: any) => {
  switch (object) {
    case undefined:
    case null:
      return false;
    default:
      return Object.prototype.hasOwnProperty.call(object, key);
  }
}

// 构建脚本运行代码
/**
 * @see {@link ExecScript}
 * @param scriptRes 
 * @param scriptCode 
 * @returns 
 */
export function compileScriptCode(scriptRes: ScriptRunResource, scriptCode?: string): string {
  scriptCode = scriptCode ?? scriptRes.code;
  let requireCode = "";
  if (Array.isArray(scriptRes.metadata.require)) {
    requireCode += scriptRes.metadata.require
      .map((val) => {
        const res = scriptRes.resource[val];
        if (res) {
          return res.content;
        }
      })
      .join("\n");
  }
  const sourceURL = `//# sourceURL=${chrome.runtime.getURL(`/${encodeURI(scriptRes.name)}.user.js`)}`;
  const preCode = [requireCode].join("\n"); // 不需要 async 封装
  const code = [scriptCode, sourceURL].join("\n"); // 需要 async 封裝
  // context 和 name 以unnamed arguments方式导入。避免代码能直接以变量名存取
  // arguments = [context: globalThis, scriptName: string, errorHandling: function]
//   const onErrorCode = `arguments[2] = (e) => {
//   if (e.message && e.stack) {
//       const n = arguments[1];
//       console.error("ERROR: Execution of script '" + n + "' failed! " + e.message);
//       console.log(e.stack);
//   } else {
//       console.error(e);
//   }
// };`
//   return `${onErrorCode}
// try {
//   with(arguments[0]){
//     ${preCode}
//     [((async function(){
//     ${code}
//     })().catch(arguments[2]),0)];
//   }
// } catch (e) {
//   arguments[2](e);
// }`;
  return `with(arguments[0]){
${preCode}
[((async function(){
${code}
})(),0)];
}`;
}

// 通过脚本代码编译脚本函数
export function compileScript(code: string): ScriptFunc {
  return <ScriptFunc>new Function(code);
}
/**
 * 将脚本函数编译为注入脚本代码
 * @param script
 * @param scriptCode
 * @param [autoDeleteMountFunction=false] 是否自动删除挂载的函数
 */
export function compileInjectScript(
  script: ScriptRunResource,
  scriptCode?: string,
  autoDeleteMountFunction: boolean = false
): string {
  scriptCode = scriptCode ?? script.code;
  const autoDeleteMountCode = autoDeleteMountFunction ? `try{delete window['${script.flag}']}catch(e){}` : "";
  return `window['${script.flag}'] = function(){${autoDeleteMountCode}${scriptCode}}`;
}

export const writables: { [key: string]: any } = {
  addEventListener: global.addEventListener.bind(global),
  removeEventListener: global.removeEventListener.bind(global),
  dispatchEvent: global.dispatchEvent.bind(global),
};

// 记录初始的window字段
export const init = new Map<string, boolean>();

// 需要用到全局的
export const unscopables: { [key: string]: boolean } = {
  NodeFilter: true,
  RegExp: true,
};

// 复制原有的,防止被前端网页复写
const descs = Object.getOwnPropertyDescriptors(global);
Object.keys(descs).forEach((key) => {
  const desc = descs[key];
  // 可写但不在特殊配置writables中
  if (desc && desc.writable && !writables[key]) {
    if (typeof desc.value === "function") {
      // 判断是否需要bind，例如Object、Function这些就不需要bind
      if (desc.value.prototype) {
        writables[key] = desc.value;
      } else {
        writables[key] = desc.value.bind(global);
      }
    } else {
      writables[key] = desc.value;
    }
  } else {
    init.set(key, true);
  }
});

export function warpObject(thisContext: object, ...context: object[]) {
  // 处理Object上的方法
  thisContext.hasOwnProperty = (name: PropertyKey) => {
    return (
      Object.hasOwnProperty.call(thisContext, name) || context.some((val) => Object.hasOwnProperty.call(val, name))
    );
  };
  thisContext.isPrototypeOf = (name: object) => {
    return Object.isPrototypeOf.call(thisContext, name) || context.some((val) => Object.isPrototypeOf.call(val, name));
  };
  thisContext.propertyIsEnumerable = (name: PropertyKey) => {
    return (
      Object.propertyIsEnumerable.call(thisContext, name) ||
      context.some((val) => Object.propertyIsEnumerable.call(val, name))
    );
  };
}

type GMWorldContext = ((typeof globalThis) & ({
  [key: string | number | symbol]: any;
}) | ({
  [key: string | number | symbol]: any;
}));

// 拦截上下文
export function proxyContext<const Context extends GMWorldContext>(global: Context, context: any): Context {
  const special = Object.assign(writables);
  const thisContext: Context = <Context>{};
  // 处理某些特殊的属性
  // 后台脚本要不要考虑不能使用eval?
  thisContext.eval = global.eval;
  // thisContext.define = undefined;
  warpObject(thisContext, special, global);
  // 把 GM Api 复製到 thisContext
  for (const key of Object.keys(context)) {
    if (key in protect) continue;
    thisContext[key] = context[key];
  }
  // @ts-ignore
  const proxy = new Proxy(thisContext, {
    defineProperty(target, name, desc) {
      return Reflect.defineProperty(target, name, desc);
    },
    get(_, name): any {
      switch (name) {
        case "window":
        case "self":
        case "globalThis":
          return proxy;
        case "top":
        case "parent":
          if (global[name] === global.self) {
            return special.global || proxy;
          }
          return global.top;
        case "close":
        case "focus":
        case "onurlchange":
          if (context["window"][name]) {
            return context["window"][name];
          }
      }
      if (name !== "undefined") {
        if (has(thisContext, name)) {
          // @ts-ignore
          return thisContext[name];
        }
        if (typeof name === "string") {
          if (has(context, name)) {
            if (has(protect, name)) {
              return undefined;
            }
            return context[name];
          }
          if (has(special, name)) {
            if (typeof special[name] === "function" && !(<{ prototype: any }>special[name]).prototype) {
              return (<{ bind: any }>special[name]).bind(global);
            }
            return special[name];
          }
          if (has(global, name)) {
            // 特殊处理onxxxx的事件
            if (name.startsWith("on")) {
              if (typeof global[name] === "function" && !(<{ prototype: any }>global[name]).prototype) {
                return (<{ bind: any }>global[name]).bind(global);
              }
              return global[name];
            }
          }
          if (init.has(name)) {
            const val = global[name];
            if (typeof val === "function" && !(<{ prototype: any }>val).prototype) {
              return (<{ bind: any }>val).bind(global);
            }
            return val;
          }
        } else if (name === Symbol.unscopables) {
          return unscopables;
        }
      }
      return undefined;
    },
    has(_, name) {
      switch (name) {
        case "window":
        case "self":
        case "globalThis":
          return true;
        case "top":
        case "parent":
          // if (global[name] === global.self) {
          //   return true;
          // }
          return true;
        case "undefined":
          return false;
        default:
          break;
      }
      if (typeof name === "string") {
        if (has(unscopables, name)) {
          return false;
        }
        if (has(thisContext, name)) {
          return true;
        }
        if (has(special, name)) {
          return true;
        }
        // 只处理onxxxx的事件
        if (has(global, name)) {
          if (name.startsWith("on")) {
            return true;
          }
        }
      } else if (typeof name === "symbol") {
        return has(thisContext, name);
      }
      return false;
    },
    set(_, name: string, val) {
      switch (name) {
        case "window":
        case "self":
        case "globalThis":
          return false;
        default:
      }
      if (has(special, name)) {
        special[name] = val;
        return true;
      }
      if (init.has(name)) {
        const des = Object.getOwnPropertyDescriptor(global, name);
        // 只读的return
        if (des && des.get && !des.set && des.configurable) {
          return true;
        }
        // 只处理onxxxx的事件
        if (has(global, name) && name.startsWith("on")) {
          const eventName = name.slice(2);
          if (val === undefined) {
            global.removeEventListener(eventName, thisContext[name]);
          } else {
            if (thisContext[name]) {
              global.removeEventListener(eventName, thisContext[name]);
            }
            global.addEventListener(eventName, val);
          }
          thisContext[name] = val;
          return true;
        }
      }
      // @ts-ignore
      thisContext[name] = val;
      return true;
    },
    getOwnPropertyDescriptor(_, name) {
      try {
        let ret = Object.getOwnPropertyDescriptor(thisContext, name);
        if (ret) {
          return ret;
        }
        ret = Object.getOwnPropertyDescriptor(context, name);
        if (ret) {
          return ret;
        }
        ret = Object.getOwnPropertyDescriptor(global, name);
        return ret;
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
      } catch (e) {
        return undefined;
      }
    },
  });
  proxy[Symbol.toStringTag] = "Window";
  return proxy;
}

export function addStyle(css: string): HTMLElement {
  const dom = document.createElement("style");
  dom.textContent = css;
  if (document.head) {
    return document.head.appendChild(dom);
  }
  return document.documentElement.appendChild(dom);
}
