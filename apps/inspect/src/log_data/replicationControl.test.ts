import Dexie from "dexie";
import { afterEach, describe, expect, test, vi } from "vitest";

import { LogFilesResponse } from "@tsmono/inspect-common/types";

import type { AppConfig } from "../app_config";
import { DB_NAME } from "../client/database";

import "../test/testApp";
import "./replicationControl";

import { testClientAPI, testLogDetails } from "./testFixtures";

// Activation state is module-level, so each test loads a fresh module graph.
// The side-effect imports keep its cold compile out of the first test's timeout.

let teardown: (() => Promise<void>) | undefined;

const load = async () => {
  vi.resetModules();
  const control = await import("./replicationControl");
  const { fetchEngine } = await import("./fetchEngine");
  const { OpenDatabase } = await import("../client/database");
  const { releaseDatabase } = await import("./databaseInstance");
  const { startTestApp } = await import("../test/testApp");

  const realOpen = OpenDatabase.open.bind(OpenDatabase);
  const open = vi.spyOn(OpenDatabase, "open");
  const start = vi.spyOn(fetchEngine, "start");
  const getLogs = vi.fn(() =>
    Promise.resolve<LogFilesResponse>({ files: [], response_type: "full" })
  );
  const getLogDetails = vi.fn(() => Promise.resolve(testLogDetails()));

  // syncLogs reads the resolved config's mode, as below the gate.
  const configFor = (logDir: string): AppConfig =>
    startTestApp({
      logDir,
      api: testClientAPI({
        get_logs: getLogs,
        get_log_details: getLogDetails,
      }),
      singleFileMode: false,
    });

  /** Hold the next database open until the returned release is called. */
  const holdNextOpen = (): (() => void) => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    open.mockImplementationOnce(async () => {
      await gate;
      return realOpen();
    });
    return () => release();
  };

  teardown = async () => {
    control.deactivateFetchEngine();
    await releaseDatabase();
    await Dexie.delete(DB_NAME);
  };

  return {
    ...control,
    configFor,
    holdNextOpen,
    open,
    start,
    getLogs,
    getLogDetails,
  };
};

afterEach(async () => {
  await teardown?.();
  teardown = undefined;
  vi.restoreAllMocks();
});

