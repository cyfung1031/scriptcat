// gm api 权限验证
import Cache from "@App/app/cache";
import { Script } from "@App/app/repo/scripts";
import { v4 as uuidv4 } from "uuid";
import { Api, Request } from "./gm_api";
import Queue from "@App/pkg/utils/queue";
import CacheKey from "@App/app/cache_key";
import { Permission, PermissionDAO } from "@App/app/repo/permission";
import { Group } from "@Packages/message/server";
import { subscribeScriptDelete } from "../queue";
import { MessageQueue } from "@Packages/message/message_queue";

export interface ConfirmParam {
  // 权限名
  permission: string;
  // 权限值
  permissionValue?: string;
  // 确认权限标题
  title?: string;
  // 权限详情内容
  metadata?: { [key: string]: string };
  // 权限描述
  describe?: string;
  // 是否通配
  wildcard?: boolean;
  // 权限内容
  permissionContent?: string;
}

export interface UserConfirm {
  allow: boolean;
  type: number; // 1: 允许一次 2: 临时允许全部 3: 临时允许此 4: 永久允许全部 5: 永久允许此
}

export interface ApiParam {
  // 默认提供的函数
  default?: boolean;
  // 是否只有后台环境中才能执行
  background?: boolean;
  // 是否需要弹出页面让用户进行确认
  confirm?: (request: Request) => Promise<boolean | ConfirmParam>;
  // 别名
  alias?: string[];
  // 关联
  link?: string | string[];
}

export interface ApiValue {
  api: Api;
  param: ApiParam;
}

export interface IPermissionVerify {
  verify(request: Request, api: ApiValue): Promise<boolean>;
}

export default class PermissionVerify {
  static apis: Map<string, ApiValue> = new Map();

  public static API(param: ApiParam = {}) {
    return (target: any, propertyName: string, descriptor: PropertyDescriptor) => {
      const key = propertyName;
      PermissionVerify.apis.set(key, {
        api: descriptor.value,
        param,
      });
      // 兼容GM.*
      const dot = key.replace("_", ".");
      if (dot !== key) {
        PermissionVerify.apis.set(dot, {
          api: descriptor.value,
          param,
        });
        if (param.alias) {
          param.alias.push(dot);
        } else {
          param.alias = [dot];
        }
      }

      // 处理别名
      if (param.alias) {
        param.alias.forEach((alias) => {
          PermissionVerify.apis.set(alias, {
            api: descriptor.value,
            param,
          });
        });
      }
    };
  }

  // 确认队列
  confirmQueue: Queue<{
    request: Request;
    confirm: ConfirmParam | boolean;
    resolve: (value: boolean) => void;
    reject: (reason: any) => void;
  }> = new Queue();

  private permissionDAO: PermissionDAO = new PermissionDAO();

  constructor(
    private group: Group,
    private mq: MessageQueue
  ) {
    this.permissionDAO.enableCache();
  }

  // 验证是否有权限
  async verify(request: Request, api: ApiValue): Promise<boolean> {
    if (api.param.default) {
      return true;
    }
    // 没有其它条件,从metadata.grant中判断
    const { grant } = request.script.metadata;
    if (!grant) {
      throw new Error("grant is undefined");
    }
    for (let i = 0; i < grant.length; i += 1) {
      let grantName = grant[i];
      if (
        // 名称相等
        grantName === request.api ||
        // 别名相等
        (api.param.alias && api.param.alias.includes(grantName)) ||
        // 有关联的
        (typeof api.param.link === "string" && grantName === api.param.link) ||
        // 关联包含
        (Array.isArray(api.param.link) && api.param.link.includes(grantName))
      ) {
        // 需要用户确认
        let result = true;
        if (api.param.confirm) {
          result = await this.pushConfirmQueue(request, api);
        }
        return result;
      }
    }
    throw new Error("permission not requested");
  }

  async dealConfirmQueue() {
    // 处理确认队列
    const data = await this.confirmQueue.pop();
    if (!data) {
      this.dealConfirmQueue();
      return;
    }
    try {
      const ret = await this.confirm(data.request, data.confirm);
      data.resolve(ret);
    } catch (e) {
      data.reject(e);
    }
    this.dealConfirmQueue();
  }

  // 确认队列,为了防止一次性打开过多的窗口
  async pushConfirmQueue(request: Request, api: ApiValue): Promise<boolean> {
    const confirm = await api.param.confirm!(request);
    if (confirm === true) {
      return true;
    }
    return await new Promise((resolve, reject) => {
      this.confirmQueue.push({ request, confirm, resolve, reject });
    });
  }

