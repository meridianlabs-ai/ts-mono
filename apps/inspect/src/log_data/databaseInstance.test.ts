import Dexie from "dexie";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { DB_NAME } from "../client/database";

// Fresh module state per test: the handle is a module singleton.
const load = async () => {
  const { OpenDatabase } = await import("../client/database");
  const instance = await import("./databaseInstance");
  return { OpenDatabase, ...instance };
};

describe("acquireDatabase", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(async () => {
    const { currentDatabase } = await import("./databaseInstance");
    currentDatabase()?.close();
    await Dexie.delete(DB_NAME);
    vi.restoreAllMocks();
  });

  test("concurrent acquisitions share one open", async () => {
    const { OpenDatabase, acquireDatabase, currentDatabase } = await load();
    const open = vi.spyOn(OpenDatabase, "open");

    expect(currentDatabase()).toBeNull();
    const [a, b] = await Promise.all([acquireDatabase(), acquireDatabase()]);

    expect(open).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
    expect(currentDatabase()).toBe(a);
    expect(await acquireDatabase()).toBe(a);
    expect(open).toHaveBeenCalledTimes(1);
  });

  test("a failed open is retried by the next acquisition", async () => {
    const { OpenDatabase, acquireDatabase, currentDatabase } = await load();
    const open = vi
      .spyOn(OpenDatabase, "open")
      .mockRejectedValueOnce(new Error("idb hiccup"));

    const failed = [acquireDatabase(), acquireDatabase()];
    for (const attempt of failed) {
      await expect(attempt).rejects.toThrow("idb hiccup");
    }
    expect(open).toHaveBeenCalledTimes(1);
    expect(currentDatabase()).toBeNull();

    const db = await acquireDatabase();
    expect(open).toHaveBeenCalledTimes(2);
    expect(currentDatabase()).toBe(db);
  });
});
