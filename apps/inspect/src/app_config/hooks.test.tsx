import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AppConfig as AppConfigResponse } from "@tsmono/inspect-common/types";

import { ClientAPI, LogRoot } from "../client/api/types";

import * as appConfig from "./appConfig";
import {
  AppConfig,
  AppConfigBootstrap,
  loadResolvedAppConfig,
} from "./appConfig";
import { APP_CONFIG_KEY, useAppConfig, useAppConfigAsync } from "./hooks";
import { BackendBootstrap } from "./resolveBackend";

// The resolution logic lives in the framework-free `loadResolvedAppConfig`, so
// the full permutation matrix is a plain async test (no react-query). The hooks
// (`useAppConfigAsync`/`useAppConfig`) are thin glue and get a few wiring tests.
//
// loadResolvedAppConfig's output is a function of two orthogonal input axes:
//   V — the get_app_config() outcome (version info, via the constructed api)
//   D — how the log dir resolves (branch of resolveLogRoot × its backend
//       bootstrap outcome). Dir discovery runs FIRST — no api exists until it
//       lands — so a D failure means the backend factory is never called.
// The suite is their full cross product, expected computed from (V, D).

const notMocked = <T,>(): Promise<T> => Promise.reject(new Error("not mocked"));

// A ClientAPI with every required member present (no type assertions). Only
// get_app_config is ever exercised.
const baseApi = (): ClientAPI => ({
  get_logs: () => notMocked(),
  get_eval_set: () => Promise.resolve(undefined),
  get_flow: () => Promise.resolve(undefined),
  get_log_summaries: () => notMocked(),
  get_log_summaries_settled: () => notMocked(),
  get_log_details: () => notMocked(),
  get_log_info: () => notMocked(),
  get_log_sample: () => notMocked(),
  client_events: () => Promise.resolve([]),
  download_file: () => Promise.resolve(),
  open_log_file: () => Promise.resolve(),
  get_app_config: () => notMocked(),
});

const makeApi = (overrides: Partial<ClientAPI>): ClientAPI => ({
  ...baseApi(),
  ...overrides,
});

const LOG_ROOT: LogRoot = {
  logs: [],
  log_dir: "/logs",
  abs_log_dir: "/abs/logs",
};

const addEmbedded = (url: string) => {
  const el = document.createElement("script");
  el.id = "logview-state";
  el.type = "application/json"; // non-executable so jsdom doesn't run it as JS
  el.textContent = JSON.stringify({ type: "updateState", url });
  document.body.appendChild(el);
};

