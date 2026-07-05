import { describe, expect, it, vi } from "vitest";

import { LogHandle } from "@tsmono/inspect-common";

import { ClientAPI, LogDetails, LogPreview } from "../client/api/types";
import { DatabaseService, LogFetchStateRecord } from "../client/database";
import { WorkResult } from "../utils/workQueue";

import { FetchEngine, FetchEngineDeps, LogsContentSink } from "./fetchEngine";

// --- fakes (no jsdom, no react-query) ---

const makeDetails = (
  name: string,
  status: "success" | "started" | "error" = "success",
  extra: Record<string, unknown> = {}
): LogDetails =>
  ({
    version: 2,
    status,
    eval: { eval_id: name, run_id: `run-${name}`, task: "task", model: "m" },
    sampleSummaries: [],
    ...extra,
  }) as unknown as LogDetails;

const makePreview = (
  name: string,
  status: "success" | "started" = "success"
): LogPreview =>
  ({ eval_id: name, run_id: `run-${name}`, status }) as unknown as LogPreview;

const handle = (name: string, mtime?: number): LogHandle =>
  mtime === undefined ? { name } : { name, mtime };

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}

const deferred = <T>(): Deferred<T> => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

interface FakeApiOptions {
  /** When true, each get_log_details call blocks until released. */
  gated?: boolean;
  failFor?: string[];
  /** Files whose FIRST get_log_details attempt fails (retries succeed). */
  failDetailsOnceFor?: string[];
  /** Files that always fail get_log_summaries_settled (every attempt,
   *  including retries). */
  failSummaryFor?: string[];
  /** Dynamic per-call predicate for get_log_summaries_settled failures — lets
   *  a test flip failure on/off between separate `requestPreview` calls. */
  failSummaryWhen?: (file: string) => boolean;
}

