import { afterEach, describe, expect, it, vi } from "vitest";

import { getVscodeApi } from "@tsmono/util";

import staticHttpApi, {
  staticLogRoot,
} from "../client/api/static-http/api-static-http";
import { testClientAPI } from "../client/api/testClientApi";
import {
  fetchViewServerLogDir,
  fetchViewServerLogRoot,
  viewServerApi,
} from "../client/api/view-server/api-view-server";
import {
  apiVscode,
  createVscodeProxyFetch,
} from "../client/api/vscode/api-vscode";

import { AppConfigBootstrap, loadResolvedAppConfig } from "./appConfig";
import {
  resetApiFactory,
  resolveBackend,
  setApiFactory,
} from "./resolveBackend";
import { UrlLogSource } from "./urlLogSource";

// resolveBackend picks which backend bootstrap to build from the ambient
// startup signals (vscode host, embedded #log_dir_context, ?inspect_server=true)
// plus the invocation-time UrlLogSource. A bootstrap is two stages — dir
// discovery (resolveLogRoot / resolveConfiguredDir) and per-dir construction
// (createApi) — so the tests assert WHICH backend each stage reaches and with
// WHAT args. Backend factories and the clientApi wrapper are mocked to
// distinguishable sentinels.

vi.mock("../client/api/view-server/api-view-server", () => ({
  viewServerApi: vi.fn(() => ({ __backend: "view-server" })),
  fetchViewServerLogRoot: vi.fn(() =>
    Promise.resolve({ logs: [], log_dir: "/probed" })
  ),
  fetchViewServerLogDir: vi.fn(() => Promise.resolve("/configured")),
}));
vi.mock("../client/api/static-http/api-static-http", () => ({
  default: vi.fn(() => ({ __backend: "static-http" })),
  staticLogRoot: vi.fn((log_dir: string) => ({ logs: [], log_dir })),
}));
vi.mock("../client/api/vscode/api-vscode", () => ({
  apiVscode: vi.fn(() => ({ __backend: "vscode" })),
  createVscodeProxyFetch: vi.fn(() => ({ __transport: "proxy-fetch" })),
}));
// clientApi is the identity-ish wrapper here: it returns the backend it was
// handed so createApi's return value IS the chosen sentinel.
vi.mock("../client/api/client-api", () => ({
  clientApi: vi.fn((backend: unknown) => backend),
}));
vi.mock("@tsmono/util", async (orig) => ({
  ...(await orig<typeof import("@tsmono/util")>()),
  getVscodeApi: vi.fn(),
}));

const mockGetVscodeApi = vi.mocked(getVscodeApi);
const mockStaticHttpApi = vi.mocked(staticHttpApi);
const mockStaticLogRoot = vi.mocked(staticLogRoot);
const mockViewServerApi = vi.mocked(viewServerApi);
const mockFetchLogRoot = vi.mocked(fetchViewServerLogRoot);
const mockFetchLogDir = vi.mocked(fetchViewServerLogDir);
const mockApiVscode = vi.mocked(apiVscode);
const mockCreateProxyFetch = vi.mocked(createVscodeProxyFetch);

const setSearch = (search: string) => {
  window.history.replaceState({}, "", `/${search}`);
};

const addJsonScript = (id: string, json: unknown) => {
  const el = document.createElement("script");
  el.id = id;
  el.type = "application/json"; // non-executable so jsdom doesn't run it as JS
  el.textContent = JSON.stringify(json);
  document.body.appendChild(el);
};

const addLogDirContext = (json: object) =>
  addJsonScript("log_dir_context", json);

// The extension host advertises transport capabilities via an injected
// script block; the http_request proxy is what the viewer requires.
const addHostCapabilities = (capabilities: string[]) =>
  addJsonScript("inspect-host-capabilities", capabilities);

const dirSource = (logDir: string): UrlLogSource => ({ kind: "dir", logDir });
const fileSource = (logFile: string): UrlLogSource => ({
  kind: "file",
  logFile,
});
const noneSource: UrlLogSource = { kind: "none" };

afterEach(() => {
  resetApiFactory();
  setSearch("");
  document.getElementById("log_dir_context")?.remove();
  document.getElementById("inspect-host-capabilities")?.remove();
  document.getElementById("logview-state")?.remove();
  mockGetVscodeApi.mockReset();
  mockStaticHttpApi.mockClear();
  mockStaticLogRoot.mockClear();
  mockViewServerApi.mockClear();
  mockFetchLogRoot.mockClear();
  mockFetchLogDir.mockClear();
  mockApiVscode.mockClear();
  mockCreateProxyFetch.mockClear();
});

