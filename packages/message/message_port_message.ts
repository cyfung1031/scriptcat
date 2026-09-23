import { uuidv4 } from "@App/pkg/utils/uuid";
import EventEmitter from "eventemitter3";
import type {
  Message,
  MessageConnect,
  OnConnectCallback,
  OnMessageCallback,
  RuntimeMessageSender,
  TMessage,
} from "./types";
import {
  WindowMessageConnect,
  parseWindowMessageBody,
  type PostMessage,
  type WindowMessageBody,
} from "./window_message";

const nativeReflectApply = Reflect.apply;
const nativeFunctionBind = Function.prototype.bind;
const bindNative = <T extends (...args: any[]) => any>(fn: T, receiver: any): T =>
  nativeReflectApply(nativeFunctionBind, fn, [receiver]) as T;

class MessagePortPostMessage implements PostMessage {
  private readonly post: (message: unknown) => void;

  constructor(port: MessagePort) {
    this.post = bindNative(port.postMessage, port) as (message: unknown) => void;
  }

  postMessage<T = any>(message: T): void {
    this.post(message);
  }
}

/**
 * Message implementation backed by a private MessagePort.
 *
 * It keeps the existing WindowMessage envelope so Server/Client/MessageConnect behavior stays unchanged,
 * but packets are visible only to code that holds the port reference.
 */
export class MessagePortMessage implements Message {
  readonly EE = new EventEmitter<string, any>();

  private readonly target: PostMessage;

  constructor(port: MessagePort) {
    const addMessageListener = bindNative(port.addEventListener, port);
    const startPort = bindNative(port.start, port);
    this.target = new MessagePortPostMessage(port);
    addMessageListener(
      "message",
      ((event: MessageEvent) => {
        this.messageHandle(event.data);
      }) as EventListener
    );
    startPort();
  }

  private messageHandle(value: unknown) {
    const data = parseWindowMessageBody(value);
    if (!data) return;

    if (data.type === "sendMessage") {
      this.EE.emit(
        "message",
        data.data,
        (resp: any) => {
          if (!data.messageId) return;
          this.target.postMessage({
            messageId: data.messageId,
            type: "respMessage",
            data: resp,
          } satisfies WindowMessageBody);
        },
        {} as RuntimeMessageSender
      );
    } else if (data.type === "respMessage") {
      this.EE.emit(`response:${data.messageId}`, data);
    } else if (data.type === "connect") {
      this.EE.emit("connect", data.data, new WindowMessageConnect(data.messageId, this.EE, this.target));
    } else if (data.type === "disconnect") {
      this.EE.emit(`disconnect:${data.messageId}`);
    } else if (data.type === "connectMessage") {
      this.EE.emit(`connectMessage:${data.messageId}`, data.data);
    }
  }

  onConnect(callback: OnConnectCallback): void {
    this.EE.addListener("connect", callback);
  }

  connect(data: TMessage): Promise<MessageConnect> {
    const messageId = uuidv4();
    this.target.postMessage({
      messageId,
      type: "connect",
      data,
    } satisfies WindowMessageBody<TMessage>);
    return Promise.resolve(new WindowMessageConnect(messageId, this.EE, this.target));
  }

  onMessage(callback: OnMessageCallback): void {
    this.EE.addListener("message", callback);
  }

  sendMessage<T = any>(data: TMessage): Promise<T> {
    return new Promise<T>((resolve) => {
      const messageId = uuidv4();
      const eventId = `response:${messageId}`;
      this.EE.addListener(eventId, (body: WindowMessageBody<T>) => {
        this.EE.removeAllListeners(eventId);
        resolve(body.data as T);
      });
      this.target.postMessage({
        messageId,
        type: "sendMessage",
        data,
      } satisfies WindowMessageBody<TMessage>);
    });
  }
}