const createFakeApi = (options: FakeApiOptions = {}) => {
  const detailCalls: { file: string; cached: boolean | undefined }[] = [];
  const summaryCalls: string[][] = [];
  const callOrder: string[] = [];
  const gates: Deferred<void>[] = [];

  const api = {
    get_log_details: vi.fn(async (file: string, cached?: boolean) => {
      detailCalls.push({ file, cached });
      callOrder.push(`detail:${file}`);
      if (options.gated) {
        const gate = deferred<void>();
        gates.push(gate);
        await gate.promise;
      }
      if (options.failFor?.includes(file)) {
        throw new Error(`fetch failed: ${file}`);
      }
      if (
        options.failDetailsOnceFor?.includes(file) &&
        detailCalls.filter((call) => call.file === file).length === 1
      ) {
        throw new Error(`transient fetch failure: ${file}`);
      }
      return makeDetails(file);
    }),
    get_log_summaries_settled: vi.fn(
      (files: string[]): Promise<WorkResult<LogPreview>[]> => {
        summaryCalls.push(files);
        callOrder.push(`preview:${files.join(",")}`);
        return Promise.resolve(
          files.map((file) =>
            options.failSummaryFor?.includes(file) ||
            options.failSummaryWhen?.(file)
              ? { ok: false, error: new Error(`summary failed: ${file}`) }
              : { ok: true, value: makePreview(file) }
          )
        );
      }
    ),
  };

  // Releasing a gate lets the worker claim the next item, which opens a new
  // gate asynchronously after the queue's inter-batch delay — so drain on a
  // fixed schedule rather than stopping the moment gates look empty (a gate
  // can still be a beat away from appearing).
  const releaseAll = async () => {
    for (let i = 0; i < 100; i++) {
      while (gates.length > 0) {
        gates.shift()?.resolve();
      }
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  };

  return {
    api: api as unknown as ClientAPI,
    detailCalls,
    summaryCalls,
    callOrder,
    releaseAll,
    gates,
  };
};

interface FakeDbData {
  logs?: LogHandle[];
  previews?: Record<string, LogPreview>;
  details?: Record<string, LogDetails>;
  fetchStates?: Record<string, LogFetchStateRecord>;
}

const createFakeDb = (data: FakeDbData = {}): DatabaseService => {
  const pick = <T>(
    record: Record<string, T> | undefined,
    logs: LogHandle[]
  ): Record<string, T> =>
    Object.fromEntries(
      logs
        .filter((log) => record && log.name in record)
        .map((log) => [log.name, (record as Record<string, T>)[log.name] as T])
    );

  // Mutable so writeFetchStates (relayed from the fake sink) is visible to a
  // later readFetchStates — exercising the real start()-time reset round-trip.
  const fetchStates: Record<string, LogFetchStateRecord> = {
    ...data.fetchStates,
  };

  return {
    opened: () => true,
    readLogs: () => Promise.resolve(data.logs ?? []),
    readLogPreviews: (logs: LogHandle[]) =>
      Promise.resolve(pick(data.previews, logs)),
    readLogDetails: (logs: LogHandle[]) =>
      Promise.resolve(pick(data.details, logs)),
    readLogDetailsForFile: (file: string) =>
      Promise.resolve(data.details?.[file] ?? null),
    // Mirrors the real service: a "started" details row is a mid-run
    // snapshot and doesn't count as cached.
    findMissingDetails: (logs: LogHandle[]) =>
      Promise.resolve(
        logs.filter((log) => {
          const cached = data.details?.[log.name];
          return !cached || cached.status === "started";
        })
      ),
    findMissingPreviews: (logs: LogHandle[]) =>
      Promise.resolve(
        logs.filter((log) => !(log.name in (data.previews ?? {})))
      ),
    readFetchStates: () => Promise.resolve({ ...fetchStates }),
    writeFetchStates: (states: Record<string, LogFetchStateRecord>) => {
      Object.assign(fetchStates, states);
      return Promise.resolve();
    },
    countRows: () => Promise.resolve(0),
  } as unknown as DatabaseService;
};

// `db`, when provided, is a realism relay for writeFetchStates only — mirrors
// how the real sink (logsContent.ts) persists through to IndexedDB, so tests
// can exercise the start()-time reset round-trip without a real database.
const createFakeSink = (db?: DatabaseService) => {
  const calls = {
    setHandles: [] as LogHandle[][],
    mergePreviews: [] as Record<string, LogPreview>[],
    mergeDetails: [] as Record<string, LogDetails>[],
    writeHandles: [] as LogHandle[][],
    writePreviews: [] as Record<string, LogPreview>[],
    writeDetails: [] as Record<string, LogDetails>[],
    mergeFetchStates: [] as Record<string, LogFetchStateRecord>[],
    writeFetchStates: [] as Record<string, LogFetchStateRecord>[],
    // Accumulated view of the latest fetch-state per file, as observed
    // through either merge or write calls — stands in for the cache mirror.
    fetchStates: {} as Record<string, LogFetchStateRecord>,
    clearFile: [] as string[],
    clearPreview: [] as string[],
    clearAll: 0,
  };
  const sink: LogsContentSink = {
    setHandles: (handles) => {
      calls.setHandles.push(handles);
    },
    mergePreviews: (previews) => {
      calls.mergePreviews.push(previews);
    },
    mergeDetails: (details) => {
      calls.mergeDetails.push(details);
    },
    writeHandles: (handles) => {
      calls.writeHandles.push(handles);
      return Promise.resolve(handles);
    },
    writePreviews: (previews) => {
      calls.writePreviews.push(previews);
      return Promise.resolve();
    },
    writeDetails: (details) => {
      calls.writeDetails.push(details);
      return Promise.resolve();
    },
    mergeFetchStates: (states) => {
      calls.mergeFetchStates.push(states);
      Object.assign(calls.fetchStates, states);
    },
    writeFetchStates: async (states) => {
      calls.writeFetchStates.push(states);
      Object.assign(calls.fetchStates, states);
      await db?.writeFetchStates(states);
    },
    clearFile: (name) => {
      calls.clearFile.push(name);
      delete calls.fetchStates[name];
      return Promise.resolve();
    },
    clearPreview: (name) => {
      calls.clearPreview.push(name);
      return Promise.resolve();
    },
    clearAll: () => {
      calls.clearAll++;
      calls.fetchStates = {};
      return Promise.resolve();
    },
  };
  return { sink, calls };
};

const createEngine = async (
  deps: Partial<FetchEngineDeps> & { api: ClientAPI },
  options: ConstructorParameters<typeof FetchEngine>[0] = {}
) => {
  const engine = new FetchEngine({
    flushDelayMs: 0,
    statsDelayMs: 0,
    ...options,
  });
  const { sink, calls } = createFakeSink(deps.database ?? undefined);
  await engine.start({
    api: deps.api,
    database: deps.database ?? null,
    sink: deps.sink ?? sink,
  });
  return { engine, sinkCalls: calls };
};

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

// --- tests ---

describe("FetchEngine.fetch", () => {
  it("fetches a missing log fresh and writes it through the sink (single-file mode: no database, no producer)", async () => {
    const { api, detailCalls } = createFakeApi();
    const { engine, sinkCalls } = await createEngine({ api });

    const details = await engine.fetch("logs/a.eval", "user");

    expect(details).toEqual(makeDetails("logs/a.eval"));
    expect(detailCalls).toEqual([{ file: "logs/a.eval", cached: false }]);
    await vi.waitFor(() => {
      expect(sinkCalls.writeDetails).toEqual([
        { "logs/a.eval": makeDetails("logs/a.eval") },
      ]);
      expect(sinkCalls.mergePreviews.length).toBe(1);
    });
  });

  it("shares one in-flight fetch across concurrent callers", async () => {
    const fake = createFakeApi({ gated: true });
    const { engine } = await createEngine({ api: fake.api });

    const first = engine.fetch("a.eval", "user");
    const second = engine.fetch("a.eval", "user");
    await vi.waitFor(() => expect(fake.detailCalls.length).toBe(1));
    void fake.releaseAll();

    const [firstDetails, secondDetails] = await Promise.all([first, second]);
    expect(firstDetails).toEqual(secondDetails);
    expect(fake.detailCalls.length).toBe(1);
  });

  it("rejects the waiter when the fetch fails", async () => {
    const fake = createFakeApi({ failFor: ["a.eval"] });
    const { engine } = await createEngine({ api: fake.api });

    await expect(engine.fetch("a.eval", "user")).rejects.toThrow(
      "fetch failed: a.eval"
    );
  });

  it("read-through: cached completed details resolve immediately, then refresh in the background", async () => {
    const cached = makeDetails("a.eval", "success", { tags: ["cached"] });
    const fake = createFakeApi();
    const { engine, sinkCalls } = await createEngine({
      api: fake.api,
      database: createFakeDb({ details: { "a.eval": cached } }),
    });

    const details = await engine.fetch("a.eval", "user");

    expect(details).toEqual(cached);
    expect(sinkCalls.mergeDetails).toContainEqual({ "a.eval": cached });
    // The background refresh still fetches fresh data and writes it through.
    await vi.waitFor(() => {
      expect(fake.detailCalls).toEqual([{ file: "a.eval", cached: false }]);
      expect(sinkCalls.writeDetails).toContainEqual({
        "a.eval": makeDetails("a.eval"),
      });
    });
  });

  it("read-through: a cached running log is not served stale", async () => {
    const cached = makeDetails("a.eval", "started");
    const fake = createFakeApi();
    const { engine, sinkCalls } = await createEngine({
      api: fake.api,
      database: createFakeDb({ details: { "a.eval": cached } }),
    });

    const details = await engine.fetch("a.eval", "user");

    expect(details.status).toBe("success");
    expect(sinkCalls.mergeDetails).not.toContainEqual({ "a.eval": cached });
    expect(fake.detailCalls).toEqual([{ file: "a.eval", cached: false }]);
  });

  it("resolves against the listing key when given a relative suffix", async () => {
    const fake = createFakeApi();
    const { engine } = await createEngine({
      api: fake.api,
      database: createFakeDb({ logs: [handle("dir/logs/a.eval", 5)] }),
    });

    await engine.fetch("logs/a.eval", "user");

    expect(fake.detailCalls).toEqual([
      { file: "dir/logs/a.eval", cached: false },
    ]);
  });

  it("user-priority fetches front-run queued background work", async () => {
    const fake = createFakeApi({ gated: true });
    const { engine } = await createEngine(
      { api: fake.api },
      { concurrency: 1 }
    );

    const blocker = engine.fetch("blocker.eval", "background");
    await vi.waitFor(() => expect(fake.detailCalls.length).toBe(1));
    const background = engine.fetch("background.eval", "background");
    const user = engine.fetch("user.eval", "user");
    void fake.releaseAll();
    await Promise.all([blocker, background, user]);

    expect(fake.detailCalls.map((call) => call.file)).toEqual([
      "blocker.eval",
      "user.eval",
      "background.eval",
    ]);
  });

  it("a duplicate fetch bumps the queued item's priority", async () => {
    const fake = createFakeApi({ gated: true });
    const { engine } = await createEngine(
      { api: fake.api },
      { concurrency: 1 }
    );

    const blocker = engine.fetch("blocker.eval", "background");
    await vi.waitFor(() => expect(fake.detailCalls.length).toBe(1));
    const c = engine.fetch("c.eval", "background");
    const d = engine.fetch("d.eval", "elevated");
    // Without the bump, d (elevated) would beat c (background).
    const cAgain = engine.fetch("c.eval", "user");
    expect(cAgain).toBe(c);
    void fake.releaseAll();
    await Promise.all([blocker, c, d]);

    expect(fake.detailCalls.map((call) => call.file)).toEqual([
      "blocker.eval",
      "c.eval",
      "d.eval",
    ]);
  });
});

describe("FetchEngine.start", () => {
  it("hydrates the cache from persisted rows (cache-only seed)", async () => {
    const logs = [handle("a.eval", 2), handle("b.eval", 1)];
    const previews = { "a.eval": makePreview("a.eval") };
    const details = { "a.eval": makeDetails("a.eval") };
    const { api } = createFakeApi();
    const { engine, sinkCalls } = await createEngine({
      api,
      database: createFakeDb({ logs, previews, details }),
    });

    expect(sinkCalls.setHandles).toEqual([logs]);
    expect(sinkCalls.mergePreviews).toEqual([previews]);
    expect(sinkCalls.mergeDetails).toEqual([details]);
    expect(engine.listing()).toEqual(logs);
    // Seeding is cache-only: nothing is re-persisted or fetched.
    expect(sinkCalls.writeDetails).toEqual([]);
  });
});

describe("FetchEngine.applyListing", () => {
  it("clears deleted and invalidated files, activates the listing, and backfills", async () => {
    const kept = handle("kept.eval", 1);
    const changed = handle("changed.eval", 3);
    const added = handle("added.eval", 2);
    const fake = createFakeApi();
    const { engine, sinkCalls } = await createEngine({
      api: fake.api,
      database: createFakeDb({
        details: { "kept.eval": makeDetails("kept.eval") },
        previews: { "kept.eval": makePreview("kept.eval") },
      }),
    });

    const full = await engine.applyListing({
      listing: [kept, changed, added],
      invalidated: ["changed.eval", "added.eval"],
      deleted: ["gone.eval"],
      persistListing: true,
    });

    // Invalidated files (changed or newly discovered) and deleted files are
    // cleared before the fresh listing is activated.
    expect(sinkCalls.clearFile.sort()).toEqual([
      "added.eval",
      "changed.eval",
      "gone.eval",
    ]);
    expect(sinkCalls.writeHandles).toEqual([[kept, changed, added]]);
    expect(full).toEqual([kept, changed, added]);
    expect(engine.listing()).toEqual(full);

    // Invalidated + missing details and previews get fetched; kept has both.
    await vi.waitFor(() => {
      expect(fake.detailCalls.map((call) => call.file).sort()).toEqual([
        "added.eval",
        "changed.eval",
      ]);
      expect(fake.summaryCalls.flat().sort()).toEqual([
        "added.eval",
        "changed.eval",
      ]);
    });
  });

  it("fetches invalidated details fresh (a memoized remote file would re-serve the stale snapshot)", async () => {
    const changed = handle("changed.eval", 3);
    const fake = createFakeApi();
    const { engine } = await createEngine({
      api: fake.api,
      database: createFakeDb({
        details: { "changed.eval": makeDetails("changed.eval", "started") },
      }),
    });

    await engine.applyListing({
      listing: [changed],
      invalidated: ["changed.eval"],
      deleted: [],
      persistListing: true,
    });

    await vi.waitFor(() => {
      expect(fake.detailCalls).toEqual([
        { file: "changed.eval", cached: false },
      ]);
    });
  });

  it("keeps the fresh flag across detail-fetch retries (a retry must not re-serve the stale snapshot)", async () => {
    const changed = handle("changed.eval", 3);
    const fake = createFakeApi({ failDetailsOnceFor: ["changed.eval"] });
    const { engine } = await createEngine({
      api: fake.api,
      database: createFakeDb({
        details: { "changed.eval": makeDetails("changed.eval", "started") },
      }),
    });

    await engine.applyListing({
      listing: [changed],
      invalidated: ["changed.eval"],
      deleted: [],
      persistListing: true,
    });

    await vi.waitFor(() => {
      expect(fake.detailCalls).toEqual([
        { file: "changed.eval", cached: false },
        { file: "changed.eval", cached: false },
      ]);
    });
  });

  it("a mid-flight invalidation's fresh flag survives the older attempt's settle", async () => {
    const target = handle("x.eval", 1);
    const fake = createFakeApi({ gated: true });
    const { engine } = await createEngine(
      { api: fake.api, database: createFakeDb({ logs: [target] }) },
      { concurrency: 1 }
    );

    // Missing-details backfill: a non-fresh fetch of x.eval, gated in flight.
    await engine.applyListing({
      listing: [target],
      invalidated: [],
      deleted: [],
      persistListing: true,
    });
    await vi.waitFor(() => expect(fake.detailCalls.length).toBe(1));
    expect(fake.detailCalls[0]).toEqual({ file: "x.eval", cached: undefined });

    // While that attempt is in flight, the file changes on the server.
    await engine.applyListing({
      listing: [handle("x.eval", 2)],
      invalidated: ["x.eval"],
      deleted: [],
      persistListing: true,
    });

    void fake.releaseAll();

    // The re-enqueued invalidation fetch must be fresh — the older attempt's
    // settle must not have consumed the flag the invalidation just set.
    await vi.waitFor(() => expect(fake.detailCalls.length).toBe(2));
    expect(fake.detailCalls[1]).toEqual({ file: "x.eval", cached: false });
  });

  it("re-fetches previews persisted as started (the run may have finished)", async () => {
    const running = handle("running.eval", 1);
    const fake = createFakeApi();
    const { engine, sinkCalls } = await createEngine({
      api: fake.api,
      database: createFakeDb({
        details: { "running.eval": makeDetails("running.eval", "started") },
        previews: { "running.eval": makePreview("running.eval", "started") },
      }),
    });

    await engine.applyListing({
      listing: [running],
      invalidated: [],
      deleted: [],
      persistListing: false,
    });

    expect(sinkCalls.clearPreview).toEqual(["running.eval"]);
    await vi.waitFor(() => {
      expect(fake.summaryCalls.flat()).toEqual(["running.eval"]);
    });
  });

  it("rejects pending fetches for deleted files", async () => {
    const fake = createFakeApi({ gated: true });
    const { engine } = await createEngine(
      { api: fake.api, database: createFakeDb() },
      { concurrency: 1 }
    );

    const blocker = engine.fetch("blocker.eval", "background");
    await vi.waitFor(() => expect(fake.detailCalls.length).toBe(1));
    const doomed = engine.fetch("doomed.eval", "background");

    await engine.applyListing({
      listing: [],
      invalidated: [],
      deleted: ["doomed.eval"],
      persistListing: true,
    });

    await expect(doomed).rejects.toThrow("Log file deleted: doomed.eval");
    void fake.releaseAll();
    await blocker;
    expect(fake.detailCalls.map((call) => call.file)).toEqual(["blocker.eval"]);
  });
});

describe("FetchEngine.ensurePreviews", () => {
  it("seeds persisted previews and queues fetches for unsettled ones", async () => {
    const done = handle("done.eval", 1);
    const running = handle("running.eval", 2);
    const missing = handle("missing.eval", 3);
    const previews = {
      "done.eval": makePreview("done.eval"),
      "running.eval": makePreview("running.eval", "started"),
    };
    const fake = createFakeApi();
    const { engine, sinkCalls } = await createEngine({
      api: fake.api,
      database: createFakeDb({ logs: [done, running, missing], previews }),
    });

    await engine.ensurePreviews();

    expect(sinkCalls.mergePreviews).toContainEqual(previews);
    await vi.waitFor(() => {
      expect(fake.summaryCalls.flat().sort()).toEqual([
        "missing.eval",
        "running.eval",
      ]);
    });
  });
});

describe("FetchEngine unified queue (previews + details share one queue)", () => {
  it("a user fetch() claims before a queued Medium preview backfill", async () => {
    const fake = createFakeApi({ gated: true });
    const { engine } = await createEngine(
      { api: fake.api },
      { concurrency: 1 }
    );

    const blocker = engine.fetch("blocker.eval", "background");
    await vi.waitFor(() => expect(fake.detailCalls.length).toBe(1));

    engine.requestPreview("backfill.eval", "background");
    const user = engine.fetch("user.eval", "user");

    void fake.releaseAll();
    await Promise.all([blocker, user]);
    await vi.waitFor(() => expect(fake.summaryCalls.length).toBeGreaterThan(0));

    expect(fake.callOrder).toEqual([
      "detail:blocker.eval",
      "detail:user.eval",
      "preview:backfill.eval",
    ]);
  });

  it("isolates a bad file in a preview batch — the other previews still land", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const handles = Array.from({ length: 24 }, (_, i) =>
      handle(`log${i}.eval`)
    );
    const failing = "log5.eval";
    const fake = createFakeApi({ failSummaryFor: [failing] });
    const { engine, sinkCalls } = await createEngine({
      api: fake.api,
      database: createFakeDb({ logs: handles }),
    });

    await engine.ensurePreviews(handles);

    await vi.waitFor(() => {
      const written = sinkCalls.writePreviews.reduce<
        Record<string, LogPreview>
      >((acc, batch) => ({ ...acc, ...batch }), {});
      expect(Object.keys(written)).toHaveLength(23);
      expect(written[failing]).toBeUndefined();
    });
    errorSpy.mockRestore();
  });

  it("a successful details fetch removes a queued preview fetch for the same log", async () => {
    const fake = createFakeApi({ gated: true });
    const { engine } = await createEngine(
      { api: fake.api },
      { concurrency: 1 }
    );

    const blocker = engine.fetch("blocker.eval", "background");
    await vi.waitFor(() => expect(fake.detailCalls.length).toBe(1));

    engine.requestPreview("a.eval", "background");
    const details = engine.fetch("a.eval", "user");

    void fake.releaseAll();
    await Promise.all([blocker, details]);
    await tick();

    expect(fake.summaryCalls).toEqual([]);
  });

  it("requestPreview dedupes with a queued preview backfill (no double fetch)", async () => {
    const target = handle("a.eval");
    const fake = createFakeApi({ gated: true });
    const { engine } = await createEngine(
      { api: fake.api, database: createFakeDb({ logs: [target] }) },
      { concurrency: 1 }
    );

    const blocker = engine.fetch("blocker.eval", "background");
    await vi.waitFor(() => expect(fake.detailCalls.length).toBe(1));

    await engine.ensurePreviews([target]);
    engine.requestPreview("a.eval", "user");

    void fake.releaseAll();
    await blocker;
    await vi.waitFor(() => expect(fake.summaryCalls.length).toBeGreaterThan(0));

    expect(
      fake.summaryCalls.flat().filter((file) => file === "a.eval")
    ).toHaveLength(1);
  });
});

