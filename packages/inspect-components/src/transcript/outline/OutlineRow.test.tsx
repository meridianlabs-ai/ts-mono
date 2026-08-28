// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  testModelEvent,
  testSpanBeginEvent,
} from "@tsmono/inspect-common/testing";

import { eventNode } from "../testHelpers";

import { OutlineLoadingRow, OutlineRow } from "./OutlineRow";
import styles from "./OutlineRow.module.css";

describe("OutlineLoadingRow", () => {
  afterEach(() => cleanup());

  it("renders a row-shaped loading affordance with a spinner and label", () => {
    const { container } = render(<OutlineLoadingRow />);
    expect(screen.getByText("loading")).toBeDefined();
    // Uses the outline row layout so it reads as the next item in the tree.
    expect(container.querySelector(`.${styles.eventRow}`)).not.toBeNull();
    expect(container.querySelector(`.${styles.spinner}`)).not.toBeNull();
  });

  it("exposes a polite live-region status", () => {
    const { container } = render(<OutlineLoadingRow />);
    const status = container.querySelector('[role="status"]');
    expect(status).not.toBeNull();
    expect(status!.getAttribute("aria-live")).toBe("polite");
  });
});

// =============================================================================
// Collapse chevron
// =============================================================================

describe("OutlineRow collapse chevron", () => {
  afterEach(() => cleanup());

  const parentNode = () =>
    eventNode(testSpanBeginEvent({ name: "phase one", type: null }), [
      eventNode(testModelEvent()),
    ]);

  it("shows a down chevron on expanded rows and toggles to collapsed", () => {
    const setCollapsed = vi.fn<(id: string, collapsed: boolean) => void>();
    const node = parentNode();
    const { container } = render(
      <OutlineRow
        node={node}
        getCollapsed={() => false}
        setCollapsed={setCollapsed}
      />
    );

    expect(container.querySelector("i.bi-chevron-down")).not.toBeNull();
    fireEvent.click(container.querySelector(`.${styles.toggle}`)!);
    expect(setCollapsed).toHaveBeenCalledWith(node.id, true);
  });

  it("shows a right chevron on collapsed rows and toggles to expanded", () => {
    const setCollapsed = vi.fn<(id: string, collapsed: boolean) => void>();
    const node = parentNode();
    const { container } = render(
      <OutlineRow
        node={node}
        getCollapsed={() => true}
        setCollapsed={setCollapsed}
      />
    );

    expect(container.querySelector("i.bi-chevron-right")).not.toBeNull();
    fireEvent.click(container.querySelector(`.${styles.toggle}`)!);
    expect(setCollapsed).toHaveBeenCalledWith(node.id, false);
  });

  it("renders no chevron for leaf rows and ignores toggle clicks", () => {
    const setCollapsed = vi.fn<(id: string, collapsed: boolean) => void>();
    const { container } = render(
      <OutlineRow
        node={eventNode(testModelEvent())}
        getCollapsed={() => false}
        setCollapsed={setCollapsed}
      />
    );

    expect(container.querySelector("i.bi-chevron-down")).toBeNull();
    expect(container.querySelector("i.bi-chevron-right")).toBeNull();
    fireEvent.click(container.querySelector(`.${styles.toggle}`)!);
    expect(setCollapsed).not.toHaveBeenCalled();
  });
});

// =============================================================================
// Keyboard activation
// =============================================================================

describe("OutlineRow keyboard activation", () => {
  afterEach(() => cleanup());

  const parentNode = () =>
    eventNode(testSpanBeginEvent({ name: "phase one", type: null }), [
      eventNode(testModelEvent()),
    ]);

  it("activates the row when the row itself takes the key press", () => {
    const onSelect = vi.fn<(id: string) => void>();
    const node = parentNode();
    const { container } = render(
      <OutlineRow node={node} onSelect={onSelect} getCollapsed={() => false} />
    );

    fireEvent.keyDown(container.querySelector(`.${styles.eventRow}`)!, {
      key: "Enter",
    });
    expect(onSelect).toHaveBeenCalledWith(node.id);
  });

  // The row handler sees Enter bubbling up from the chevron. Acting on it
  // would both navigate the row and — via preventDefault anywhere on the
  // propagation path — cancel the button's own activation.
  it("leaves key presses that bubble from the collapse chevron alone", () => {
    const onSelect = vi.fn<(id: string) => void>();
    const { container } = render(
      <OutlineRow
        node={parentNode()}
        onSelect={onSelect}
        getCollapsed={() => false}
        setCollapsed={vi.fn()}
      />
    );

    const event = new KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true,
    });
    container.querySelector(`.${styles.toggle}`)!.dispatchEvent(event);

    expect(onSelect).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });
});