// The resolver only checks that a host object exists and reads its
// capabilities from the mocked module, so these three no-ops are the whole
// surface it touches.
const testVscodeApi = (): NonNullable<ReturnType<typeof getVscodeApi>> => ({
  postMessage: () => {},
  getState: () => null,
  setState: () => {},
});

describe("resolveBackend selection", () => {
  it("vscode host with http_request capability → vscode backend (wins over source)", async () => {
    const vscode = testVscodeApi();
    mockGetVscodeApi.mockReturnValue(vscode);
    addHostCapabilities(["http_request"]);

    const backend = resolveBackend(noneSource);

    // One transport, built once, shared by the probe and every instance.
    expect(mockCreateProxyFetch).toHaveBeenCalledTimes(1);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- the mock's recorded return is `any`; the assertion below only needs it to be the same value that was handed out
    const proxyFetch = mockCreateProxyFetch.mock.results[0]
      ?.value as ReturnType<typeof createVscodeProxyFetch>;

    await backend.resolveLogRoot();
    expect(mockFetchLogRoot).toHaveBeenCalledWith({ customFetch: proxyFetch });

    const api = backend.createApi("file:///logs");
    expect(api).toEqual({ __backend: "vscode" });
    expect(mockApiVscode).toHaveBeenCalledWith(
      vscode,
      "file:///logs",
      proxyFetch
    );
    expect(backend.capabilities).toEqual({
      downloadLogs: false,
      streamSamples: true,
    });
  });

  it("vscode host WITHOUT http_request capability → unsupported (update-extension error)", async () => {
    mockGetVscodeApi.mockReturnValue(testVscodeApi());
    // No #inspect-host-capabilities marker — a legacy named-RPC-only host.

    const backend = resolveBackend(noneSource);

    await expect(backend.resolveLogRoot()).rejects.toThrow(
      /update the Inspect AI extension/i
    );
    expect(() => backend.createApi("/logs")).toThrow(
      /update the Inspect AI extension/i
    );
    expect(mockApiVscode).not.toHaveBeenCalled();
  });

  it("#log_dir_context with log_dir → static-http backend with that dir", async () => {
    addLogDirContext({ log_dir: "/embedded/logs" });
    const backend = resolveBackend(noneSource);

    await backend.resolveLogRoot();
    expect(mockStaticLogRoot).toHaveBeenCalledWith("/embedded/logs", undefined);

    const api = backend.createApi("/embedded/logs");
    expect(api).toEqual({ __backend: "static-http" });
    expect(mockStaticHttpApi).toHaveBeenCalledWith("/embedded/logs", undefined);
  });

  it("#log_dir_context with log_file → static-http single-file with derived dir", () => {
    addLogDirContext({ log_file: "/embedded/logs/task.eval" });
    const backend = resolveBackend(noneSource);

    const api = backend.createApi("/embedded/logs");
    expect(api).toEqual({ __backend: "static-http" });
    // Construction dir comes from the caller (the resolved config); the api
    // needs nothing else — single-file fetching passes file paths per call.
    expect(mockStaticHttpApi).toHaveBeenCalledWith("/embedded/logs", undefined);
  });

  it("?inspect_server=true with dir source → view-server backend probing that dir", async () => {
    setSearch("?inspect_server=true");
    const backend = resolveBackend(dirSource("/logs"));

    await backend.resolveLogRoot();
    expect(mockFetchLogRoot).toHaveBeenCalledWith({}, "/logs");

    const api = backend.createApi("file:///abs/logs");
    expect(api).toEqual({ __backend: "view-server" });
    expect(mockViewServerApi).toHaveBeenCalledWith({
      logDir: "file:///abs/logs",
    });
    expect(mockStaticHttpApi).not.toHaveBeenCalled();
  });

  it("dir source, no other signal → static-http backend", async () => {
    const backend = resolveBackend(dirSource("/logs"));

    await backend.resolveLogRoot();
    expect(mockStaticLogRoot).toHaveBeenCalledWith("/logs", undefined);

    const api = backend.createApi("http://localhost:3000/logs");
    expect(api).toEqual({ __backend: "static-http" });
    expect(mockStaticHttpApi).toHaveBeenCalledWith(
      "http://localhost:3000/logs",
      undefined
    );
    expect(mockViewServerApi).not.toHaveBeenCalled();
  });

  it("file source, no other signal → static-http single-file (no dir-mode root)", async () => {
    const backend = resolveBackend(fileSource("foo.eval"));

    // No dir was configured, so dir-mode discovery has nothing to enumerate
    // (single-file resolution derives the dir from the file instead).
    await expect(backend.resolveLogRoot()).rejects.toThrow(
      /unable to determine log paths/i
    );

    const api = backend.createApi("http://localhost:3000");
    expect(api).toEqual({ __backend: "static-http" });
    expect(mockStaticHttpApi).toHaveBeenCalledWith(
      "http://localhost:3000",
      undefined
    );
    expect(mockViewServerApi).not.toHaveBeenCalled();
  });

  it("no source, no signal → view-server backend (server-configured dir)", async () => {
    const backend = resolveBackend(noneSource);

    await backend.resolveLogRoot();
    expect(mockFetchLogRoot).toHaveBeenCalledWith({}, undefined);

    await backend.resolveConfiguredDir?.();
    expect(mockFetchLogDir).toHaveBeenCalled();

    const api = backend.createApi("file:///probed");
    expect(api).toEqual({ __backend: "view-server" });
    expect(mockViewServerApi).toHaveBeenCalledWith({
      logDir: "file:///probed",
    });
    expect(mockStaticHttpApi).not.toHaveBeenCalled();
    expect(backend.capabilities).toEqual({
      downloadLogs: true,
      streamSamples: true,
    });
  });
});