describe("FetchEngine status", () => {
  it("reports syncing while queued work is processing and notifies subscribers", async () => {
    const fake = createFakeApi({ gated: true });
    const { engine } = await createEngine({ api: fake.api });
    const seen: boolean[] = [];
    engine.subscribeStatus(() => seen.push(engine.getStatus().syncing));

    expect(engine.getStatus().syncing).toBe(false);
    const fetching = engine.fetch("a.eval", "user");
    await vi.waitFor(() => expect(engine.getStatus().syncing).toBe(true));
    void fake.releaseAll();
    await fetching;
    await tick();

    expect(engine.getStatus().syncing).toBe(false);
    expect(seen[0]).toBe(true);
    expect(seen[seen.length - 1]).toBe(false);
  });
});

describe("FetchEngine.stop", () => {
  it("rejects pending waiters and drops queued work", async () => {
    const fake = createFakeApi({ gated: true });
    const { engine } = await createEngine(
      { api: fake.api },
      { concurrency: 1 }
    );

    const blocker = engine.fetch("blocker.eval", "background");
    await vi.waitFor(() => expect(fake.detailCalls.length).toBe(1));
    const queued = engine.fetch("queued.eval", "background");

    engine.stop();
    void fake.releaseAll();

    await expect(blocker).rejects.toThrow("Fetch engine stopped");
    await expect(queued).rejects.toThrow("Fetch engine stopped");
    await tick();
    expect(fake.detailCalls.map((call) => call.file)).toEqual(["blocker.eval"]);
    expect(() => engine.fetch("a.eval", "user")).toThrow(
      "Fetch engine used before start()"
    );
  });
});

