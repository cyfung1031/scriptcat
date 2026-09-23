import { describe, expect, it, vi } from "vitest";
import { MessagePortMessage } from "./message_port_message";
import {
  SANDBOX_CHANNEL_BOOTSTRAP_TYPE,
  SANDBOX_CHANNEL_BOOTSTRAP_VERSION,
  SandboxChannelHost,
} from "./sandbox_message_channel";

class FakePort {
  peer?: FakePort;
  private listeners = new Set<EventListenerOrEventListenerObject>();

  postMessage = (data: unknown) => {
    const event = { data } as MessageEvent;
    queueMicrotask(() => this.peer?.dispatch(event));
  };

  addEventListener = (_type: string, listener: EventListenerOrEventListenerObject) => {
    this.listeners.add(listener);
  };

  start = vi.fn();

  private dispatch(event: MessageEvent) {
    for (const listener of this.listeners) {
      if (typeof listener === "function") listener(event);
      else listener.handleEvent(event);
    }
  }
}

const makePortPair = () => {
  const a = new FakePort();
  const b = new FakePort();
  a.peer = b;
  b.peer = a;
  return [a as unknown as MessagePort, b as unknown as MessagePort] as const;
};

class FakeWindow {
  private listeners = new Set<EventListenerOrEventListenerObject>();

  addEventListener = (_type: string, listener: EventListenerOrEventListenerObject) => {
    this.listeners.add(listener);
  };

  removeEventListener = (_type: string, listener: EventListenerOrEventListenerObject) => {
    this.listeners.delete(listener);
  };

  dispatchMessage(event: MessageEvent) {
    for (const listener of this.listeners) {
      if (typeof listener === "function") listener(event);
      else listener.handleEvent(event);
    }
  }

  listenerCount() {
    return this.listeners.size;
  }
}

describe("MessagePortMessage", () => {
  it("preserves request/response semantics without a Window message bus", async () => {
    const [leftPort, rightPort] = makePortPair();
    const left = new MessagePortMessage(leftPort);
    const right = new MessagePortMessage(rightPort);
    right.onMessage((data, sendResponse) => {
      sendResponse({ code: 0, data: data.data });
    });

    await expect(left.sendMessage({ action: "sandbox/ping", data: "pong" })).resolves.toEqual({
      code: 0,
      data: "pong",
    });
  });

  it("preserves scoped MessageConnect traffic", async () => {
    const [leftPort, rightPort] = makePortPair();
    const left = new MessagePortMessage(leftPort);
    const right = new MessagePortMessage(rightPort);
    const received = vi.fn();
    right.onConnect((_data, connection) => connection.onMessage(received));

    const connection = await left.connect({ action: "sandbox/connect" });
    connection.sendMessage({ action: "sandbox/chunk", data: 1 });
    await Promise.resolve();

    expect(received).toHaveBeenCalledWith({ action: "sandbox/chunk", data: 1 });
  });
});

describe("SandboxChannelHost", () => {
  it("accepts one port only from the expected sandbox Window, then removes the Window listener", async () => {
    const parentWindow = new FakeWindow();
    const expectedSandbox = {} as Window;
    const hostileSandbox = {} as Window;
    const host = new SandboxChannelHost(parentWindow as unknown as Window, expectedSandbox);
    const [sandboxPort, parentPort] = makePortPair();
    const sandboxMessage = new MessagePortMessage(sandboxPort);

    parentWindow.dispatchMessage({
      source: hostileSandbox,
      data: { type: SANDBOX_CHANNEL_BOOTSTRAP_TYPE, version: SANDBOX_CHANNEL_BOOTSTRAP_VERSION },
      ports: [parentPort],
    } as unknown as MessageEvent);
    expect(parentWindow.listenerCount()).toBe(1);

    parentWindow.dispatchMessage({
      source: expectedSandbox,
      data: { type: SANDBOX_CHANNEL_BOOTSTRAP_TYPE, version: 0 },
      ports: [parentPort],
    } as unknown as MessageEvent);
    expect(parentWindow.listenerCount()).toBe(1);

    parentWindow.dispatchMessage({
      source: expectedSandbox,
      data: { type: SANDBOX_CHANNEL_BOOTSTRAP_TYPE, version: SANDBOX_CHANNEL_BOOTSTRAP_VERSION },
      ports: [parentPort],
    } as unknown as MessageEvent);

    await host.ready();
    expect(parentWindow.listenerCount()).toBe(0);

    const received = vi.fn((_data, sendResponse) => sendResponse({ code: 0, data: "ok" }));
    host.onMessage(received);
    await expect(sandboxMessage.sendMessage({ action: "offscreen/ping" })).resolves.toEqual({
      code: 0,
      data: "ok",
    });
  });
});
