// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { type PropsWithChildren } from "react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { ComponentStateProvider } from "@tsmono/react/state";
import { makeStateHooks, ResizeObserverStub } from "@tsmono/react/testing";

import { normalizeStatus } from "../../../api/normalize";
import { createAppConfig, createStatus } from "../../../test/objectFactories";
import { server } from "../../../test/setup-msw";
import { createTestWrapper } from "../../../test/test-utils";
import type { AppConfig, Status } from "../../../types/api-types";
import { useAppConfigAsync } from "../../server/useAppConfig";

import { ScannerSidebar } from "./ScannerSidebar";

// jsdom has no scrollTo; VirtualList calls it during mount.
beforeEach(() => {
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
  Element.prototype.scrollTo = function () {};
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// A plain-object status, as React Query's structural sharing hands back.
it("does not throw for a summary scanner named constructor that the spec lacks", () => {
  const Wrapper = createTestWrapper();
  const status = createStatus({
    summary: {
      complete: true,
      scanners: {
        constructor: {
          errors: 0,
          metrics: null,
          model_usage: {},
          results: 1,
          scans: 1,
          tokens: 0,
          unscored: 0,
          validation: null,
        },
      },
    },
  });
  expect(() =>
    render(
      <Wrapper>
        <ComponentStateProvider hooks={makeStateHooks()}>
          <MemoryRouter>
            <ScannerSidebar selectedScan={status} />
          </MemoryRouter>
        </ComponentStateProvider>
      </Wrapper>
    )
  ).not.toThrow();
});

// Rows read the scan route, which needs the loaded app config.
const AppConfigGate = ({ children }: PropsWithChildren) => {
  const { data } = useAppConfigAsync();
  return data ? <>{children}</> : null;
};

const renderSidebar = (status: Status) => {
  server.use(
    http.get("/api/v2/app-config", () =>
      HttpResponse.json<AppConfig>(createAppConfig())
    )
  );
  const Wrapper = createTestWrapper();
  render(
    <Wrapper>
      <AppConfigGate>
        <ComponentStateProvider hooks={makeStateHooks()}>
          <MemoryRouter>
            <ScannerSidebar selectedScan={status} />
          </MemoryRouter>
        </ComponentStateProvider>
      </AppConfigGate>
    </Wrapper>
  );
};

it("shows an unscored count only for scanners that have unscored results", async () => {
  // jsdom has no layout; the virtualizer sizes its viewport from clientHeight.
  vi.spyOn(Element.prototype, "clientHeight", "get").mockReturnValue(600);
  renderSidebar(
    normalizeStatus({
      ...createStatus(),
      summary: {
        scanners: {
          alpha: { results: 3, unscored: 4 },
          beta: { results: 1, unscored: 0 },
          // Written before scans recorded an unscored count.
          gamma: { results: 2 },
        },
      },
    })
  );
  expect(await screen.findByText("gamma")).toBeTruthy();
  const unscored = screen.getAllByText("Unscored");
  expect(unscored).toHaveLength(1);
  expect(unscored[0]?.closest("button")?.textContent).toContain("alpha");
  expect(unscored[0]?.parentElement?.textContent).toBe("Unscored4");
});