describe("embedder api factory (setApiFactory)", () => {
  const factoryApi = testClientAPI();

  it("wins over every ambient signal (vscode host present)", async () => {
    mockGetVscodeApi.mockReturnValue(testVscodeApi());
    addHostCapabilities(["http_request"]);
    const dirs: string[] = [];
    setApiFactory((logDir) => {
      dirs.push(logDir);
      return factoryApi;
    }, "file:///hawk/logs");

    const backend = resolveBackend(noneSource);

    await expect(backend.resolveLogRoot()).resolves.toEqual({
      logs: [],
      log_dir: "file:///hawk/logs",
    });
    expect(backend.createApi("file:///hawk/logs")).toBe(factoryApi);
    // A dir change (setLogRoot) re-calls createApi on the same bootstrap.
    backend.createApi("file:///other");
    expect(dirs).toEqual(["file:///hawk/logs", "file:///other"]);
    expect(mockApiVscode).not.toHaveBeenCalled();
    expect(backend.capabilities).toEqual({
      downloadLogs: false,
      streamSamples: false,
    });
  });

  it("without initialLogDir, a dir source seeds root discovery", async () => {
    setApiFactory(() => factoryApi);

    const backend = resolveBackend(dirSource("/logs"));

    await expect(backend.resolveLogRoot()).resolves.toEqual({
      logs: [],
      log_dir: "/logs",
    });
  });

  it("without any dir, root discovery rejects with an actionable message", async () => {
    setApiFactory(() => factoryApi);

    const backend = resolveBackend(noneSource);

    await expect(backend.resolveLogRoot()).rejects.toThrow(
      /initialLogDir or a \?log_dir= URL param/i
    );
  });

  it("a bare single-file ref resolves against the embedder's dir", async () => {
    // resolveSingleFileLogDir consults resolveConfiguredDir for a bare
    // `?log_file=task.eval`; without this it would fall through to the
    // folder serving the page, which is meaningless in-process.
    setApiFactory(() => factoryApi, "file:///hawk/logs");

    const backend = resolveBackend(fileSource("task.eval"));

    await expect(backend.resolveConfiguredDir?.()).resolves.toBe(
      "file:///hawk/logs"
    );
  });

  it("installing after the backend has resolved throws instead of being ignored", () => {
    resolveBackend(noneSource);

    expect(() => setApiFactory(() => factoryApi)).toThrow(
      /before initializeStore/i
    );
  });
});

// The update-extension error must reach the user in BOTH VS Code launch
// modes. The config gate renders the resolution rejection's message, so
// pinning the message on loadResolvedAppConfig pins what the user reads.
// The modes fail at different stages: dir mode in dir discovery
// (resolveLogRoot), embedded single-file in construction (createApi — the
// dir comes from #logview-state, so discovery never touches the backend).
describe("legacy vscode host error reaches config resolution", () => {
  const legacyHostBootstrap = (singleFileMode: boolean): AppConfigBootstrap => {
    mockGetVscodeApi.mockReturnValue(testVscodeApi());
    return {
      backend: resolveBackend(noneSource),
      singleFileMode,
      loader: singleFileMode ? "direct" : "replicator",
    };
  };

  it("dir mode: rejects with the update-extension message", async () => {
    await expect(
      loadResolvedAppConfig(legacyHostBootstrap(false))
    ).rejects.toThrow(/update the Inspect AI extension/i);
  });

  it("single-file embedded mode: rejects with the update-extension message", async () => {
    addJsonScript("logview-state", {
      type: "updateState",
      url: "/abs/logs/task.eval",
    });
    await expect(
      loadResolvedAppConfig(legacyHostBootstrap(true))
    ).rejects.toThrow(/update the Inspect AI extension/i);
  });
});