  async confirm(request: Request, confirm: boolean | ConfirmParam): Promise<boolean> {
    if (typeof confirm === "boolean") {
      return confirm;
    }
    const cacheKey = CacheKey.permissionConfirm(request.script.uuid, confirm);
    // 从数据库中查询是否有此权限
    const ret = await Cache.getInstance().getOrSet(cacheKey, async () => {
      let model = await this.permissionDAO.findByKey(request.uuid, confirm.permission, confirm.permissionValue || "");
      if (!model) {
        // 允许通配
        if (confirm.wildcard) {
          model = await this.permissionDAO.findByKey(request.uuid, confirm.permission, "*");
        }
      }
      return model;
    });
    // 有查询到结果,进入判断,不再需要用户确认
    if (ret) {
      if (ret.allow) {
        return true;
      }
      // 权限拒绝
      throw new Error("permission denied");
    }
    // 没有权限,则弹出页面让用户进行确认
    const userConfirm = await this.confirmWindow(request.script, confirm);
    // 成功存入数据库
    const model: Permission = {
      uuid: request.uuid,
      permission: confirm.permission,
      permissionValue: "",
      allow: userConfirm.allow,
      createtime: new Date().getTime(),
      updatetime: 0,
    };
    switch (userConfirm.type) {
      case 4:
      case 2: {
        // 通配
        model.permissionValue = "*";
        break;
      }
      case 5:
      case 3: {
        model.permissionValue = confirm.permissionValue || "";
        break;
      }
      default:
        break;
    }
    // 临时 放入缓存
    if (userConfirm.type >= 2) {
      Cache.getInstance().set(cacheKey, model);
    }
    // 总是 放入数据库
    if (userConfirm.type >= 4) {
      const oldConfirm = await this.permissionDAO.findByKey(request.uuid, model.permission, model.permissionValue);
      if (!oldConfirm) {
        await this.permissionDAO.save(model);
      } else {
        await this.permissionDAO.update(this.permissionDAO.key(model), model);
      }
    }
    if (userConfirm.allow) {
      return true;
    }
    throw new Error("permission not allowed");
  }

  // 确认map
  confirmMap: Map<
    string,
    {
      confirm: ConfirmParam;
      script: Script;
      resolve: (value: UserConfirm) => void;
      reject: (reason: any) => void;
    }
  > = new Map();

  // 弹出窗口让用户进行确认
  async confirmWindow(script: Script, confirm: ConfirmParam): Promise<UserConfirm> {
    return new Promise((resolve, reject) => {
      const uuid = uuidv4();
      // 超时处理
      const timeout = setTimeout(() => {
        this.confirmMap.delete(uuid);
        reject(new Error("permission confirm timeout"));
      }, 40 * 1000);
      // 保存到map中
      this.confirmMap.set(uuid, {
        confirm,
        script,
        resolve: (value: UserConfirm) => {
          clearTimeout(timeout);
          resolve(value);
        },
        reject,
      });
      // 打开窗口
      chrome.tabs.create({
        url: chrome.runtime.getURL(`src/confirm.html?uuid=${uuid}`),
      });
    });
  }

  // 处理确认
  private async userConfirm(data: { uuid: string; userConfirm: UserConfirm }) {
    const confirm = this.confirmMap.get(data.uuid);
    if (!confirm) {
      if (data.userConfirm.type === 0) {
        // 忽略
        return undefined;
      }
      throw new Error("confirm not found");
    }
    this.confirmMap.delete(data.uuid);
    confirm.resolve(data.userConfirm);
    return true;
  }

  // 获取信息
  private async getInfo(uuid: string) {
    const data = this.confirmMap.get(uuid);
    if (!data) {
      throw new Error("permission confirm not found");
    }
    const { script, confirm } = data;
    // 查询允许统配的有多少个相同等待确认权限
    let likeNum = 0;
    if (data.confirm.wildcard) {
      this.confirmQueue.list.forEach((value) => {
        const confirm = value.confirm as ConfirmParam;
        if (
          confirm.wildcard &&
          value.request.uuid === data.script.uuid &&
          confirm.permission === data.confirm.permission
        ) {
          likeNum += 1;
        }
      });
    }
    return { script, confirm, likeNum };
  }

  async deletePermission(data: { uuid: string; permission: string; permissionValue: string }) {
    const oldConfirm = await this.permissionDAO.findByKey(data.uuid, data.permission, data.permissionValue);
    if (!oldConfirm) {
      throw new Error("permission not found");
    }
    await this.permissionDAO.delete(this.permissionDAO.key(oldConfirm));
    this.clearCache(data.uuid);
  }

  getScriptPermissions(uuid: string) {
    // 获取脚本的所有权限
    return this.permissionDAO.find((key, item) => item.uuid === uuid);
  }

  // 添加权限
  async addPermission(permission: Permission) {
    await this.permissionDAO.save(permission);
    this.clearCache(permission.uuid);
  }

  // 重置权限
  async resetPermission(uuid: string) {
    // 删除所有权限
    const permissions = await this.permissionDAO.find((key, item) => item.uuid === uuid);
    permissions.forEach((item) => {
      this.permissionDAO.delete(this.permissionDAO.key(item));
    });
    this.clearCache(uuid);
  }

  async clearCache(uuid: string) {
    const keys = await Cache.getInstance().list();
    // 删除所有以permission:uuid:开头的缓存
    await Promise.all(
      keys.map((key) => {
        if (key.startsWith(`permission:${uuid}:`)) {
          return Cache.getInstance().del(key);
        }
      })
    );
  }

  init() {
    this.dealConfirmQueue();
    this.group.on("confirm", this.userConfirm.bind(this));
    this.group.on("getInfo", this.getInfo.bind(this));
    this.group.on("deletePermission", this.deletePermission.bind(this));
    this.group.on("getScriptPermissions", this.getScriptPermissions.bind(this));
    this.group.on("addPermission", this.addPermission.bind(this));
    this.group.on("resetPermission", this.resetPermission.bind(this));

    subscribeScriptDelete(this.mq, (data) => {
      // 删除脚本的所有权限
      this.resetPermission(data.script.uuid);
    });
  }
}
