import { describe, expect, it, vi } from "vitest";

import { LogHandle } from "@tsmono/inspect-common";

import { ClientAPI, LogDetails, LogPreview } from "../client/api/types";
import { DatabaseService } from "../client/database";

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
}

const createFakeApi = (options: FakeApiOptions = {}) => {
  const detailCalls: { file: string; cached: boolean | undefined }[] = [];
  const summaryCalls: string[][] = [];
  const gates: Deferred<void>[] = [];

  const api = {
    get_log_details: vi.fn(async (file: string, cached?: boolean) => {
      detailCalls.push({ file, cached });
      if (options.gated) {
        const gate = deferred<void>();
        gates.push(gate);
        await gate.promise;
      }
      if (options.failFor?.includes(file)) {
        throw new Error(`fetch failed: ${file}`);
      }
      return makeDetails(file);
    }),
    get_log_summaries: vi.fn((files: string[]) => {
      summaryCalls.push(files);
      return Promise.resolve(files.map((file) => makePreview(file)));
    }),
  };

  // Releasing a gate lets the worker claim the next item, which opens a new
  // gate asynchronously — so drain across ticks until no gates remain.
  const releaseAll = async () => {
    for (let i = 0; i < 100; i++) {
      while (gates.length > 0) {
        gates.shift()?.resolve();
      }
      await new Promise((resolve) => setTimeout(resolve, 0));
      if (gates.length === 0) {
        return;
      }
    }
  };

  return {
    api: api as unknown as ClientAPI,
    detailCalls,
    summaryCalls,
    releaseAll,
    gates,
  };
};

interface FakeDbData {
  logs?: LogHandle[];
  previews?: Record<string, LogPreview>;
  details?: Record<string, LogDetails>;
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

  return {
    opened: () => true,
    readLogs: () => Promise.resolve(data.logs ?? []),
    readLogPreviews: (logs: LogHandle[]) =>
      Promise.resolve(pick(data.previews, logs)),
    readLogDetails: (logs: LogHandle[]) =>
      Promise.resolve(pick(data.details, logs)),
    readLogDetailsForFile: (file: string) =>
      Promise.resolve(data.details?.[file] ?? null),
    findMissingDetails: (logs: LogHandle[]) =>
      Promise.resolve(
        logs.filter((log) => !(log.name in (data.details ?? {})))
      ),
    findMissingPreviews: (logs: LogHandle[]) =>
      Promise.resolve(
        logs.filter((log) => !(log.name in (data.previews ?? {})))
      ),
    countRows: () => Promise.resolve(0),
  } as unknown as DatabaseService;
};

const createFakeSink = () => {
  const calls = {
    setHandles: [] as LogHandle[][],
    mergePreviews: [] as Record<string, LogPreview>[],
    mergeDetails: [] as Record<string, LogDetails>[],
    writeHandles: [] as LogHandle[][],
    writePreviews: [] as Record<string, LogPreview>[],
    writeDetails: [] as Record<string, LogDetails>[],
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
    clearFile: (name) => {
      calls.clearFile.push(name);
      return Promise.resolve();
    },
    clearPreview: (name) => {
      calls.clearPreview.push(name);
      return Promise.resolve();
    },
    clearAll: () => {
      calls.clearAll++;
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
    previewProcessingDelayMs: 0,
    ...options,
  });
  const { sink, calls } = createFakeSink();
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
      { detailConcurrency: 1 }
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
      { detailConcurrency: 1 }
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
      { detailConcurrency: 1 }
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
      { detailConcurrency: 1 }
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
