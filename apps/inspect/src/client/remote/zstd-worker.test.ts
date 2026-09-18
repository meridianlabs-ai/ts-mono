import { afterEach, beforeEach, expect, test, vi } from "vitest";

const workers: TestWorker[] = [];
let failInit: "error" | "messageerror" | "response" | "send" | undefined;
let holdRequests = false;
let failSend = false;

class TestWorker extends EventTarget {
  readonly terminate = vi.fn();

  constructor() {
    super();
    workers.push(this);
  }

  postMessage(message: { type: string; requestId?: number }): void {
    if (message.type === "init") {
      if (failInit === "send") throw new Error("Init send failed");
      queueMicrotask(() => {
        if (failInit === "error" || failInit === "messageerror") {
          this.dispatchEvent(
            Object.assign(new Event(failInit), { message: "Init failed" })
          );
        } else {
          this.dispatchEvent(
            new MessageEvent("message", {
              data: {
                type: "init_complete",
                success: failInit !== "response",
                error: "Init failed",
              },
            })
          );
        }
      });
    } else if (failSend) {
      throw new Error("Send failed");
    } else if (!holdRequests) {
      queueMicrotask(() =>
        this.dispatchEvent(
          new MessageEvent("message", {
            data: {
              requestId: message.requestId,
              success: true,
              data: new Uint8Array([65]),
            },
          })
        )
      );
    }
  }
}

beforeEach(() => {
  vi.resetModules();
  workers.length = 0;
  failInit = undefined;
  holdRequests = false;
  failSend = false;
  vi.stubGlobal("Worker", TestWorker);
});

afterEach(() => vi.unstubAllGlobals());

async function read() {
  const { decompressZstd } = await import("./zstd-worker");
  // One output byte with a 1 MiB window selects the worker without a large fixture.
  return decompressZstd(
    new Uint8Array([0x28, 0xb5, 0x2f, 0xfd, 0, 80, 9, 0, 0, 65]),
    1
  );
}

test.each(["error", "messageerror", "response", "send"] as const)(
  "rejects initialization failure (%s) and retries on the next read",
  async (failure) => {
    failInit = failure;
    await expect(read()).rejects.toThrow();
    expect(workers[0]?.terminate).toHaveBeenCalledOnce();
    failInit = undefined;
    expect(await read()).toEqual(new Uint8Array([65]));
    expect(workers).toHaveLength(2);
  }
);

test.each(["error", "messageerror"])(
  "rejects all pending requests after %s and replaces the worker",
  async (failure) => {
    holdRequests = true;
    const first = expect(read()).rejects.toThrow();
    const second = expect(read()).rejects.toThrow();
    await vi.waitFor(() => expect(workers).toHaveLength(1));
    workers[0]?.dispatchEvent(
      Object.assign(new Event(failure), { message: "Worker failed" })
    );
    await Promise.all([first, second]);
    expect(workers[0]?.terminate).toHaveBeenCalledOnce();
    holdRequests = false;
    expect(await read()).toEqual(new Uint8Array([65]));
    expect(workers).toHaveLength(2);
  }
);

test("rejects a failed request transfer without blocking the next read", async () => {
  failSend = true;
  await expect(read()).rejects.toThrow("Send failed");
  failSend = false;
  expect(await read()).toEqual(new Uint8Array([65]));
  expect(workers).toHaveLength(1);
});
