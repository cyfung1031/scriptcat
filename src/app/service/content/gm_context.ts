import type { ApiParam, ApiValue } from "./types";

const apis: Map<string, ApiValue[]> = new Map();

export function GMContextApiGet(name: string): ApiValue[] | undefined {
  return apis.get(name);
}

export function GMContextApiSet(grant: string, fnKey: string, api: any, param: ApiParam): void {
  let m: ApiValue[] | undefined = apis.get(grant);
  if (!m) apis.set(grant, m = []);
  m.push({ fnKey, api, param });
}

export const protect: { [key: string]: any } = {};

export default class GMContext {

  public static protected(value: any = undefined) {
    return (target: any, propertyName: string) => {
      protect[propertyName] = value;
    };
  }

  public static API(param: ApiParam = {}) {
    return (target: any, propertyName: string, descriptor: PropertyDescriptor) => {
      const key = propertyName;
      let {follow} = param;
      if(!follow) follow = key;
      GMContextApiSet(follow, key, descriptor.value, param);
    };
  }
}