import { stackAsyncTask } from "@App/pkg/utils/async_queue";
import { isThisBlobObj } from "@App/pkg/utils/utils";
import { chunkUint8, uint8ToBase64, xmlhttpRequestFn } from "@App/pkg/utils/xhr_api";
import { type MessageConnect, type TMessageCommAction } from "@Packages/message/types";

export const backgroundXhrAPI = (param1: any, inRef: any, msgConn: MessageConnect) => {
  const taskId = `${Date.now}:${Math.random()}`;
  const settings = {
    onDataReceived: (param: { chunk: boolean; type: string; data: any }) => {
      stackAsyncTask(taskId, async () => {
        let buf: Uint8Array<ArrayBufferLike> | undefined;
        if (isThisBlobObj(param.data)) {
          buf = await param.data.bytes();
        } else if (param.data instanceof Uint8Array) {
          buf = param.data;
        }
        if (buf instanceof Uint8Array) {
          const d = buf as Uint8Array<ArrayBuffer>;
          const chunks = chunkUint8(d);
          if (!param.chunk) {
            const msg: TMessageCommAction = {
              action: `reset_chunk_${param.type}`,
              data: {},
            };
            msgConn.sendMessage(msg);
          }
          for (const chunk of chunks) {
            const msg: TMessageCommAction = {
              action: `append_chunk_${param.type}`,
              data: {
                chunk: uint8ToBase64(chunk),
              },
            };
            msgConn.sendMessage(msg);
          }
        } else if (typeof param.data === "string") {
          const d = param.data as string;
          const c = 2 * 1024 * 1024;
          if (!param.chunk) {
            const msg: TMessageCommAction = {
              action: `reset_chunk_${param.type}`,
              data: {},
            };
            msgConn.sendMessage(msg);
          }
          for (let i = 0, l = d.length; i < l; i += c) {
            const chunk = d.substring(i, i + c);
            if (chunk.length) {
              const msg: TMessageCommAction = {
                action: `append_chunk_${param.type}`,
                data: {
                  chunk: chunk,
                },
              };
              msgConn.sendMessage(msg);
            }
          }
        }
      });
    },
    callback: (result: Record<string, any>) => {
      const data = {
        ...result,
        finalUrl: inRef.finalUrl,
        responseHeaders: inRef.responseHeader || result.responseHeaders,
      };
      const msg: TMessageCommAction = {
        action: `on${result.eventType}`,
        data: data,
      };
      stackAsyncTask(taskId, async () => {
        msgConn.sendMessage(msg);
      });
    },
  } as Record<string, any> & { abort?: () => void };
  xmlhttpRequestFn(param1, settings);
  msgConn.onDisconnect(() => {
    settings.abort?.();
    console.warn("msgConn.onDisconnect");
  });
};
