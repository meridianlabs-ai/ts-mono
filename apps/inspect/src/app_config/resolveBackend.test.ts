// @vitest-environment jsdom
import { http, HttpResponse } from "msw";
import { afterEach, describe, expect, it, vi } from "vitest";

import { testClientAPI } from "../client/api/testClientApi";
import {
  connectFakeExtension,
  installVscodeHost,
  okJson,
  uninstallVscodeHost,
  type ProxyRequest,
} from "../client/api/vscode/testExtensionHost";
import { setupMswServer } from "../test/mswServer";

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
// (createApi) — so the tests assert WHERE each stage's requests go: the
// browser's fetch (MSW) for the view server and static deployments, or the
// VS Code host's http_request proxy (a fake extension host).

const server = setupMswServer();

/** Every request that reached the network, as path + query. */
let network: string[] = [];

/**
 * Answer every request: a view-server root probe, its configured dir, an
 * empty listing (view-server or static manifest).
 */
const serveAll = () =>
  server.use(
    http.all("*", ({ request }) => {
      const url = new URL(request.url);
      network.push(url.pathname + url.search);
      switch (url.pathname) {
        case "/api/logs":
          return HttpResponse.json({ logs: [], log_dir: "/probed" });
        case "/api/log-dir":
          return HttpResponse.json({ log_dir: "/configured" });
        case "/api/log-files":
          return HttpResponse.json({ files: [], response_type: "full" });
        default:
          // A static deployment's listing.json manifest.
          return HttpResponse.json({});
      }
    })
  );

// The VS Code extension host, answering the viewer's http_request proxy. One
// host for the file: the viewer memoizes `acquireVsCodeApi()`'s result.
const hostRequests: ProxyRequest[] = [];
const { vscode: vscodeHost } = connectFakeExtension((req) => {
  hostRequests.push(req);
  return req.path.startsWith("/api/logs")
    ? okJson({ logs: [], log_dir: "file:///host/logs" })
    : okJson({ files: [], response_type: "full" });
});

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
  document.getElementById("logview-state")?.remove();
  uninstallVscodeHost();
  hostRequests.length = 0;
  network = [];
  vi.restoreAllMocks();
});

describe("resolveBackend transport", () => {
  it("only the static backend fetches log locations from the browser", () => {
    setSearch("");
    expect(resolveBackend(dirSource("logs")).browserDirect).toBe(true);
    expect(resolveBackend(fileSource("run.eval")).browserDirect).toBe(true);
    expect(resolveBackend(noneSource).browserDirect).toBe(false);
    setSearch("?inspect_server=true");
    expect(resolveBackend(dirSource("logs")).browserDirect).toBe(false);
  });
});

