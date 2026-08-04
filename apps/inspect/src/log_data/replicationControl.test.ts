import { beforeEach, describe, expect, test, vi } from "vitest";

import type { AppConfig } from "../app_config";

// The activation lifecycle under test is module state (the current
// activation, waiters, pending sync), so every test re-imports a fresh module
// via `control()` after `vi.resetModules()`. Collaborators are mocked at the
// seams `startEngine` composes: the engine, the database open, the listing
// sync.

const h = vi.hoisted(() => ({
  getAppConfig: vi.fn(),
  stop: vi.fn(),
  start: vi.fn(),
  ensure: vi.fn(),
  openDatabase: vi.fn(),
  touchSyncScope: vi.fn(),
  syncListing: vi.fn(),
}));

vi.mock("../app_config", () => ({ getAppConfig: h.getAppConfig }));
vi.mock("./fetchEngine", () => ({
  fetchEngine: { stop: h.stop, start: h.start, ensure: h.ensure },
}));
vi.mock("./databaseServiceInstance", () => ({
  getDatabaseService: () => ({
    openDatabase: h.openDatabase,
    touchSyncScope: h.touchSyncScope,
  }),
}));
vi.mock("./listingSync", () => ({ syncListing: h.syncListing }));
vi.mock("./logsContent", () => ({ createLogsContentSink: () => ({}) }));

const control = () => import("./replicationControl");

const configFor = (logDir: string): AppConfig =>
  ({
    logDir,
    api: { __dir: logDir },
    singleFileMode: false,
  }) as unknown as AppConfig;

beforeEach(() => {
  vi.resetModules();
  h.getAppConfig.mockReset().mockReturnValue({ singleFileMode: false });
  h.stop.mockReset();
  h.start.mockReset().mockResolvedValue(undefined);
  h.ensure.mockReset().mockResolvedValue(undefined);
  h.openDatabase.mockReset().mockResolvedValue(undefined);
  h.touchSyncScope.mockReset().mockResolvedValue(undefined);
  h.syncListing.mockReset().mockResolvedValue([]);
});

describe("fetch engine activation lifecycle", () => {
  test("a caller racing ahead of the first activation waits for it", async () => {
    const { activateFetchEngine, syncLogs } = await control();

    const pending = syncLogs("dirA");
    activateFetchEngine(configFor("dirA"));

    await expect(pending).resolves.toEqual([]);
    expect(h.syncListing).toHaveBeenCalledTimes(1);
  });

  test("a failed activation is retried on the next acquisition", async () => {
    // A transient IndexedDB failure at activation must not pin the session
    // broken — the listing query polls, so the next tick should re-attempt
    // the start instead of re-awaiting the same rejection.
    h.openDatabase.mockRejectedValueOnce(new Error("idb hiccup"));
    const { activateFetchEngine, syncLogs } = await control();

    activateFetchEngine(configFor("dirA"));
    await expect(syncLogs("dirA")).rejects.toThrow(
      /Database service not available/
    );
    expect(h.start).not.toHaveBeenCalled();

    await expect(syncLogs("dirA")).resolves.toEqual([]);
    expect(h.start).toHaveBeenCalledTimes(1);
  });

  test("fetchLog rejects when a dir switch lands while its activation settles", async () => {
    // Hold dirA's activation open across the database open, switch to dirB,
    // then release: the resumed caller must not fetch into dirB's engine.
    let releaseA!: () => void;
    h.openDatabase.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          releaseA = resolve;
        })
    );
    const { activateFetchEngine, deactivateFetchEngine, fetchLog } =
      await control();

    activateFetchEngine(configFor("dirA"));
    const pending = fetchLog("dirA", "file.eval");

    deactivateFetchEngine();
    activateFetchEngine(configFor("dirB"));
    releaseA();

    await expect(pending).rejects.toThrow(/not active for dirA/);
    expect(h.ensure).not.toHaveBeenCalled();
  });

  test("syncLogs rejects when a dir switch lands while its activation settles", async () => {
    let releaseA!: () => void;
    h.openDatabase.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          releaseA = resolve;
        })
    );
    const { activateFetchEngine, deactivateFetchEngine, syncLogs } =
      await control();

    activateFetchEngine(configFor("dirA"));
    const pending = syncLogs("dirA");

    deactivateFetchEngine();
    activateFetchEngine(configFor("dirB"));
    releaseA();

    await expect(pending).rejects.toThrow(/not active for dirA/);
    expect(h.syncListing).not.toHaveBeenCalled();
  });

  test("a superseded activation never wires the engine", async () => {
    // Hold dirA's activation open across the database open, switch to dirB,
    // then release: dirA's start must bail before touching the engine —
    // otherwise whichever continuation lands last wins, leaving the engine
    // wired for dirA while activation.config claims dirB.
    let releaseA!: () => void;
    h.openDatabase.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          releaseA = resolve;
        })
    );
    const { activateFetchEngine, deactivateFetchEngine, syncLogs } =
      await control();

    activateFetchEngine(configFor("dirA"));
    deactivateFetchEngine();
    activateFetchEngine(configFor("dirB"));
    releaseA();
    await expect(syncLogs("dirB")).resolves.toEqual([]);
    // Let dirA's released continuation fully settle before asserting.
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(h.start).toHaveBeenCalledTimes(1);
    expect(h.start.mock.calls[0]?.[0]).toMatchObject({ logDir: "dirB" });
  });

  test("an activation resuming after a final deactivation never touches the engine", async () => {
    let releaseA!: () => void;
    h.openDatabase.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          releaseA = resolve;
        })
    );
    const { activateFetchEngine, deactivateFetchEngine } = await control();

    activateFetchEngine(configFor("dirA"));
    deactivateFetchEngine();
    releaseA();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(h.start).not.toHaveBeenCalled();
  });

  test("acquisition after a final deactivation rejects instead of hanging", async () => {
    const { activateFetchEngine, deactivateFetchEngine, syncLogs } =
      await control();

    activateFetchEngine(configFor("dirA"));
    await syncLogs("dirA");
    deactivateFetchEngine();

    await expect(syncLogs("dirA")).rejects.toThrow(/not active for dirA/);
  });

  test("stale-dir acquisition rejects while the active dir's engine runs", async () => {
    const { activateFetchEngine, syncLogs, fetchLog } = await control();

    activateFetchEngine(configFor("dirB"));

    await expect(syncLogs("dirA")).rejects.toThrow(/not active for dirA/);
    await expect(fetchLog("dirA", "file.eval")).rejects.toThrow(
      /not active for dirA/
    );
    await expect(syncLogs("dirB")).resolves.toEqual([]);
  });
});
