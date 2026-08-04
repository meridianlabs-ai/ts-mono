import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { ClientAPI } from "../client/api/types";

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

describe("setLogRoot", () => {
  const seedConfig = (): AppConfig =>
    initAppConfig({
      api: {} as ClientAPI,
      singleFileMode: true,
      loader: "direct",
      inspect_version: "1",
      scout_version: null,
      logDir: "file:///logs",
    });

  it("no-ops on an unchanged dir, preserving config identity", () => {
    // A same-dir host updateState (e.g. the embedded startup blob
    // re-dispatched through onMessage) must not rebuild the api or restart
    // the fetch engine — both key off config identity.
    const prev = seedConfig();
    setLogRoot("file:///logs");
    expect(getAppConfig()).toBe(prev);
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
