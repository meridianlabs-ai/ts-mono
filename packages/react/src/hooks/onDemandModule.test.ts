import { describe, expect, it, vi } from "vitest";

import { onDemandModule } from "./onDemandModule";

describe("onDemandModule", () => {
  it("loads once and reuses the module", async () => {
    const importer = vi.fn(() => Promise.resolve({ value: 1 }));
    const module = onDemandModule(importer);
    expect(module.loaded()).toBeUndefined();
    await module.load();
    await module.load();
    expect(importer).toHaveBeenCalledTimes(1);
    expect(module.loaded()).toEqual({ value: 1 });
  });

  it("retries after a failed load", async () => {
    const importer = vi
      .fn<() => Promise<{ value: number }>>()
      .mockRejectedValueOnce(new Error("chunk load failed"))
      .mockResolvedValueOnce({ value: 2 });
    const module = onDemandModule(importer);
    await expect(module.load()).rejects.toThrow("chunk load failed");
    expect(module.loaded()).toBeUndefined();
    await expect(module.load()).resolves.toEqual({ value: 2 });
    expect(importer).toHaveBeenCalledTimes(2);
  });
});
