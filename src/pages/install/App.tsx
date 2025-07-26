import {
  Avatar,
  Button,
  Dropdown,
  Grid,
  Message,
  Menu,
  Space,
  Switch,
  Tag,
  Tooltip,
  Typography,
  Popover,
} from "@arco-design/web-react";
import { IconDown } from "@arco-design/web-react/icon";
import { v4 as uuidv4 } from "uuid";
import CodeEditor from "../components/CodeEditor";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Metadata, Script } from "@App/app/repo/scripts";
import { SCRIPT_STATUS_DISABLE, SCRIPT_STATUS_ENABLE } from "@App/app/repo/scripts";
import type { Subscribe } from "@App/app/repo/subscribe";
import { i18nDescription, i18nName } from "@App/locales/locales";
import { useTranslation } from "react-i18next";
import type { ScriptInfo } from "@App/pkg/utils/script";
import { prepareScriptByCode, prepareSubscribeByCode, scriptInfoByCode } from "@App/pkg/utils/script";
import { nextTime } from "@App/pkg/utils/cron";
import { scriptClient, subscribeClient } from "../store/features/script";
import { type FTInfo, startFileTrack, unmountFileTrack } from "@App/pkg/utils/file-tracker";
import { cleanupOldHandles, loadHandle, saveHandle } from "@App/pkg/utils/filehandle-db";
import { dayFormat } from "@App/pkg/utils/day_format";

// Types
interface PermissionItem {
  label: string;
  color?: string;
  value: string[];
}

type Permission = PermissionItem[];

const closeWindow = () => {
  window.close();
};

const usePermissions = (scriptInfo: ScriptInfo | undefined, metadata: Metadata) => {
  const { t } = useTranslation();

  return useMemo(() => {
    const permissions: Permission = [];

    if (!scriptInfo) return permissions;

    if (scriptInfo.userSubscribe) {
      permissions.push({
        label: t("subscribe_install_label"),
        color: "#ff0000",
        value: metadata.scripturl!,
      });
    }

    if (metadata.match) {
      permissions.push({ label: t("script_runs_in"), value: metadata.match });
    }

    if (metadata.connect) {
      permissions.push({
        label: t("script_has_full_access_to"),
        color: "#F9925A",
        value: metadata.connect,
      });
    }

    if (metadata.require) {
      permissions.push({ label: t("script_requires"), value: metadata.require });
    }

    return permissions;
  }, [scriptInfo, metadata, t]);
};

const useScriptDescription = (scriptInfo: ScriptInfo | undefined, metadata: Metadata) => {
  const { t } = useTranslation();

  return useMemo(() => {
    const description: JSX.Element[] = [];

    if (!scriptInfo) return description;

    const isCookie = metadata.grant?.some((val) => val === "GM_cookie");
    if (isCookie) {
      description.push(
        <Typography.Text type="error" key="cookie">
          {t("cookie_warning")}
        </Typography.Text>
      );
    }

    if (metadata.crontab) {
      description.push(<Typography.Text key="crontab">{t("scheduled_script_description_title")}</Typography.Text>);
      description.push(
        <Typography.Text key="cronta-nexttime">
          {t("scheduled_script_description_description", {
            expression: metadata.crontab[0],
            time: nextTime(metadata.crontab[0]),
          })}
        </Typography.Text>
      );
    } else if (metadata.background) {
      description.push(<Typography.Text key="background">{t("background_script_description")}</Typography.Text>);
    }

    return description;
  }, [scriptInfo, metadata, t]);
};

const useAntiFeatures = () => {
  const { t } = useTranslation();

  return useMemo(() => {
    const antifeatures: { [key: string]: { color: string; title: string; description: string } } = {
      "referral-link": {
        color: "purple",
        title: t("antifeature_referral_link_title"),
        description: t("antifeature_referral_link_description"),
      },
      ads: {
        color: "orange",
        title: t("antifeature_ads_title"),
        description: t("antifeature_ads_description"),
      },
      payment: {
        color: "magenta",
        title: t("antifeature_payment_title"),
        description: t("antifeature_payment_description"),
      },
      miner: {
        color: "orangered",
        title: t("antifeature_miner_title"),
        description: t("antifeature_miner_description"),
      },
      membership: {
        color: "blue",
        title: t("antifeature_membership_title"),
        description: t("antifeature_membership_description"),
      },
      tracking: {
        color: "pinkpurple",
        title: t("antifeature_tracking_title"),
        description: t("antifeature_tracking_description"),
      },
    };

    return antifeatures;
  }, [t]);
};

