import type { ScriptRunResource } from "@App/app/repo/scripts";

import type { ScriptFunc } from "./types";
import { protect } from "./gm_context";

// undefined 和 null 以外，使用 hasOwnProperty 检查
// 不使用 != 避免类型转换比较

// @ts-ignore: Object is possibly 'undefined'.

// @ts-ignore
// const hasOwn = Object.hasOwn || ((object: any, key: any) => {
//   switch (object) {
//     case undefined:
//     case null:
//       return false;
//     default:
//       return Object.prototype.hasOwnProperty.call(object, key);
//   }
// });

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
  const code = [scriptCode, sourceURL].join("\n"); // 需要 async 封装, 可top-level await
  // context 和 name 以unnamed arguments方式导入。避免代码能直接以变量名存取
  // this = context: globalThis
  // arguments = [named: Object, scriptName: string]
  // @grant none 时，不让 preCode 中的外部代码存取 GM 跟 GM_info，以arguments[0]存取 GM 跟 GM_info
  // 使用sandboxContext时，arguments[0]为undefined
  return `try {
  with(this.a||{}){
    ${preCode}
    return (async function({GM,GM_info}){
    ${code}
    }).call(this,arguments[0]||{GM,GM_info});
  }
} catch (e) {
  if (e.message && e.stack) {
      console.error("ERROR: Execution of script '" + arguments[1] + "' failed! " + e.message);
      console.log(e.stack);
  } else {
      console.error(e);
  }
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
  scriptCode: string,
  autoDeleteMountFunction: boolean = false
): string {
  const autoDeleteMountCode = autoDeleteMountFunction ? `try{delete window['${script.flag}']}catch(e){}` : "";
  return `window['${script.flag}'] = function(){${autoDeleteMountCode}${scriptCode}}`;
}

type ForEachCallback<T> = (value: T, index: number, array: T[]) => void;

const getAllPropertyDescriptors = (
  obj: any,
  callback: ForEachCallback<[string | symbol, TypedPropertyDescriptor<any> & PropertyDescriptor]>
) => {
  while (obj && obj !== Object) {
    const descs = Object.getOwnPropertyDescriptors(obj);
    Object.entries(descs).forEach(callback);
    obj = Object.getPrototypeOf(obj);
  }
};

export const writables: { [key: string]: any } = {};

// 记录初始的window字段
export const init = new Map<string | symbol, number>();

// 需要用到全局的
export const unscopables: { [key: string]: boolean } = {
  NodeFilter: true,
  RegExp: true,
};

const descsCache = new Set();

// 复制原有的,防止被前端网页复写
getAllPropertyDescriptors(global, ([key, desc]) => {
  if (!desc || descsCache.has(key) || typeof key !== 'string') return;
  descsCache.add(key);

  // 可写但不在特殊配置writables中
  if (desc.writable) {
    // value
    let needBind = false;
    const value = desc.value;
    // 判断是否需要bind，例如Object、Function这些就不需要bind (callable function only)
    if (typeof value === "function" && !value.prototype) {
      needBind = true;
    }
    writables[key] = needBind ? value.bind(global) : value;
  } else {
    // read-only property (configurable getter)
    if (desc.get && !desc.set && desc.configurable) {
      init.set(key, 1 | 4);
    }
    // setter getter
    else if (desc.enumerable && desc.configurable && desc.get && desc.set && key.startsWith('on')) {
      init.set(key, 1 | 2);
    } else {
      init.set(key, 1);
    }
  }

});
descsCache.clear();

export function warpObject(exposedObject: object, context: object) {
  // 处理Object上的方法
  exposedObject.hasOwnProperty = (name: PropertyKey) => {
    return (
      Object.hasOwnProperty.call(exposedObject, name) || Object.hasOwnProperty.call(context, name)
    );
  };
  exposedObject.isPrototypeOf = (name: object) => {
    return Object.isPrototypeOf.call(exposedObject, name) || Object.isPrototypeOf.call(context, name);
  };
  exposedObject.propertyIsEnumerable = (name: PropertyKey) => {
    return (
      Object.propertyIsEnumerable.call(exposedObject, name) || Object.propertyIsEnumerable.call(context, name)
    );
  };
}

type GMWorldContext = ((typeof globalThis) & ({
  [key: string | number | symbol]: any;
  window: any;
  self: any;
  globalThis: any;
}) | ({
  [key: string | number | symbol]: any;
  window: any;
  self: any;
  globalThis: any;
}));

const isEventListener = (x:any)=> (typeof x === 'function' || typeof x === 'object' && x?.handleEvent);

// 拦截上下文
export function createProxyContext<const Context extends GMWorldContext>(global: Context, context: any): Context {
  let exposedWindowProxy : Context | undefined = undefined;
  let withContext: Context | undefined | { [key: string]: any } = undefined;
  // 為避免做成混亂。 ScriptCat腳本中 self, globalThis, parent 為固定值不能修改

  const mUnscopables: {
    [key: string | number | symbol]: any;
  } = { ...unscopables };

  const exposedWindow = <GMWorldContext>{
    ...writables,
    get window() { return exposedWindowProxy },
    set window(_) {},
    get self() { return exposedWindowProxy }, // cannot change
    set self(_) {},
    get globalThis() { return exposedWindowProxy }, // cannot change
    set globalThis(_) {},
    get top() {
      if (global.top === global.self) return exposedWindowProxy;
      return global.top;
    },
    set top(_) {},
    get parent() { // cannot change
      if (global.parent === global.self) return exposedWindowProxy;
      return global.parent;
    },
    set parent(_) {},
    get undefined(){
      return undefined;
    },
    set undefined(_) {},
    get a() {
      return withContext;
    },
    [Symbol.toStringTag]: "Window",
    [Symbol.unscopables]: mUnscopables,
    eval: global.eval,  // 后台脚本要不要考虑不能使用eval?

  } as Context;
  warpObject(exposedWindow, global);
  // 把 GM Api (或其他全域API) 复製到 exposedObject
  for (const key of Object.keys(context)) {
    if (key in protect || key === 'window') continue;
    exposedWindow[key] = context[key]; // window以外
  }

  if (context.window && context.window.close) {
    exposedWindow.close = context.window.close;
  }

  if (context.window && context.window.focus) {
    exposedWindow.focus = context.window.focus;
  }

  if (context.window && context.window.onurlchange === null){
    // 目前 TM 只支援 null. ScriptCat預設null？
    exposedWindow.onurlchange = null;
  }

  const bindHelperMap = new Map();
  const bindHelper = (f:any)=>{
    if(bindHelperMap.has(f)){
      return bindHelperMap.get(f);
    }
    const g = f.bind(global);
    bindHelperMap.set(f, g);
    bindHelperMap.set(g, g);
    return g;
  }

  const exposedWindowProxyHandler:ProxyHandler<Context> = {
    get(target, name){
      const val = <(this: any, ...args: any) => void | any>Reflect.get(target,name);
      if(val!==undefined){
        // if (val === withContext) {
        //   delete target[name];
        //   withContext = {};
        //   return val;
        // }
        if (typeof val === "function" && !val.prototype) {
          return bindHelper(val);
        }
        return val;
      }
      if(init.has(name) ){
        const val = <(this: any, ...args: any) => void | any>Reflect.get(global, name);
        if (typeof val === "function" && !val.prototype) {
          return bindHelper(val);
        }
        return val;
      }
      return undefined;
    },
    set(target, name, val) {
      const initHas = (init.get(name) ?? 0);
      if (initHas & 1) {
        // 只处理onxxxx的事件
        if (initHas & 2) {
          const currentVal = target[name];
          // onxxxx的事件 在exposedObject 上修改时，没有实际作用
          // 需使用EventListener机制
          
          if (val !== currentVal) {
            const eventName = (<string>name).slice(2);
            if (isEventListener(currentVal)) {
              global.removeEventListener(eventName, currentVal);
            }
            if (isEventListener(val)) {
              global.addEventListener(eventName, val);
            } else {
              val = null;
            }
          }
          const ret = Reflect.set(target, name, val);
          return ret;
        }
        // read-only property
        if (initHas & 4) {
          return false;
        }
      }
      return Reflect.set(target, name, val);
    },
    has(target,name){
      const bool = Reflect.has(target,name);
      if(bool) return true;
      if(init.has(name) ){
        return true;
      }
      return false;
    }
  };

  exposedWindowProxy = new Proxy(exposedWindow,exposedWindowProxyHandler);

  withContext = new Proxy(<Context>exposedWindowProxy, {
    has(_, name) {
      return Reflect.has(global, name) || Reflect.has(exposedWindow, name); // 保護global
    }
  });

  console.log(exposedWindowProxy)



  // exposedProxy = new Proxy(exposedObject, {
  //   deleteProperty(target, prop) {
  //     const b = (prop in target);
  //     const c = (prop in global);
  //     if(b && c){
  //       const ret = Reflect.deleteProperty(target, prop);
  //       if (ret) {
  //         target[prop] = undefined;
  //         mUnscopables[prop] = true;
  //       }
  //       return ret;
  //     } else if (b && !c){
  //       return Reflect.deleteProperty(target, prop);
  //     } else {
  //       return false;
  //     }
  //     // const ret = Reflect.deleteProperty(target, prop);
  //     // if (b && ret) {
  //     //   init.delete(prop);
  //     // }
  //     // return ret;
  //   },
  //   get(target, name): any {
  //     if (typeof name === "symbol" || hasOwn(target, name)) {
  //       return Reflect.get(target, name);
  //     }
  //     if (init.has(name)) {
  //       // 不在 exposedObject 但在 window 
  //       // 取 window 上的 (僅限最初的鍵. 見Issue #273)

  //       // if (eventHandlerKeys.has(name)) {
  //       //   const val = global[name];
  //       //   if (typeof val === "function" && !(<{ prototype: any }>val).prototype) {
  //       //     return (<{ bind: any }>val).bind(global);
  //       //   }
  //       // }
  //       const val = <(this: any, ...args: any) => void | any>Reflect.get(global, name);
  //       if (typeof val === "function" && !val.prototype) {
  //         return val.bind(global);
  //       }
  //       return val;
  //     }
  //     return undefined;
  //   },
  //   has(target, name) {
  //     if (Reflect.has(global, name)) {
  //       // 保護global. 在exposedProxy堵住
  //       return true;
  //     }
  //     const ret = Reflect.has(target, name);
  //     if (typeof name === "symbol" || ret) {
  //       return ret;
  //     }
  //     if (init.has(name)) {
  //       return Reflect.has(global, name);
  //     }
  //     return false;
  //   },
  //   set(target, name, val) {
  //     const initHas = (init.get(name) ?? 0);
  //     if (initHas & 1) {
  //       // 只处理onxxxx的事件
  //       if (initHas & 2) {
  //         const currentVal = target[name];
  //         // onxxxx的事件 在exposedObject 上修改时，没有实际作用
  //         // 需使用EventListener机制
          
  //         if (val !== currentVal) {
  //           const eventName = (<string>name).slice(2);
  //           if (isEventListener(currentVal)) {
  //             global.removeEventListener(eventName, currentVal);
  //           }
  //           if (isEventListener(val)) {
  //             global.addEventListener(eventName, val);
  //           } else {
  //             val = null;
  //           }
  //         }
  //         const ret = Reflect.set(target, name, val);
  //         return ret;
  //       }
  //       // read-only property
  //       if (initHas & 4) {
  //         return false;
  //       }
  //     }
  //     return Reflect.set(target, name, val);
  //   },
  //   getOwnPropertyDescriptor(target, name) {
  //     try {
  //       let ret = Reflect.getOwnPropertyDescriptor(target, name);
  //       if (!ret && init.has(name)) {
  //         ret = Reflect.getOwnPropertyDescriptor(global, name);
  //       }
  //       return ret;
  //     } catch (_) {
  //       // do nothing
  //     }
  //   },
  // });
  // exposedWindowProxy[Symbol.toStringTag] = "Window";
  return exposedWindowProxy;
}

export function addStyle(css: string): HTMLElement {
  const dom = document.createElement("style");
  dom.textContent = css;
  if (document.head) {
    return document.head.appendChild(dom);
  }
  return document.documentElement.appendChild(dom);
}
