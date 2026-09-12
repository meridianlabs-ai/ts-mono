import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { testClientAPI } from "../client/api/testClientApi";

import {
  AppConfig,
  getAppConfig,
  initAppConfig,
  loadResolvedAppConfig,
  resolveBootstrap,
  resolveLogFileLocation,
  setLogRoot,
} from "./appConfig";

// resolveBootstrap covers the invocation → bootstrap mapping (singleFileMode /
// loader / logFile). The async half (versions + logDir, incl. the embedded /
// single-file dir derivation) is covered against loadResolvedAppConfig in
// server/useAppConfig.test.tsx.

// The view-server backend reads this Vite build-time define; provide it so the
// no-param case can construct its (unused) view-server api.
beforeAll(() => {
  vi.stubGlobal("__VIEW_SERVER_API_URL__", "http://localhost");
});
afterAll(() => {
  vi.unstubAllGlobals();
});

const setSearch = (search: string) => {
  window.history.replaceState({}, "", `/${search}`);
};

const addEmbedded = (url: string) => {
  const el = document.createElement("script");
  el.id = "logview-state";
  el.type = "application/json"; // non-executable so jsdom doesn't run it as JS
  el.textContent = JSON.stringify({ type: "updateState", url });
  document.body.appendChild(el);
};

afterEach(() => {
  setSearch("");
  document.getElementById("logview-state")?.remove();
});

describe("resolveBootstrap", () => {
  it("?log_file= → single-file / direct loader with logFile", () => {
    setSearch("?log_file=foo.eval");
    const config = resolveBootstrap();
    expect(config.singleFileMode).toBe(true);
    expect(config.loader).toBe("direct");
    expect(config.logFile).toBe("foo.eval");
    expect(config.backend).toBeDefined();
  });

  it("?log_dir= → directory / replicator loader, no logFile", () => {
    setSearch("?log_dir=/logs");
    const config = resolveBootstrap();
    expect(config.singleFileMode).toBe(false);
    expect(config.loader).toBe("replicator");
    expect(config.logFile).toBeUndefined();
  });

  it("no params → directory / replicator loader", () => {
    setSearch("");
    const config = resolveBootstrap();
    expect(config.singleFileMode).toBe(false);
    expect(config.loader).toBe("replicator");
    expect(config.logFile).toBeUndefined();
  });

  it("ignores #logview-state outside a VS Code host", () => {
    setSearch("");
    addEmbedded("/abs/logs/task.eval");
    const config = resolveBootstrap();
    expect(config.singleFileMode).toBe(false);
    expect(config.loader).toBe("replicator");
  });
});

describe("resolveLogFileLocation", () => {
  it("does not duplicate a nested relative file's directory", () => {
    expect(
      resolveLogFileLocation(
        "hosted/fixed.json",
        "http://localhost:3000/hosted"
      )
    ).toBe("hosted/fixed.json");
  });

  it("resolves a bare file against the configured directory", () => {
    expect(
      resolveLogFileLocation("fixed.json", "http://localhost:3000/hosted")
    ).toBe("http://localhost:3000/hosted/fixed.json");
  });

  it("resolves a nested route path below the configured directory", () => {
    expect(
      resolveLogFileLocation("nested/run.eval", "http://localhost:3000/hosted")
    ).toBe("http://localhost:3000/hosted/nested/run.eval");
  });

  it("does not confuse a sibling prefix for the configured directory", () => {
    expect(
      resolveLogFileLocation(
        "hosted-private/run.eval",
        "http://localhost:3000/hosted"
      )
    ).toBe("http://localhost:3000/hosted/hosted-private/run.eval");
  });

  it.each(["embedded", "url"] as const)(
    "keeps a nested relative %s file scoped to its exact URL",
    async (locationSource) => {
      const api = testClientAPI({
        get_app_config: () =>
          Promise.resolve({ inspect_version: "1", scout_version: null }),
      });
      const config = await loadResolvedAppConfig({
        backend: {
          resolveLogRoot: () => Promise.reject(new Error("not used")),
          createApi: () => api,
          capabilities: { downloadLogs: false, streamSamples: false },
          browserDirect: true,
          locationSource,
        },
        singleFileMode: true,
        loader: "direct",
        logFile: "hosted/fixed.json",
        ...(locationSource === "embedded"
          ? { trustedFile: "hosted/fixed.json" }
          : {
              startupProposal: {
                kind: "file" as const,
                location: "hosted/fixed.json",
              },
            }),
      });

      const exact = "http://localhost:3000/hosted/fixed.json";
      expect(config.logDir).toBe("hosted");
      expect(config.locationScope).toEqual({ kind: "file", location: exact });
      expect(config.startupProposal?.location).toBe(
        locationSource === "url" ? exact : undefined
      );
      expect(resolveLogFileLocation(config.logFile ?? "", config.logDir)).toBe(
        "hosted/fixed.json"
      );
    }
  );

  it("preserves proxy paths in the approval scope", async () => {
    const api = testClientAPI({
      get_app_config: () =>
        Promise.resolve({ inspect_version: "1", scout_version: null }),
    });
    const config = await loadResolvedAppConfig({
      backend: {
        resolveLogRoot: () => Promise.reject(new Error("not used")),
        createApi: () => api,
        capabilities: { downloadLogs: false, streamSamples: true },
        browserDirect: false,
        locationSource: "url",
      },
      singleFileMode: true,
      loader: "direct",
      logFile: "/workspace/logs/run.eval",
      startupProposal: {
        kind: "file",
        location: "/workspace/logs/run.eval",
      },
    });

    expect(config.startupProposal).toEqual({
      kind: "file",
      location: "/workspace/logs/run.eval",
    });
  });
});

describe("setLogRoot", () => {
  const seedConfig = (absLogDir?: string): AppConfig =>
    initAppConfig({
      api: testClientAPI(),
      singleFileMode: true,
      loader: "direct",
      inspect_version: "1",
      scout_version: null,
      logDir: "file:///logs",
      absLogDir,
    });

  it("no-ops on an unchanged dir, preserving config identity", () => {
    // A same-dir host updateState (e.g. the embedded startup blob
    // re-dispatched through onMessage) must not rebuild the api or restart
    // the fetch engine — both key off config identity.
    const prev = seedConfig();
    setLogRoot("file:///logs");
    expect(getAppConfig()).toBe(prev);
  });

  it("no-ops on an unchanged dir even when the config carries absLogDir", () => {
    // A config whose root came from the dir-mode probe (abs_log_dir set)
    // must still no-op — a rebuild would clobber absLogDir to undefined.
    const prev = seedConfig("/abs/logs");
    setLogRoot("file:///logs");
    expect(getAppConfig()).toBe(prev);
    expect(getAppConfig().absLogDir).toBe("/abs/logs");
  });

  it("rebuilds the whole config — fresh api + dir — for a new dir", () => {
    const prev = seedConfig();
    setLogRoot("file:///other");
    const next = getAppConfig();
    expect(next).not.toBe(prev);
    expect(next.logDir).toBe("file:///other");
    expect(next.api).not.toBe(prev.api);
  });
});
