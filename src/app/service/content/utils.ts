import type { ScriptRunResource } from "@App/app/repo/scripts";

import type { ScriptFunc } from "./types";
import { protect } from "./gm_context";

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
  // 在userScript API中，由於执行不是在物件导向裡呼叫，使用arrow function的话会把this改变。须使用 .call(this) [ 或 .bind(this)() ]
  return `try {
  with(this){
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

// 取物件本身及所有父类(不包含Object)的PropertyDescriptor
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



const isEventListenerFunc = (x: any) => typeof x === 'function';
const isPrimitive = (x: any) => x !== Object(x);




type GMWorldContext = ((typeof globalThis) & ({
  [key: string | number | symbol]: any;
}) | ({
  [key: string | number | symbol]: any;
}));


const globalMap = new Map<GMWorldContext, any>();

const getDescs = (global: GMWorldContext) => {


  const createEventProp = (key: string) => {
    // 赋值变量
    let registered: EventListenerOrEventListenerObject | null = null;
    return {
      get() {
        return registered;
      },
      set(newVal: EventListenerOrEventListenerObject | any) {
        if (newVal !== registered) {

          const eventName = (<string>key).slice(2);
          if (isEventListenerFunc(registered)) {
            // 停止当前事件监听
            global.removeEventListener(eventName, registered!);
          }
          if (isPrimitive(newVal)) {
            // 按照实际操作，primitive types (number, string, boolean, ...) 会被转换成 null
            newVal = null;
          } else if (isEventListenerFunc(newVal)) {
            // 非primitive types 的话，只考虑 function type
            // Symbol, Object (包括 EventListenerObject ) 等只会保存而不进行事件监听
            global.addEventListener(eventName, newVal);
          }
          registered = newVal;
        }
      }
    }
  }

  let ret = globalMap.get(global);

  if (ret) return ret;

  // 在 CacheSet 加入的propKeys将会在myCopy实装阶段时设置
  const descsCache: Set<string | symbol> = new Set(["eval", "window", "self", "globalThis", "top", "parent"]);

  const myDescs: typeof ownDescs = {};

  const ownDescs = Object.getOwnPropertyDescriptors(global);
  const anDescs = new Set<TypedPropertyDescriptor<any>>();

  // 包含物件本身及所有父类(不包含Object)的PropertyDescriptor
  // 主要是找出哪些 function值， setter/getter 需要替换 global window
  getAllPropertyDescriptors(global, ([key, desc]) => {
    if (ownDescs[key] !== desc) {
      anDescs.add(desc);
    }
    if (!desc || descsCache.has(key) || typeof key !== 'string') return;
    descsCache.add(key);

    if (desc.writable) {
      // 属性 value

      const value = desc.value;

      // 替换 function 的 this 为 实际的 global window
      // 例：父类的 addEventListener
      if (typeof value === "function" && !value.prototype) {
        const boundValue = value.bind(global);
        myDescs[key] = {
          ...desc,
          value: boundValue
        }
      } else {
        myDescs[key] = {
          ...desc,
          value
        }
      }

      // keysMap.set(key, 1);

    } else {

      const p = desc.configurable && desc.get && desc.set && desc.enumerable && key.startsWith('on');
      const wr = desc.get || desc.set;
      // let k = 2;
      // if (p) k |= 4;
      // if (desc.get) k |= 8;
      // if (desc.set) k |= 16;
      // keysMap.set(key, k);

      if (p) {

        const eventSetterGetter = createEventProp(key);
        myDescs[key] = {
          ...desc,
          ...eventSetterGetter
        };

      } else if (wr) {
        myDescs[key] = {
          ...desc,
          get: desc?.get?.bind(global),
          set: desc?.set?.bind(global),
        };

      }
    }

  });
  descsCache.clear(); // 内存释放

  myDescs[Symbol.toStringTag] = {
    configurable: true,
    enumerable: false,
    value: "Window",
    writable: false,
  }

  ret = {
    myDescs, anDescs
  }
  globalMap.set(global, ret);

  return ret;
}

getDescs(global);

// 拦截上下文
export function createProxyContext<const Context extends GMWorldContext>(mGlobal: Context, context: any): Context {

  const { myDescs, anDescs } = getDescs(mGlobal);


  // eslint-disable-next-line prefer-const
  let exposedProxy: any;

  const windowDesc = {
    configurable: false,
    enumerable: true,
    value: exposedProxy,
    writable: false,
  }
  const topDesc = {
    configurable: false,
    enumerable: true,
    get() {
      return mGlobal.top === mGlobal ? exposedProxy : mGlobal.top;
    }
  }
  const parentDesc = {
    configurable: false,
    enumerable: true,
    get() {
      return mGlobal.parent === mGlobal ? exposedProxy : mGlobal.parent;
    }
  }

  const myObject = Object.create(Object.prototype, {
    ...myDescs,
    window: windowDesc,
    self: windowDesc,
    globalThis: windowDesc,
    top: topDesc,
    parent: parentDesc,
  });

  myObject[Symbol.unscopables] = {};


  const exposedObject: Context = <Context>myObject;
  // 处理某些特殊的属性
  // 后台脚本要不要考虑不能使用eval?
  exposedObject.eval = mGlobal.eval;
  // exposedObject.define = undefined;
  // 把 GM Api (或其他全域API) 复製到 exposedObject
  for (const key of Object.keys(context)) {
    if (key in protect || key === 'window') continue;
    exposedObject[key] = context[key];
    // keysMap.set(key, 32);
  }

  // keysMap.set("window", 8 | 64);
  // keysMap.set("self", 8 | 64);
  // keysMap.set("globalThis", 8 | 64);
  // keysMap.set("top", 8| 64);
  // keysMap.set("parent", 8 | 64);

  if (context.window) {

    for (const key of Object.keys(context.window)) {
      exposedObject[key] = context.window[key];
      // keysMap.set(key, 32);
    }
  }

  console.log(3772)
  console.log(myObject)



  // @ts-ignore
  exposedProxy = new Proxy(exposedObject, {
    // defineProperty(target, name, desc) {
    //   return Reflect.defineProperty(target, name, desc);
    // },
    // get(target, name): any {
    //   return Reflect.get(target,name);
    // },
    // has(target, name) {
    //   return Reflect.has(target,name);
    // },
    // set(target, name, val) {
    //   return Reflect.set(target, name, val);
    // },
    getOwnPropertyDescriptor(target, name) {
      const ret = Reflect.getOwnPropertyDescriptor(target, name);
      if (anDescs.has(ret)) return undefined;
      return ret;
    },
  });
  return exposedProxy;
}

export function addStyle(css: string): HTMLElement {
  const dom = document.createElement("style");
  dom.textContent = css;
  if (document.head) {
    return document.head.appendChild(dom);
  }
  return document.documentElement.appendChild(dom);
}