describe("FetchEngine fetch-state (retrieval errors)", () => {
  it("records a background preview failure without writing a preview", async () => {
    const fake = createFakeApi({ failSummaryFor: ["bad.eval"] });
    const { engine, sinkCalls } = await createEngine({ api: fake.api });

    engine.requestPreview("bad.eval", "background");

    await vi.waitFor(() => {
      expect(sinkCalls.fetchStates["bad.eval"]).toMatchObject({
        preview_fetch_error: "summary failed: bad.eval",
        preview_attempts: 1,
      });
    });
    expect(
      sinkCalls.writePreviews.some((batch) => "bad.eval" in batch)
    ).toBe(false);
  });

  it("a subsequent successful preview clears the recorded error", async () => {
    let failing = true;
    const fake = createFakeApi({
      failSummaryWhen: (file) => failing && file === "flaky.eval",
    });
    const { engine, sinkCalls } = await createEngine({ api: fake.api });

    engine.requestPreview("flaky.eval", "background");
    await vi.waitFor(() => {
      expect(sinkCalls.fetchStates["flaky.eval"]?.preview_attempts).toBe(1);
    });

    failing = false;
    engine.requestPreview("flaky.eval", "background");

    await vi.waitFor(() => {
      expect(sinkCalls.fetchStates["flaky.eval"]).toMatchObject({
        preview_fetch_error: undefined,
        preview_attempts: 0,
      });
    });
  });

  it("a waitered details failure both rejects the caller and records the error", async () => {
    const fake = createFakeApi({ failFor: ["a.eval"] });
    const { engine, sinkCalls } = await createEngine({ api: fake.api });

    await expect(engine.fetch("a.eval", "user")).rejects.toThrow(
      "fetch failed: a.eval"
    );

    expect(sinkCalls.fetchStates["a.eval"]).toMatchObject({
      details_fetch_error: "fetch failed: a.eval",
      details_attempts: 1,
    });
  });

  it("stops backfilling a file after kMaxFetchAttempts settled failures (row retains the error)", async () => {
    const target = handle("bad.eval");
    const fake = createFakeApi({ failSummaryFor: ["bad.eval"] });
    const { engine, sinkCalls } = await createEngine({
      api: fake.api,
      database: createFakeDb({ logs: [target] }),
    });

    for (let i = 0; i < 5; i++) {
      engine.requestPreview("bad.eval", "background");
      await vi.waitFor(() => {
        expect(sinkCalls.fetchStates["bad.eval"]?.preview_attempts).toBe(
          i + 1
        );
      });
    }

    fake.summaryCalls.length = 0;
    await engine.applyListing({
      listing: [target],
      invalidated: [],
      deleted: [],
      persistListing: true,
    });
    await tick();

    expect(fake.summaryCalls.flat()).not.toContain("bad.eval");
    expect(sinkCalls.fetchStates["bad.eval"]).toMatchObject({
      preview_fetch_error: "summary failed: bad.eval",
      preview_attempts: 5,
    });
  });

  it("clearFile from invalidation resets fetch-state so backfill retries from scratch", async () => {
    const target = handle("bad.eval");
    const fake = createFakeApi({ failFor: ["bad.eval"] });
    const { engine, sinkCalls } = await createEngine({
      api: fake.api,
      database: createFakeDb({ logs: [target] }),
    });

    for (let i = 0; i < 5; i++) {
      await expect(engine.fetch("bad.eval", "background")).rejects.toThrow();
    }
    expect(sinkCalls.fetchStates["bad.eval"]?.details_attempts).toBe(5);

    // A later backfill pass gives up on it.
    fake.detailCalls.length = 0;
    await engine.applyListing({
      listing: [target],
      invalidated: [],
      deleted: [],
      persistListing: true,
    });
    await tick();
    expect(fake.detailCalls.map((call) => call.file)).not.toContain(
      "bad.eval"
    );

    // The file changes on the server: invalidation wipes its fetch-state row.
    await engine.applyListing({
      listing: [target],
      invalidated: ["bad.eval"],
      deleted: [],
      persistListing: true,
    });
    expect(sinkCalls.clearFile).toContain("bad.eval");
    expect(sinkCalls.fetchStates["bad.eval"]).toBeUndefined();

    // Confirm the reset actually landed — a fresh failure records attempts
    // starting from 1, not 6.
    await expect(engine.fetch("bad.eval", "background")).rejects.toThrow();
    expect(sinkCalls.fetchStates["bad.eval"]?.details_attempts).toBe(1);
  });

  it("restart (stop/start) zeroes attempts but keeps the error text, and persists the reset", async () => {
    const fake = createFakeApi({ failFor: ["a.eval"] });
    const db = createFakeDb({ logs: [handle("a.eval")] });
    const { sink, calls } = createFakeSink(db);
    const engine = new FetchEngine({ flushDelayMs: 0, statsDelayMs: 0 });
    await engine.start({ api: fake.api, database: db, sink });

    await expect(engine.fetch("a.eval", "user")).rejects.toThrow();
    expect(calls.fetchStates["a.eval"]).toMatchObject({
      details_fetch_error: "fetch failed: a.eval",
      details_attempts: 1,
    });

    engine.stop();
    await engine.start({ api: fake.api, database: db, sink });

    expect(calls.fetchStates["a.eval"]).toMatchObject({
      details_fetch_error: "fetch failed: a.eval",
      details_attempts: 0,
    });

    // The reset landed in the database, not just the cache mirror.
    const persisted = await db.readFetchStates();
    expect(persisted["a.eval"]).toMatchObject({
      details_fetch_error: "fetch failed: a.eval",
      details_attempts: 0,
    });
  });
});
