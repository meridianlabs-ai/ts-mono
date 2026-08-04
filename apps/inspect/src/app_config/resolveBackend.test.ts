import { afterEach, describe, expect, it, vi } from "vitest";

import { getVscodeApi } from "@tsmono/util";

import staticHttpApi, {
  staticLogRoot,
} from "../client/api/static-http/api-static-http";
import {
  fetchViewServerLogDir,
  fetchViewServerLogRoot,
  viewServerApi,
} from "../client/api/view-server/api-view-server";
import {
  apiVscode,
  createVscodeProxyFetch,
} from "../client/api/vscode/api-vscode";

import { resolveBackend } from "./resolveBackend";
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
  setSearch("");
  document.getElementById("log_dir_context")?.remove();
  document.getElementById("inspect-host-capabilities")?.remove();
  mockGetVscodeApi.mockReset();
  mockStaticHttpApi.mockClear();
  mockStaticLogRoot.mockClear();
  mockViewServerApi.mockClear();
  mockFetchLogRoot.mockClear();
  mockFetchLogDir.mockClear();
  mockApiVscode.mockClear();
  mockCreateProxyFetch.mockClear();
});

describe("resolveBackend selection", () => {
  it("vscode host with http_request capability → vscode backend (wins over source)", async () => {
    const vscode = {} as NonNullable<ReturnType<typeof getVscodeApi>>;
    mockGetVscodeApi.mockReturnValue(vscode);
    addHostCapabilities(["http_request"]);

    const backend = resolveBackend(noneSource);

    // One transport, built once, shared by the probe and every instance.
    expect(mockCreateProxyFetch).toHaveBeenCalledTimes(1);
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
    mockGetVscodeApi.mockReturnValue(
      {} as NonNullable<ReturnType<typeof getVscodeApi>>
    );
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