let liveFileHandleCId: NodeJS.Timeout | undefined;
let cleanupFileHandleCId: NodeJS.Timeout | undefined;

function App() {
  const [enable, setEnable] = useState<boolean>(false);
  const [btnText, setBtnText] = useState<string>("");
  const [scriptCode, setScriptCode] = useState<string>("");
  const [scriptInfo, setScriptInfo] = useState<ScriptInfo>();
  const [upsertScript, setUpsertScript] = useState<Script | Subscribe>();
  const [code, setCode] = useState<string>("");
  const [diffCode, setDiffCode] = useState<string>();
  const [oldScript, setOldScript] = useState<Script | Subscribe>();
  const [isUpdate, setIsUpdate] = useState<boolean>(false);
  const [localFile, setLocalFile] = useState<File | null>(null);
  const [localFileHandle, setLocalFileHandle] = useState<FileSystemFileHandle | null>(null);
  const { t } = useTranslation();

  const initAsync = async () => {
    try {
      const url = new URL(window.location.href);
      const uuid = url.searchParams.get("uuid");
      let info: ScriptInfo | undefined;
      if (uuid) {
        info = await scriptClient.getInstallInfo(uuid);
      } else {
        // 检查是不是本地文件安装
        const local = url.searchParams.get("local") === "true";
        if (!local) {
          throw new Error("url param - not local");
        }
        const fid = url.searchParams.get("file");
        if (!fid) return;
        const fileHandle = await loadHandle(fid);
        if (!fileHandle) {
          throw new Error("invalid file access - fileHandle is null");
        }
        const file = await fileHandle.getFile();
        if (!file) {
          throw new Error("invalid file access - file is null");
        }
        // 处理本地文件的安装流程
        // 处理成info对象
        setLocalFile(file);
        setLocalFileHandle((prev) => {
          if (prev instanceof FileSystemFileHandle) unmountFileTrack(prev);
          return fileHandle!;
        });
        const code = await file.text();
        info = scriptInfoByCode(code, `file:///*from-local*/${file.name}`, "user", false, uuidv4());
        if (liveFileHandleCId) clearInterval(liveFileHandleCId);
        liveFileHandleCId = setInterval(
          async () => {
            // 每五分鐘刷新一次db记录的timestamp，使开啟中的安装页面的fileHandle不会被刷掉
            await saveHandle(fid, fileHandle); // 刷新 timestamp
          },
          5 * 60 * 1000
        );
        saveHandle(fid, fileHandle); // 刷新 timestamp, 使 10s~15s 后不会被立即清掉
      }
      if (!info) {
        throw new Error("fetch script info failed");
      }

      let prepare:
        | { script: Script; oldScript?: Script; oldScriptCode?: string }
        | { subscribe: Subscribe; oldSubscribe?: Subscribe };
      let action: Script | Subscribe;

      if (info.userSubscribe) {
        prepare = await prepareSubscribeByCode(info.code, info.url);
        action = prepare.subscribe;
        setOldScript(prepare.oldSubscribe);
        setCode(prepare.subscribe.code);
        setDiffCode(prepare.oldSubscribe?.code);
        if (prepare.oldSubscribe) {
          setIsUpdate(true);
        }
      } else {
        if (info.update) {
          prepare = await prepareScriptByCode(info.code, info.url, info.uuid);
        } else {
          prepare = await prepareScriptByCode(info.code, info.url);
        }
        action = prepare.script;
        setOldScript(prepare.oldScript);
        setCode(info.code);
        setDiffCode(prepare.oldScriptCode);
        if (prepare.oldScript) {
          setIsUpdate(true);
        }
      }

      setScriptInfo(info);
      setUpsertScript(action);
    } catch (e: any) {
      Message.error(t("script_info_load_failed") + " " + e.message);
    } finally {
      // fileHandle 保留处理方式（暂定）：
      // fileHandle 会保留一段足够时间，避免用户重新刷画面，重啟瀏览器等操作后，安装页变得空白一片。
      // 处理会在所有Tab都载入后（不包含睡眠Tab）进行，因此延迟 10s~15s 让处理有足够时间。
      // 安装页面关掉后15分鐘为不保留状态，会在安装画面再次打开时（其他脚本安装），进行清除。
      const delay = Math.floor(5000 * Math.random()) + 10000; // 使用乱数时间避免瀏览器重啟时大量Tabs同时执行DB清除
      if (cleanupFileHandleCId) clearTimeout(cleanupFileHandleCId);
      cleanupFileHandleCId = setTimeout(() => {
        cleanupOldHandles();
      }, delay);
    }
  };

  useEffect(() => {
    initAsync();
  }, []);

  const [watchFile, setWatchFile] = useState(false);

  const metadata: Metadata = scriptInfo?.metadata || {};
  const permissions = usePermissions(scriptInfo, metadata);
  const description = useScriptDescription(scriptInfo, metadata);
  const antifeatures = useAntiFeatures();

  // 更新按钮文案和页面标题
  useEffect(() => {
    if (scriptInfo?.userSubscribe) {
      setBtnText(isUpdate ? t("update_subscribe")! : t("install_subscribe"));
    } else {
      setBtnText(isUpdate ? t("update_script")! : t("install_script"));
    }
    setScriptCode(code || "");
    if (upsertScript) {
      document.title = `${!isUpdate ? t("install_script") : t("update_script")} - ${i18nName(upsertScript)} - ScriptCat`;
    }
  }, [isUpdate, scriptInfo, upsertScript, t]);

  // 设置脚本状态
  useEffect(() => {
    if (upsertScript) {
      setEnable(upsertScript.status === SCRIPT_STATUS_ENABLE);
    }
  }, [upsertScript]);

  const handleInstall = useCallback(
    async (options: { closeAfterInstall?: boolean; noMoreUpdates?: boolean } = {}) => {
      if (!upsertScript) {
        Message.error(t("script_info_load_failed")!);
        return;
      }

      const { closeAfterInstall: shouldClose = true, noMoreUpdates: disableUpdates = false } = options;

      try {
        if (scriptInfo?.userSubscribe) {
          await subscribeClient.install(upsertScript as Subscribe);
          Message.success(t("subscribe_success")!);
          setBtnText(t("subscribe_success")!);
        } else {
          // 如果选择不再检查更新，可以在这里设置脚本的更新配置
          if (disableUpdates && upsertScript) {
            // 这里可以设置脚本禁用自动更新的逻辑
            (upsertScript as Script).checkUpdate = false;
          }

          await scriptClient.install(upsertScript as Script, code);
          if (isUpdate) {
            Message.success(t("install.update_success")!);
            setBtnText(t("install.update_success")!);
          } else {
            Message.success(t("install_success")!);
            setBtnText(t("install_success")!);
          }
        }

        if (shouldClose) {
          setTimeout(() => {
            closeWindow();
          }, 500);
        }
      } catch (e) {
        const errorMessage = scriptInfo?.userSubscribe ? t("subscribe_failed") : t("install_failed");
        Message.error(`${errorMessage}: ${e}`);
      }
    },
    [upsertScript, scriptInfo, code, isUpdate, t]
  );

  const handleStatusChange = useCallback(
    (checked: boolean) => {
      setUpsertScript((script) => {
        if (!script) {
          return script;
        }
        script.status = checked ? SCRIPT_STATUS_ENABLE : SCRIPT_STATUS_DISABLE;
        setEnable(checked);
        return script;
      });
    },
    [setUpsertScript]
  );

  const handleClose = useCallback(
    (options?: { noMoreUpdates: boolean }) => {
      const { noMoreUpdates = false } = options || {};
      if (noMoreUpdates && scriptInfo && !scriptInfo.userSubscribe) {
        scriptClient.setCheckUpdateUrl(scriptInfo.uuid, false);
      }
      closeWindow();
    },
    [scriptInfo]
  );

  const fileWatchMessageId = `id_${Math.random()}`;

  async function onWatchFileCodeChanged(this: FTInfo, code: string) {
    if (this.uuid !== scriptInfo?.uuid) return;
    if (this.fileName !== localFileHandle?.name) return;
    setScriptCode(code);
    try {
      await scriptClient.install(upsertScript as Script, code);
    } catch (e) {
      Message.error({
        id: fileWatchMessageId,
        content: t("install_failed") + ": " + e,
      });
      return;
    }
    Message.info({
      id: fileWatchMessageId,
      content: `${t("last_updated")}: ${dayFormat()}`,
      duration: 3000,
      closable: true,
      showIcon: true,
    });
  }

  const memoWatchFile = useMemo(() => {
    return `${watchFile}.${scriptInfo?.uuid}.${localFileHandle?.name}`;
  }, [watchFile, scriptInfo, upsertScript, localFileHandle]);

  useEffect(() => {
    if (!watchFile || !localFileHandle) {
      return;
    }
    // 去除React特性
    const [handle] = [localFileHandle];
    unmountFileTrack(handle); // 避免重覆追踪
    const uuid = scriptInfo?.uuid;
    const fileName = handle?.name;
    if (!uuid || !fileName) {
      return;
    }
    const ftInfo: FTInfo = {
      uuid,
      fileName,
      setCode: onWatchFileCodeChanged,
    };
    console.log(40399100);
    startFileTrack(handle, ftInfo);
    return () => (unmountFileTrack(handle), void 0);
  }, [memoWatchFile]);

  const colSpan = permissions.length ? Math.floor(24 / permissions.length) : 0;
  return (
    <div className="flex flex-col items-stretch pb-2 box-border gap-y-2 min-h-screen">
      <Grid.Row className="shrink-0 grow-0" gutter={8}>
        <Grid.Col flex={1} className="flex-col p-8px">
          <Space direction="vertical" className="w-full">
            <div>
              {upsertScript?.metadata.icon && (
                <Avatar size={32} shape="square" style={{ marginRight: "8px" }}>
                  <img src={upsertScript.metadata.icon[0]} alt={upsertScript?.name} />
                </Avatar>
              )}
              <Typography.Text bold className="text-size-lg">
                {upsertScript && i18nName(upsertScript)}
                <Tooltip
                  content={scriptInfo?.userSubscribe ? t("subscribe_source_tooltip") : t("script_status_tooltip")}
                >
                  <Switch style={{ marginLeft: "8px" }} checked={enable} onChange={handleStatusChange} />
                </Tooltip>
              </Typography.Text>
            </div>
            <div>
              <Typography.Text bold>{upsertScript && i18nDescription(upsertScript)}</Typography.Text>
            </div>
            <div>
              <Typography.Text bold>
                {t("author")}: {metadata.author}
              </Typography.Text>
            </div>
            <div>
              <Typography.Text
                bold
                style={{
                  overflowWrap: "break-word",
                  wordBreak: "break-all",
                  maxHeight: "70px",
                  display: "block",
                  overflowY: "auto",
                }}
              >
                {t("source")}: {scriptInfo?.url}
              </Typography.Text>
            </div>
            <div className="text-end">
              <Space>
                <Button.Group>
                  <Button type="primary" size="small" onClick={() => handleInstall()}>
                    {btnText}
                  </Button>
                  <Dropdown
                    droplist={
                      <Menu>
                        <Menu.Item key="install-no-close" onClick={() => handleInstall({ closeAfterInstall: false })}>
                          {isUpdate ? t("update_script_no_close") : t("install_script_no_close")}
                        </Menu.Item>
                        {!scriptInfo?.userSubscribe && (
                          <Menu.Item key="install-no-updates" onClick={() => handleInstall({ noMoreUpdates: true })}>
                            {isUpdate ? t("update_script_no_more_update") : t("install_script_no_more_update")}
                          </Menu.Item>
                        )}
                      </Menu>
                    }
                    position="bottom"
                  >
                    <Button type="primary" size="small" icon={<IconDown />} />
                  </Dropdown>
                </Button.Group>
                {localFile && (
                  <Popover content={t("watch_file_description")}>
                    <Button
                      type="secondary"
                      size="small"
                      onClick={() => {
                        setWatchFile((prev) => !prev);
                      }}
                    >
                      {watchFile ? t("stop_watch_file") : t("watch_file")}
                    </Button>
                  </Popover>
                )}
                {isUpdate ? (
                  <Button.Group>
                    <Button type="primary" status="danger" size="small" onClick={() => handleClose()}>
                      {t("close")}
                    </Button>
                    <Dropdown
                      droplist={
                        <Menu>
                          {!scriptInfo?.userSubscribe && (
                            <Menu.Item key="install-no-updates" onClick={() => handleClose({ noMoreUpdates: true })}>
                              {t("close_update_script_no_more_update")}
                            </Menu.Item>
                          )}
                        </Menu>
                      }
                      position="bottom"
                    >
                      <Button type="primary" status="danger" size="small" icon={<IconDown />} />
                    </Dropdown>
                  </Button.Group>
                ) : (
                  <Button type="primary" status="danger" size="small" onClick={() => handleClose()}>
                    {t("close")}
                  </Button>
                )}
              </Space>
            </div>
          </Space>
        </Grid.Col>
        <Grid.Col flex={1} className="p-8px">
          <Space direction="vertical">
            <div>
              <Space>
                {oldScript && (
                  <Tooltip content={`${t("current_version")}: v${oldScript.metadata.version![0]}`}>
                    <Tag bordered>{oldScript.metadata.version![0]}</Tag>
                  </Tooltip>
                )}
                {metadata.version && (
                  <Tooltip color="red" content={`${t("update_version")}: v${metadata.version[0]}`}>
                    <Tag bordered color="red">
                      {metadata.version[0]}
                    </Tag>
                  </Tooltip>
                )}
                {(metadata.background || metadata.crontab) && (
                  <Tooltip color="green" content={t("background_script_tag")}>
                    <Tag bordered color="green">
                      {t("background_script")}
                    </Tag>
                  </Tooltip>
                )}
                {metadata.crontab && (
                  <Tooltip color="green" content={t("scheduled_script_tag")}>
                    <Tag bordered color="green">
                      {t("scheduled_script")}
                    </Tag>
                  </Tooltip>
                )}
                {metadata.antifeature &&
                  metadata.antifeature.map((antifeature) => {
                    const item = antifeature.split(" ")[0];
                    return (
                      antifeatures[item] && (
                        <Tooltip color={antifeatures[item].color} content={antifeatures[item].description}>
                          <Tag bordered color={antifeatures[item].color}>
                            {antifeatures[item].title}
                          </Tag>
                        </Tooltip>
                      )
                    );
                  })}
              </Space>
            </div>
            {description && description}
            <div>
              <Typography.Text type="error">{t("install_from_legitimate_sources_warning")}</Typography.Text>
            </div>
          </Space>
        </Grid.Col>
        <Grid.Col span={24}>
          <Grid.Row>
            {permissions.map((item) => (
              <Grid.Col
                key={item.label}
                span={colSpan}
                style={{
                  maxHeight: "200px",
                  overflowY: "auto",
                  overflowX: "auto",
                  boxSizing: "border-box",
                }}
                className="p-8px"
              >
                <Typography.Text bold color={item.color}>
                  {item.label}
                </Typography.Text>
                {item.value.map((v) => (
                  <div key={v}>
                    <Typography.Text style={{ wordBreak: "unset", color: item.color }}>{v}</Typography.Text>
                  </div>
                ))}
              </Grid.Col>
            ))}
          </Grid.Row>
        </Grid.Col>
      </Grid.Row>
      <CodeEditor
        id="show-code"
        className="shrink-1 grow-1 m-0 p-0 border-0 overflow-hidden flex flex-col relative min-h-[400px]"
        code={scriptCode || undefined}
        diffCode={diffCode || ""}
      />
    </div>
  );
}

export default App;
