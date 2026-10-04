// @vitest-environment jsdom
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
  resolveBootstrap,
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

  it("embedded #logview-state → single-file / direct loader", () => {
    setSearch("");
    addEmbedded("/abs/logs/task.eval");
    const config = resolveBootstrap();
    expect(config.singleFileMode).toBe(true);
    expect(config.loader).toBe("direct");
  });
});

// Only a location the browser would fetch itself, from an origin other than
// the page's, is a proposal; everything else resolves without a gate.
describe("resolveBootstrap log location trust", () => {
  const addLogDirContext = (json: object) => {
    const el = document.createElement("script");
    el.id = "log_dir_context";
    el.type = "application/json";
    el.textContent = JSON.stringify(json);
    document.body.appendChild(el);
  };
  afterEach(() => document.getElementById("log_dir_context")?.remove());

  it("a same-origin ?log_dir= is trusted", () => {
    setSearch("?log_dir=logs");
    expect(resolveBootstrap().logLocationProposal).toBeUndefined();
  });

  it("a cross-origin ?log_dir= is a proposal", () => {
    setSearch("?log_dir=https://bucket.example/logs");
    expect(resolveBootstrap().logLocationProposal).toEqual({
      kind: "dir",
      location: "https://bucket.example/logs",
      origin: "https://bucket.example",
    });
  });

  it("a cross-origin ?log_file= is a proposal even with an embedded log dir", () => {
    // #log_dir_context fixes the dir, but the file param would still be
    // selected and fetched — it's the link's choice, not the publisher's.
    addLogDirContext({ log_dir: "logs" });
    setSearch("?log_file=https://bucket.example/run.eval");
    expect(resolveBootstrap().logLocationProposal).toMatchObject({
      kind: "file",
      origin: "https://bucket.example",
    });
  });

  it("a cross-origin ?log_dir= the embedded context overrides is never read, so not proposed", () => {
    addLogDirContext({ log_dir: "logs" });
    setSearch("?log_dir=https://bucket.example/logs");
    expect(resolveBootstrap().logLocationProposal).toBeUndefined();
  });

  it("a server-proxied location is the server's call, not a proposal", () => {
    setSearch("?log_dir=https://bucket.example/logs&inspect_server=true");
    expect(resolveBootstrap().logLocationProposal).toBeUndefined();
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