afterEach(() => {
  document.getElementById("logview-state")?.remove();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Axis V — get_app_config() outcome
// ---------------------------------------------------------------------------

type VersionsOutcome = {
  name: string;
  getAppConfig: () => Promise<AppConfigResponse>;
  expect:
    | { kind: "ok"; inspect_version: string; scout_version: string | null }
    | { kind: "error" };
};

const V: VersionsOutcome[] = [
  {
    name: "versions ok (scout present)",
    getAppConfig: () =>
      Promise.resolve({ inspect_version: "1.0.0", scout_version: "0.5.0" }),
    expect: { kind: "ok", inspect_version: "1.0.0", scout_version: "0.5.0" },
  },
  {
    name: "versions ok (scout null)",
    getAppConfig: () =>
      Promise.resolve({ inspect_version: "1.0.0", scout_version: null }),
    expect: { kind: "ok", inspect_version: "1.0.0", scout_version: null },
  },
  {
    name: "versions ok (scout undefined → null)",
    getAppConfig: () => Promise.resolve({ inspect_version: "1.0.0" }),
    expect: { kind: "ok", inspect_version: "1.0.0", scout_version: null },
  },
  {
    name: "versions reject",
    getAppConfig: () => Promise.reject(new Error("cfg boom")),
    expect: { kind: "error" },
  },
];

// ---------------------------------------------------------------------------
// Axis D — log dir resolution (the reachable leaves of resolveLogRoot)
// ---------------------------------------------------------------------------

type LogDirCase = {
  name: string;
  singleFileMode: boolean;
  logFile?: string;
  embeddedUrl?: string;
  // The dir-discovery stubs this branch needs (backend defaults reject).
  resolveLogRoot?: BackendBootstrap["resolveLogRoot"];
  resolveConfiguredDir?: BackendBootstrap["resolveConfiguredDir"];
  expect:
    | { kind: "dir"; logDir: string; absLogDir?: string }
    | { kind: "truthy" } // resolved-but-value-depends-on-jsdom (page-dir fallback)
    | { kind: "error" };
};

const D: LogDirCase[] = [
  {
    name: "dir: resolveLogRoot ok",
    singleFileMode: false,
    resolveLogRoot: () => Promise.resolve(LOG_ROOT),
    expect: { kind: "dir", logDir: "/logs", absLogDir: "/abs/logs" },
  },
  {
    name: "dir: resolveLogRoot ok with canonical log_dir_uri (preferred)",
    singleFileMode: false,
    resolveLogRoot: () =>
      Promise.resolve({ ...LOG_ROOT, log_dir_uri: "file:///abs/logs" }),
    expect: { kind: "dir", logDir: "file:///abs/logs", absLogDir: "/abs/logs" },
  },
  {
    name: "dir: resolveLogRoot without a log_dir",
    singleFileMode: false,
    resolveLogRoot: () => Promise.resolve({ logs: [], log_dir: undefined }),
    expect: { kind: "error" },
  },
  {
    name: "dir: resolveLogRoot resolves undefined",
    singleFileMode: false,
    resolveLogRoot: () => Promise.resolve(undefined),
    expect: { kind: "error" },
  },
  {
    name: "dir: resolveLogRoot reject",
    singleFileMode: false,
    resolveLogRoot: () => Promise.reject(new Error("root boom")),
    expect: { kind: "error" },
  },
  {
    name: "single-file ?log_file= (has dir)",
    singleFileMode: true,
    logFile: "sub/foo.eval",
    expect: { kind: "dir", logDir: "sub", absLogDir: undefined },
  },
  {
    name: "single-file bare: configured dir ok",
    singleFileMode: true,
    logFile: "foo.eval",
    resolveConfiguredDir: () => Promise.resolve("/from-backend"),
    expect: { kind: "dir", logDir: "/from-backend", absLogDir: undefined },
  },
  {
    name: "single-file bare: configured dir empty → page dir",
    singleFileMode: true,
    logFile: "foo.eval",
    resolveConfiguredDir: () => Promise.resolve(undefined),
    expect: { kind: "truthy" },
  },
  {
    name: "single-file bare: no configured-dir probe → page dir",
    singleFileMode: true,
    logFile: "foo.eval",
    expect: { kind: "truthy" },
  },
  {
    name: "single-file bare: configured dir reject",
    singleFileMode: true,
    logFile: "foo.eval",
    resolveConfiguredDir: () => Promise.reject(new Error("dir boom")),
    expect: { kind: "error" },
  },
  {
    name: "single-file embedded (#logview-state)",
    singleFileMode: true,
    embeddedUrl: "/abs/logs/f.eval",
    expect: { kind: "dir", logDir: "/abs/logs", absLogDir: undefined },
  },
  {
    name: "single-file with no ?log_file= and no embedded state",
    singleFileMode: true,
    expect: { kind: "error" },
  },
];

const bootstrapFor = (
  v: VersionsOutcome,
  d: LogDirCase
): { bootstrap: AppConfigBootstrap; createApi: ReturnType<typeof vi.fn> } => {
  const createApi = vi.fn(() => makeApi({ get_app_config: v.getAppConfig }));
  return {
    bootstrap: {
      backend: {
        resolveLogRoot:
          d.resolveLogRoot ?? (() => notMocked<LogRoot | undefined>()),
        resolveConfiguredDir: d.resolveConfiguredDir,
        createApi,
        capabilities: { downloadLogs: false, streamSamples: false },
      },
      singleFileMode: d.singleFileMode,
      loader: d.singleFileMode ? "direct" : "replicator",
      logFile: d.logFile,
    },
    createApi,
  };
};

// ---------------------------------------------------------------------------
// V × D — full permutation over the framework-free resolver
// ---------------------------------------------------------------------------

const cases = V.flatMap((v) =>
  D.map((d) => ({ name: `${v.name} × ${d.name}`, v, d }))
);

describe("loadResolvedAppConfig (V × D)", () => {
  it.each(cases)("$name", async ({ v, d }) => {
    if (d.embeddedUrl) addEmbedded(d.embeddedUrl);
    const { bootstrap, createApi } = bootstrapFor(v, d);

    // A dir failure rejects before any api exists; a version failure rejects
    // after construction. Either way the caller sees a rejection.
    if (v.expect.kind === "error" || d.expect.kind === "error") {
      await expect(loadResolvedAppConfig(bootstrap)).rejects.toBeInstanceOf(
        Error
      );
      if (d.expect.kind === "error") {
        // Dir discovery failed → no api was ever constructed.
        expect(createApi).not.toHaveBeenCalled();
      }
      return;
    }

    const resolved = await loadResolvedAppConfig(bootstrap);
    // pass-through bootstrap fields
    expect(resolved.singleFileMode).toBe(d.singleFileMode);
    expect(resolved.loader).toBe(d.singleFileMode ? "direct" : "replicator");
    expect(resolved.logFile).toBe(d.logFile);
    // versions (axis V)
    expect(resolved.inspect_version).toBe(v.expect.inspect_version);
    expect(resolved.scout_version).toBe(v.expect.scout_version);
    // log dir (axis D)
    if (d.expect.kind === "dir") {
      expect(resolved.logDir).toBe(d.expect.logDir);
      expect(resolved.absLogDir).toBe(d.expect.absLogDir);
    } else {
      // page-dir fallback — resolved against document.baseURI, never empty.
      expect(resolved.logDir).toBeTruthy();
    }
    // The api is the factory's product, constructed for exactly the resolved
    // dir — the api/logDir snapshot can't disagree by construction.
    expect(createApi).toHaveBeenCalledTimes(1);
    expect(createApi).toHaveBeenCalledWith(resolved.logDir);
    expect(resolved.api).toBe(createApi.mock.results[0]?.value);
  });
});

// ---------------------------------------------------------------------------
// Hook wiring — the react-query glue around resolveAppConfig
// ---------------------------------------------------------------------------

const freshClient = () =>
  new QueryClient({ defaultOptions: { queries: { retry: false } } });

const wrapperFor = (client: QueryClient) => {
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return Wrapper;
};

const fullConfig = (over: Partial<AppConfig> = {}): AppConfig => ({
  api: baseApi(),
  singleFileMode: false,
  loader: "replicator",
  logFile: undefined,
  inspect_version: "1.0.0",
  scout_version: null,
  logDir: "/logs",
  absLogDir: "/abs/logs",
  ...over,
});

describe("useAppConfigAsync — hook wiring", () => {
  it("resolves to the config", async () => {
    const config = fullConfig({
      inspect_version: "2.0.0",
      scout_version: "0.9",
    });
    vi.spyOn(appConfig, "resolveAppConfig").mockResolvedValue(config);

    const { result } = renderHook(() => useAppConfigAsync(), {
      wrapper: wrapperFor(freshClient()),
    });
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBeUndefined();
    expect(result.current.data).toEqual(config);
  });

  it("surfaces resolution errors", async () => {
    vi.spyOn(appConfig, "resolveAppConfig").mockRejectedValue(
      new Error("boom")
    );

    const { result } = renderHook(() => useAppConfigAsync(), {
      wrapper: wrapperFor(freshClient()),
    });
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBeDefined();
    expect(result.current.data).toBeUndefined();
  });

  it("is loading until resolution completes", () => {
    vi.spyOn(appConfig, "resolveAppConfig").mockReturnValue(
      new Promise<AppConfig>(() => {})
    );

    const { result } = renderHook(() => useAppConfigAsync(), {
      wrapper: wrapperFor(freshClient()),
    });

    expect(result.current.loading).toBe(true);
    expect(result.current.data).toBeUndefined();
  });
});

describe("useAppConfig — sync accessor", () => {
  it("returns the resolved config already in the cache", () => {
    const client = freshClient();
    const config = fullConfig();
    client.setQueryData(APP_CONFIG_KEY, config);

    const { result } = renderHook(() => useAppConfig(), {
      wrapper: wrapperFor(client),
    });
    expect(result.current).toEqual(config);
  });
});
