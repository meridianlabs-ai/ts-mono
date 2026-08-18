import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { testInfoEvent } from "@tsmono/inspect-common/testing";
import type { InfoEvent, JsonValue } from "@tsmono/inspect-common/types";
import { ComponentNavigationProvider } from "@tsmono/react/components";
import {
  ComponentStateHooks,
  ComponentStateProvider,
} from "@tsmono/react/state";

import { InfoEventView } from "./InfoEventView";
import { EventNode } from "./types";

const stateHooks: ComponentStateHooks = {
  useValue: (_id, _prop, defaultValue) => defaultValue,
  useSetValue: () => () => {},
  useRemoveValue: () => () => {},
  useEntries: () => undefined,
  useRemoveAll: () => () => {},
  useRemoveByPrefix: () => () => {},
};

function makeNode(data: JsonValue): EventNode<InfoEvent> {
  return new EventNode<InfoEvent>(
    "info-1",
    testInfoEvent({
      source: "test-source",
      data,
      timestamp: new Date(0).toISOString(),
      uuid: "info-1",
    }),
    0
  );
}

const renderView = (data: JsonValue) =>
  render(
    <ComponentStateProvider hooks={stateHooks}>
      <ComponentNavigationProvider navigation={{ navigate: () => {} }}>
        <InfoEventView eventNode={makeNode(data)} />
      </ComponentNavigationProvider>
    </ComponentStateProvider>
  );

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

describe("InfoEventView", () => {
  beforeEach(() => {
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("renders string data without React key warnings", () => {
    const consoleError = vi.spyOn(console, "error");
    renderView("hello **world**");
    expect(screen.getByText(/Info: test-source/)).toBeDefined();
    const keyWarnings = consoleError.mock.calls.filter((args) =>
      String(args[0]).includes('unique "key" prop')
    );
    expect(keyWarnings).toEqual([]);
  });

  it("renders object data without React key warnings", () => {
    const consoleError = vi.spyOn(console, "error");
    renderView({ foo: "bar" });
    const keyWarnings = consoleError.mock.calls.filter((args) =>
      String(args[0]).includes('unique "key" prop')
    );
    expect(keyWarnings).toEqual([]);
  });
});
