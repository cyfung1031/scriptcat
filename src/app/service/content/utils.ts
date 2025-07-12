import type { ScriptRunResource } from "@App/app/repo/scripts";

import type { ScriptFunc } from "./types";
import { protect } from "./gm_context";

const noEval = false;

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
  // 使用sandboxContext时，arguments[0]为undefined, this.$则为一次性Proxy变量，用於全域拦截context
  return `try {
  with(this.$||arguments[0]){
${preCode}
    return (async function(){
${code}
    }).call(this);
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

// 需要用到全局的
// 不進行 with 攔截
export const unscopables: { [key: string]: boolean } = {
  NodeFilter: true,
  RegExp: true,
  "this": true,
  "arguments": true
};

const descsCache:Set<string | symbol> = new Set(["eval","window", "self", "globalThis", "top", "parent"]);

// 复制原有的,防止被前端网页复写
const copy = (o:any)=> Object.create(Object.getPrototypeOf(o), Object.getOwnPropertyDescriptors(o));

const createEventProp = (eventName:string)=>{
  let registered:EventListenerOrEventListenerObject | null = null;
  return {
    get(){
      return registered;
    },
    set(newVal:EventListenerOrEventListenerObject | any) {
      if (newVal !== registered) {
        if (isEventListener(registered)) {
          global.removeEventListener(eventName, registered!);
        }
        if (isEventListener(newVal)) {
          global.addEventListener(eventName, newVal);
        } else {
          newVal = null;
        }
        registered = newVal;
      }
    }
  }
}

const overridedDescs:({
    [x: string]: TypedPropertyDescriptor<any>;
} & {
    [x: string]: PropertyDescriptor;
}) = {};

// const specialKeys = new Set(["eval","window", "self", "globalThis", "top", "parent"]);

// 复制原有的,防止被前端网页复写
getAllPropertyDescriptors(global, ([key, desc]) => {
  if (!desc || descsCache.has(key) || typeof key !== 'string') return;
  descsCache.add(key);

  // if(specialKeys.has(key)) return;



    // 可写但不在特殊配置writables中
    if (desc.writable) {
      // value

      const value = desc.value;

      // 判断是否需要bind，例如Object、Function这些就不需要bind (callable function only)
      if (typeof value === "function" && !value.prototype) {
        const boundValue = value.bind(global);
        overridedDescs[key] = {
          ...desc,
          value: boundValue
        }
      }

    } else {
      if (desc.configurable && desc.get && desc.set && desc.enumerable && key.startsWith('on')) {
        const eventName = (<string>key).slice(2);
        const eventSetterGetter = createEventProp(eventName);
        overridedDescs[key] = {
          ...desc,
          ...eventSetterGetter
        };
      } else {



        if (desc.get || desc.set) {

          overridedDescs[key] = {
            ...desc,
            get: desc?.get?.bind(global),
            set: desc?.set?.bind(global),
          };

        }


      }
    }

});
descsCache.clear();

const createFuncWrapper = (f: () => any) => {
  return function (this: any) {
    const ret = f.call(global);
    if (ret === global) return this;
    return ret;
  }
}

const ownDescs = Object.getOwnPropertyDescriptors(global);
for (const key of ["window", "self", "globalThis", "top", "parent"]) {
  const desc = ownDescs[key];
  if(desc?.value && key === 'globalThis'){
    desc.get = function () { return this };
    desc.set = undefined;
    delete desc.writable;
    delete desc.value;
  } else if (desc?.get) {
    desc.get = createFuncWrapper(desc.get);
    desc.set = undefined;
  }
}
if (noEval) {
  if (ownDescs?.eval?.value) {
    ownDescs.eval.value = undefined;
  }
}


const initCopy = Object.create(Object.getPrototypeOf(global), {
  ...ownDescs,
  ...overridedDescs
});

// export function warpObject(exposedObject: object, context: object) {
  // 处理Object上的方法
  // exposedObject.hasOwnProperty = (name: PropertyKey) => {
  //   return (
  //     Object.hasOwnProperty.call(exposedObject, name) || Object.hasOwnProperty.call(context, name)
  //   );
  // };
  // exposedObject.isPrototypeOf = (name: object) => {
  //   return Object.isPrototypeOf.call(exposedObject, name) || Object.isPrototypeOf.call(context, name);
  // };
  // exposedObject.propertyIsEnumerable = (name: PropertyKey) => {
  //   return (
  //     Object.propertyIsEnumerable.call(exposedObject, name) || Object.propertyIsEnumerable.call(context, name)
  //   );
  // };
// }

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

const isEventListener = (x:EventListenerOrEventListenerObject | any)=> (typeof x === 'function' || typeof x === 'object' && typeof x?.handleEvent === 'function');

// 拦截上下文
export function createProxyContext<const Context extends GMWorldContext>(global: Context, context: any): Context {

  // let withContext: Context | undefined | { [key: string]: any } = undefined;
  // 為避免做成混亂。 ScriptCat腳本中 self, globalThis, parent 為固定值不能修改

  const myCopy = copy(initCopy);

  const mUnscopables: {
    [key: string | number | symbol]: any;
  } = {
    ...(myCopy[Symbol.unscopables] || {}),
    ...unscopables
  };

  Object.defineProperty(myCopy, "$", {
    enumerable: false,
    configurable: true,
    get(){
      delete this.$;
      return new Proxy(<Context>myCopy, {
        has() {
          return true;
        }
      });
    }
  });

  Object.assign(myCopy, {
    [Symbol.unscopables]: mUnscopables
  });

  const exposedWindow = myCopy;
  // warpObject(exposedWindow, global);
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




  console.log(exposedWindow)

  return exposedWindow;
}

export function addStyle(css: string): HTMLElement {
  const dom = document.createElement("style");
  dom.textContent = css;
  if (document.head) {
    return document.head.appendChild(dom);
  }
  return document.documentElement.appendChild(dom);
}
