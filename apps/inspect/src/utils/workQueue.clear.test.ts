import { describe, expect, it, vi } from "vitest";

import { WorkQueue } from "./workQueue";

describe("WorkQueue.clear", () => {
  it("does not retry or complete work cleared while in flight", async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const attempts: string[] = [];
    const settled: string[] = [];

    const queue = new WorkQueue<string, string>({
      name: "t",
      concurrency: 1,
      processingDelay: 0,
      maxRetries: 2,
      getId: (item) => item,
      worker: async (items) => {
        attempts.push(...items);
        if (items.includes("A")) {
          await gate;
          return items.map(() => ({
            ok: false as const,
            error: new Error("retry"),
          }));
        }
        return items.map((item) => ({ ok: true as const, value: item }));
      },
      onComplete: (_results, inputs) => {
        settled.push(...inputs);
        return Promise.resolve();
      },
    });

    queue.enqueue(["A"]);
    await vi.waitFor(() => expect(attempts).toEqual(["A"]));

    queue.clear();
    queue.enqueue(["B"]);
    release?.();

    await vi.waitFor(() => expect(queue.isProcessing).toBe(false));

    expect(attempts).toEqual(["A", "B"]);
    expect(settled).toEqual(["B"]);
    expect(queue.size).toBe(0);
  });
});
