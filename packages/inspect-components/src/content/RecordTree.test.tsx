// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ComponentIconProvider } from "@tsmono/react/components";
import { ComponentStateProvider } from "@tsmono/react/state";
import { makeStateHooks, testIcons } from "@tsmono/react/testing";

import { RecordTree } from "./RecordTree";

const renderTree = (
  record: Record<string, unknown>,
  props?: { copyButton?: boolean; defaultExpandLevel?: number }
) =>
  render(
    <ComponentStateProvider hooks={makeStateHooks()}>
      <ComponentIconProvider icons={testIcons}>
        <RecordTree id="test-tree" record={record} {...props} />
      </ComponentIconProvider>
    </ComponentStateProvider>
  );

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

describe("RecordTree copy button", () => {
  const writeText = vi.fn(() => Promise.resolve());

  beforeEach(() => {
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    writeText.mockClear();
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("renders no copy buttons by default", () => {
    renderTree({ name: "value" });
    expect(screen.queryByRole("button", { name: /copy/i })).toBeNull();
  });

  it("copies leaf string values verbatim", async () => {
    renderTree({ name: "hello world" }, { copyButton: true });
    const button = screen.getByRole("button", { name: "Copy name" });
    fireEvent.click(button);
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith("hello world");
    });
  });

  it("copies leaf number values as strings", async () => {
    renderTree({ count: 42 }, { copyButton: true });
    fireEvent.click(screen.getByRole("button", { name: "Copy count" }));
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith("42");
    });
  });

  it("copies collapsed subtrees as pretty-printed JSON", async () => {
    renderTree(
      { nested: { a: 1, b: "two" } },
      { copyButton: true, defaultExpandLevel: 0 }
    );
    fireEvent.click(screen.getByRole("button", { name: "Copy nested" }));
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(
        JSON.stringify({ a: 1, b: "two" }, null, 2)
      );
    });
  });

  it("renders no copy button for expanded parent rows", () => {
    renderTree(
      { nested: { a: 1 }, leaf: "x" },
      { copyButton: true, defaultExpandLevel: 2 }
    );
    expect(screen.queryByRole("button", { name: "Copy nested" })).toBeNull();
    expect(screen.getByRole("button", { name: "Copy a" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Copy leaf" })).toBeTruthy();
  });
});
