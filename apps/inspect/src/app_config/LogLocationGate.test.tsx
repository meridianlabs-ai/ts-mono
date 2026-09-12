import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { ButtonHTMLAttributes } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { testClientAPI } from "../client/api/testClientApi";

import { AppConfig } from "./appConfig";
import { LogLocationGate } from "./LogLocationGate";

vi.mock("@vscode-elements/react-elements", () => ({
  VscodeButton: ({
    children,
    ...props
  }: ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>{children}</button>
  ),
}));

const setLogRoot = vi.hoisted(() => vi.fn());
vi.mock("./appConfig", async (original) => ({
  ...(await original<typeof import("./appConfig")>()),
  setLogRoot,
}));

const config = (logDir: string): AppConfig => ({
  api: testClientAPI(),
  singleFileMode: false,
  loader: "replicator",
  inspect_version: "1",
  scout_version: null,
  logDir,
  browserDirect: false,
  locationScope: { kind: "directory", location: logDir },
});

afterEach(() => {
  cleanup();
  window.history.replaceState({}, "", "/");
  setLogRoot.mockReset();
});

describe("runtime updateState proposals", () => {
  it("does not trust a null-source message in a VS Code-style proxy", () => {
    render(
      <LogLocationGate config={config("/logs")}>
        <div>viewer</div>
      </LogLocationGate>
    );

    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: {
            type: "updateState",
            url: "file%3A%2F%2F%2Flogs%2Fnext.eval",
          },
          source: null,
        })
      );
    });

    expect(screen.getByTestId("log-location-gate")).toBeVisible();
    expect(setLogRoot).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("approve-log-location"));
    expect(setLogRoot).toHaveBeenCalledWith("file:///logs", {
      kind: "file",
      location: "file:///logs/next.eval",
    });
  });

  it("resolves an approved relative message below the current proxy root", () => {
    render(
      <LogLocationGate config={config("/logs")}>
        <div>viewer</div>
      </LogLocationGate>
    );

    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: { type: "updateState", url: "nested/run.eval" },
        })
      );
    });
    fireEvent.click(screen.getByTestId("approve-log-location"));

    expect(setLogRoot).toHaveBeenCalledWith("/logs/nested", {
      kind: "file",
      location: "/logs/nested/run.eval",
    });
  });
});

describe("proxied hash locations", () => {
  it.each([
    ["view-server", "/server/logs"],
    ["VS Code proxy", "file:///workspace/logs"],
  ])("blocks encoded traversal for %s", (_name, logDir) => {
    window.history.replaceState({}, "", "/#/logs/..%2Fprivate.eval");

    render(
      <LogLocationGate config={config(logDir)}>
        <div>viewer</div>
      </LogLocationGate>
    );

    expect(screen.getByTestId("log-location-gate")).toBeVisible();
    expect(
      screen.queryByTestId("approve-log-location")
    ).not.toBeInTheDocument();
    expect(screen.getByText(/unsafe path segment/i)).toBeVisible();
  });

  it("keeps a safe relative proxied hash automatic", () => {
    window.history.replaceState({}, "", "/#/logs/nested/run.eval");

    render(
      <LogLocationGate config={config("/server/logs")}>
        <div>viewer</div>
      </LogLocationGate>
    );

    expect(screen.getByText("viewer")).toBeVisible();
    expect(screen.queryByTestId("log-location-gate")).not.toBeInTheDocument();
  });
});