describe("resolveBackend selection", () => {
  it("vscode host with http_request capability → vscode backend (wins over source)", async () => {
    installVscodeHost(vscodeHost, ["http_request"]);
    serveAll();
    const listeners = vi.spyOn(window, "addEventListener");

    const backend = resolveBackend(dirSource("/url/logs"));

    await expect(backend.resolveLogRoot()).resolves.toMatchObject({
      log_dir: "file:///host/logs",
    });
    await backend.createApi("file:///logs").get_logs(0, 0);

    // Both stages ride the host's proxy, never the browser's fetch.
    expect(hostRequests.map((req) => req.path)).toEqual([
      "/api/logs",
      `/api/log-files?log_dir=${encodeURIComponent("file:///logs")}`,
    ]);
    expect(network).toEqual([]);
    // One transport, built once, shared by the probe and every instance.
    expect(
      listeners.mock.calls.filter(([type]) => type === "message")
    ).toHaveLength(1);
    expect(backend.capabilities).toEqual({
      downloadLogs: false,
      streamSamples: true,
    });
  });

  it("vscode host WITHOUT http_request capability → unsupported (update-extension error)", async () => {
    installVscodeHost(vscodeHost);
    // No #inspect-host-capabilities marker — a legacy named-RPC-only host.

    const backend = resolveBackend(noneSource);

    await expect(backend.resolveLogRoot()).rejects.toThrow(
      /update the Inspect AI extension/i
    );
    expect(() => backend.createApi("/logs")).toThrow(
      /update the Inspect AI extension/i
    );
    expect(hostRequests).toEqual([]);
  });

  it("#log_dir_context with log_dir → static-http backend with that dir", async () => {
    addLogDirContext({ log_dir: "/embedded/logs" });
    serveAll();
    const backend = resolveBackend(noneSource);

    await expect(backend.resolveLogRoot()).resolves.toMatchObject({
      log_dir: "http://localhost:3000/embedded/logs",
    });
    await backend.createApi("/embedded/logs").get_logs(0, 0);

    expect(network).toEqual(["/embedded/logs/listing.json"]);
  });

  it("#log_dir_context with trust_content → passes it in the static app config", async () => {
    addLogDirContext({ log_dir: "/embedded/logs", trust_content: false });
    const backend = resolveBackend(noneSource);

    await expect(
      backend.createApi("/embedded/logs").get_app_config()
    ).resolves.toEqual({
      inspect_version: "unknown",
      scout_version: null,
      trust_content: false,
    });
  });

  it("#log_dir_context with log_file → static-http single-file with derived dir", async () => {
    addLogDirContext({ log_file: "/embedded/logs/task.eval" });
    serveAll();
    const backend = resolveBackend(noneSource);

    // Construction dir comes from the caller (the resolved config); the api
    // needs nothing else — single-file fetching passes file paths per call.
    await backend.createApi("/embedded/logs").get_logs(0, 0);

    expect(network).toEqual(["/embedded/logs/listing.json"]);
  });

  it("?inspect_server=true with dir source → view-server backend probing that dir", async () => {
    setSearch("?inspect_server=true");
    serveAll();
    const backend = resolveBackend(dirSource("/logs"));

    await backend.resolveLogRoot();
    await backend.createApi("file:///abs/logs").get_logs(0, 0);

    expect(network).toEqual([
      `/api/logs?log_dir=${encodeURIComponent("/logs")}`,
      `/api/log-files?log_dir=${encodeURIComponent("file:///abs/logs")}`,
    ]);
  });

  it("dir source, no other signal → static-http backend", async () => {
    serveAll();
    const backend = resolveBackend(dirSource("/logs"));

    // Static discovery is the configured dir itself: no request.
    await expect(backend.resolveLogRoot()).resolves.toMatchObject({
      log_dir: "http://localhost:3000/logs",
    });
    expect(network).toEqual([]);

    await backend.createApi("http://localhost:3000/logs").get_logs(0, 0);
    expect(network).toEqual(["/logs/listing.json"]);
  });

  it("file source, no other signal → static-http single-file (no dir-mode root)", async () => {
    serveAll();
    const backend = resolveBackend(fileSource("foo.eval"));

    // No dir was configured, so dir-mode discovery has nothing to enumerate
    // (single-file resolution derives the dir from the file instead).
    await expect(backend.resolveLogRoot()).rejects.toThrow(
      /unable to determine log paths/i
    );

    await backend.createApi("http://localhost:3000").get_logs(0, 0);
    expect(network).toEqual(["/listing.json"]);
  });

  it("no source, no signal → view-server backend (server-configured dir)", async () => {
    serveAll();
    const backend = resolveBackend(noneSource);

    await expect(backend.resolveLogRoot()).resolves.toMatchObject({
      log_dir: "/probed",
    });
    await expect(backend.resolveConfiguredDir?.()).resolves.toBe("/configured");
    await backend.createApi("file:///probed").get_logs(0, 0);

    expect(network).toEqual([
      "/api/logs",
      "/api/log-dir",
      `/api/log-files?log_dir=${encodeURIComponent("file:///probed")}`,
    ]);
    expect(backend.capabilities).toEqual({
      downloadLogs: true,
      streamSamples: true,
    });
  });
});

describe("embedder api factory (setApiFactory)", () => {
  const factoryApi = testClientAPI();

  it("wins over every ambient signal (vscode host present)", async () => {
    installVscodeHost(vscodeHost, ["http_request"]);
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
    expect(hostRequests).toEqual([]);
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
    installVscodeHost(vscodeHost);
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
