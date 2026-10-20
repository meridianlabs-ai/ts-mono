// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ComponentStateProvider } from "@tsmono/react/state";
import { makeStateHooks, ResizeObserverStub } from "@tsmono/react/testing";

import { RecordTree, toTreeItems } from "./RecordTree";

const renderTree = (
  record: Record<string, unknown>,
  props?: { copyButton?: boolean; defaultExpandLevel?: number }
) =>
  render(
    <ComponentStateProvider hooks={makeStateHooks()}>
      <RecordTree id="test-tree" record={record} {...props} />
    </ComponentStateProvider>
  );

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

describe("toTreeItems", () => {
  const items = Array.from({ length: 216_217 }, (_, id) => ({ id }));

  it("groups the children of a huge array into ranges", () => {
    const tree = toTreeItems({ items }, (_id, hasChildren, depth) => {
      // Collapse the ranges (depth 1); expand everything else.
      return hasChildren && depth === 1;
    });
    expect(tree).toHaveLength(1 + 217);
    expect(tree.slice(1, 3)).toMatchObject([
      { key: "[0 … 999]", depth: 1, childCount: 1000, isCollapsed: true },
      { key: "[1000 … 1999]", depth: 1, childCount: 1000, isCollapsed: true },
    ]);
    expect(tree.at(-1)).toMatchObject({ key: "[216000 … 216216]", childCount: 217 });
  });

  it("expands every range of an array with hundreds of thousands of items", () => {
    const tree = toTreeItems({ items }, () => false);
    // The array row, a row per range, then an object row and an `id` row per item.
    expect(tree).toHaveLength(1 + 217 + items.length * 2);
    expect(tree.at(-1)).toMatchObject({ key: "id", value: 216_216, depth: 3 });
  });

  it("lists up to a range's worth of children directly", () => {
    const tree = toTreeItems({ items: items.slice(0, 1000) }, () => false);
    expect(tree[1]).toMatchObject({ key: "[0]", depth: 1 });
    expect(tree).toHaveLength(1 + 1000 * 2);
  });
});
