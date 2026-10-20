// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { ComponentStateProvider } from "@tsmono/react/state";
import { makeStateHooks, ResizeObserverStub } from "@tsmono/react/testing";

import { createStatus } from "../../../test/objectFactories";
import { createTestWrapper } from "../../../test/test-utils";

import { ScannerSidebar } from "./ScannerSidebar";

// jsdom has no scrollTo; VirtualList calls it during mount.
beforeEach(() => {
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
  Element.prototype.scrollTo = function () {};
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
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
