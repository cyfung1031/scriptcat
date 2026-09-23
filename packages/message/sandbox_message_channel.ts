import type { Message, MessageConnect, OnConnectCallback, OnMessageCallback, TMessage } from "./types";
import { MessagePortMessage } from "./message_port_message";

export const SANDBOX_CHANNEL_BOOTSTRAP_TYPE = "scriptcat/sandbox-message-port";
export const SANDBOX_CHANNEL_BOOTSTRAP_VERSION = 1;

type SandboxChannelBootstrap = {
  type: typeof SANDBOX_CHANNEL_BOOTSTRAP_TYPE;
  version: typeof SANDBOX_CHANNEL_BOOTSTRAP_VERSION;
};

const nativeReflectApply = Reflect.apply;
const nativeFunctionBind = Function.prototype.bind;
const bindNative = <T extends (...args: any[]) => any>(fn: T, receiver: any): T =>
  nativeReflectApply(nativeFunctionBind, fn, [receiver]) as T;

const isSandboxChannelBootstrap = (value: unknown): value is SandboxChannelBootstrap => {
  if (value === null || typeof value !== "object") return false;
  const bootstrap = value as Record<string, unknown>;
  return (
    bootstrap.type === SANDBOX_CHANNEL_BOOTSTRAP_TYPE &&
    bootstrap.version === SANDBOX_CHANNEL_BOOTSTRAP_VERSION
  );
};

type PendingListeners = {
  messages: OnMessageCallback[];
  connects: OnConnectCallback[];
};

/**
 * Parent-side Offscreen/EventPage ↔ Sandbox transport.
 *
 * The Window listener exists only long enough to receive one MessagePort from the expected sandbox Window.
 * All real payloads use that private port.
 */
export class SandboxChannelHost implements Message {
  private readonly getTarget: () => Window;
  private readonly bootstrapHandler: EventListener;
  private readonly pending: PendingListeners = { messages: [], connects: [] };
  private delegate?: MessagePortMessage;
  private readonly readyPromise: Promise<void>;
  private resolveReady!: () => void;

  constructor(sourceWindow: Window, target: Window | (() => Window)) {
    this.getTarget = typeof target === "function" ? target : () => target;
    const addWindowListener = bindNative(sourceWindow.addEventListener, sourceWindow);
    const removeWindowListener = bindNative(sourceWindow.removeEventListener, sourceWindow);
    this.readyPromise = new Promise<void>((resolve) => {
      this.resolveReady = resolve;
    });

    this.bootstrapHandler = ((event: MessageEvent) => {
      if (this.delegate) return;

      let expectedSource: Window;
      try {
        expectedSource = this.getTarget();
      } catch {
        return;
      }
      if (event.source !== expectedSource) return;
      if (!isSandboxChannelBootstrap(event.data)) return;
      if (event.ports.length !== 1 || !event.ports[0]) return;

      const delegate = new MessagePortMessage(event.ports[0]);
      this.delegate = delegate;
      removeWindowListener("message", this.bootstrapHandler);

      for (let i = 0; i < this.pending.messages.length; i += 1) {
        delegate.onMessage(this.pending.messages[i]);
      }
      for (let i = 0; i < this.pending.connects.length; i += 1) {
        delegate.onConnect(this.pending.connects[i]);
      }
      this.pending.messages.length = 0;
      this.pending.connects.length = 0;
      this.resolveReady();
    }) as EventListener;

    addWindowListener("message", this.bootstrapHandler);
  }

  ready(): Promise<void> {
    return this.readyPromise;
  }

  async connect(data: TMessage): Promise<MessageConnect> {
    await this.readyPromise;
    if (!this.delegate) throw new Error("Sandbox channel is unavailable.");
    return this.delegate.connect(data);
  }

  async sendMessage<T = any>(data: TMessage): Promise<T> {
    await this.readyPromise;
    if (!this.delegate) throw new Error("Sandbox channel is unavailable.");
    return this.delegate.sendMessage<T>(data);
  }

  onConnect(callback: OnConnectCallback): void {
    if (this.delegate) {
      this.delegate.onConnect(callback);
      return;
    }
    this.pending.connects.push(callback);
  }

  onMessage(callback: OnMessageCallback): void {
    if (this.delegate) {
      this.delegate.onMessage(callback);
      return;
    }
    this.pending.messages.push(callback);
  }
}

export type SandboxChannelClient = {
  message: MessagePortMessage;
  transferToParent(): void;
};

/**
 * Build the private channel inside the sandbox. transferToParent() is called only after Server/Runtime
 * listeners are wired, so receiving the port is also the parent's sandbox-ready signal.
 */
export const createSandboxChannelClient = (
  parentWindow: Window = parent,
  channel: MessageChannel = new MessageChannel()
): SandboxChannelClient => {
  const message = new MessagePortMessage(channel.port1);
  const parentPostMessage = bindNative(parentWindow.postMessage, parentWindow) as (
    message: unknown,
    targetOrigin: string,
    transfer?: Transferable[]
  ) => void;
  let transferred = false;

  return {
    message,
    transferToParent() {
      if (transferred) throw new Error("Sandbox channel has already been transferred.");
      transferred = true;
      parentPostMessage(
        {
          type: SANDBOX_CHANNEL_BOOTSTRAP_TYPE,
          version: SANDBOX_CHANNEL_BOOTSTRAP_VERSION,
        } satisfies SandboxChannelBootstrap,
        "*",
        [channel.port2]
      );
    },
  };
};