describe("fetch engine activation lifecycle", () => {
  test("a caller racing ahead of the first activation waits for it", async () => {
    const { activateFetchEngine, syncLogs, configFor, getLogs } = await load();

    // The config resolves at the gate, before any acquisition can run.
    const config = configFor("dirA");
    const pending = syncLogs("dirA");
    activateFetchEngine(config);

    await expect(pending).resolves.toEqual([]);
    expect(getLogs).toHaveBeenCalledTimes(1);
  });

  test("a failed activation is retried on the next acquisition", async () => {
    // A transient IndexedDB failure at activation must not pin the session
    // broken — the listing query polls, so the next tick should re-attempt
    // the start instead of re-awaiting the same rejection.
    const { activateFetchEngine, syncLogs, configFor, open, start } =
      await load();
    open.mockRejectedValueOnce(new Error("idb hiccup"));

    activateFetchEngine(configFor("dirA"));
    await expect(syncLogs("dirA")).rejects.toThrow(
      /Database service not available/
    );
    expect(start).not.toHaveBeenCalled();

    await expect(syncLogs("dirA")).resolves.toEqual([]);
    expect(start).toHaveBeenCalledTimes(1);
  });

  test("a single-file activation starts the engine with no database", async () => {
    // The engine's contract (FetchEngineDeps.database) spells "no
    // persistence" as null; passing the unopened service instead made
    // beginFetch probe a closed database on every fetch (#518).
    const { activateFetchEngine, fetchLog, configFor, open, start } =
      await load();

    activateFetchEngine({ ...configFor("dirA"), singleFileMode: true });
    await fetchLog("dirA", "file.eval");

    expect(open).not.toHaveBeenCalled();
    expect(start).toHaveBeenCalledTimes(1);
    expect(start.mock.calls[0]?.[0]).toMatchObject({ database: null });
  });

  test("fetchLog rejects when a dir switch lands while its activation settles", async () => {
    // Hold dirA's activation open across the database open, switch to dirB,
    // then release: the resumed caller must not fetch into dirB's engine.
    const {
      activateFetchEngine,
      deactivateFetchEngine,
      fetchLog,
      configFor,
      holdNextOpen,
      getLogDetails,
    } = await load();
    const releaseA = holdNextOpen();

    activateFetchEngine(configFor("dirA"));
    const pending = fetchLog("dirA", "file.eval");

    deactivateFetchEngine();
    activateFetchEngine(configFor("dirB"));
    releaseA();

    await expect(pending).rejects.toThrow(/not active for dirA/);
    expect(getLogDetails).not.toHaveBeenCalled();
  });

  test("syncLogs rejects when a dir switch lands while its activation settles", async () => {
    const {
      activateFetchEngine,
      deactivateFetchEngine,
      syncLogs,
      configFor,
      holdNextOpen,
      getLogs,
    } = await load();
    const releaseA = holdNextOpen();

    activateFetchEngine(configFor("dirA"));
    const pending = syncLogs("dirA");

    deactivateFetchEngine();
    activateFetchEngine(configFor("dirB"));
    releaseA();

    await expect(pending).rejects.toThrow(/not active for dirA/);
    expect(getLogs).not.toHaveBeenCalled();
  });

  test("a superseded activation never wires the engine", async () => {
    // Hold dirA's activation open across the database open, switch to dirB,
    // then release: dirA's start must bail before touching the engine —
    // otherwise whichever continuation lands last wins, leaving the engine
    // wired for dirA while activation.config claims dirB.
    const {
      activateFetchEngine,
      deactivateFetchEngine,
      syncLogs,
      configFor,
      holdNextOpen,
      open,
      start,
    } = await load();
    const releaseA = holdNextOpen();

    activateFetchEngine(configFor("dirA"));
    deactivateFetchEngine();
    activateFetchEngine(configFor("dirB"));
    releaseA();
    await expect(syncLogs("dirB")).resolves.toEqual([]);
    // Wait out dirA's held open (the first), then its resumed start.
    await open.mock.results[0]?.value;
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(start).toHaveBeenCalledTimes(1);
    expect(start.mock.calls[0]?.[0]).toMatchObject({ logDir: "dirB" });
  });

  test("an activation resuming after a final deactivation never touches the engine", async () => {
    const {
      activateFetchEngine,
      deactivateFetchEngine,
      holdNextOpen,
      configFor,
      open,
      start,
    } = await load();
    const releaseA = holdNextOpen();

    activateFetchEngine(configFor("dirA"));
    deactivateFetchEngine();
    releaseA();
    // The held open completes, then the resumed start sees the bumped epoch.
    await vi.waitFor(() => expect(open).toHaveResolved());
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(start).not.toHaveBeenCalled();
  });

  test("a same-dir remount resolves the waiter queued against the first mount", async () => {
    // StrictMode (and a failed-start retry) deactivates and re-activates the
    // same dir. A caller that queued before the first activation holds mount
    // #1's promise, and react-query won't re-invoke queryFn on remount — so
    // mount #1 resuming into a bumped epoch must adopt the live activation
    // rather than reject, or the listing stays broken until the next poll.
    const {
      activateFetchEngine,
      deactivateFetchEngine,
      syncLogs,
      configFor,
      holdNextOpen,
      start,
    } = await load();
    const releaseFirst = holdNextOpen();

    // The config resolves at the gate, before any acquisition can run.
    const config = configFor("dirA");
    const pending = syncLogs("dirA");
    activateFetchEngine(config);

    deactivateFetchEngine();
    activateFetchEngine(configFor("dirA"));
    releaseFirst();

    await expect(pending).resolves.toEqual([]);
    expect(start).toHaveBeenCalledTimes(1);
    expect(start.mock.calls[0]?.[0]).toMatchObject({ logDir: "dirA" });
  });

  test("acquisition after a final deactivation rejects instead of hanging", async () => {
    const { activateFetchEngine, deactivateFetchEngine, syncLogs, configFor } =
      await load();

    activateFetchEngine(configFor("dirA"));
    await syncLogs("dirA");
    deactivateFetchEngine();

    await expect(syncLogs("dirA")).rejects.toThrow(/not active for dirA/);
  });

  test("stale-dir acquisition rejects while the active dir's engine runs", async () => {
    const { activateFetchEngine, syncLogs, fetchLog, configFor } = await load();

    activateFetchEngine(configFor("dirB"));

    await expect(syncLogs("dirA")).rejects.toThrow(/not active for dirA/);
    await expect(fetchLog("dirA", "file.eval")).rejects.toThrow(
      /not active for dirA/
    );
    await expect(syncLogs("dirB")).resolves.toEqual([]);
  });
});
