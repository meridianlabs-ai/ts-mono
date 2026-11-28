// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  testInfoEvent,
  testModelEvent,
  testToolEvent,
} from "@tsmono/inspect-common/testing";

import { eventNode } from "../testHelpers";
import type { TranscriptCollapseState } from "../types";

import { useTranscriptCollapse } from "./useTranscriptCollapse";

// =============================================================================
// Fixtures
// =============================================================================

function makeCollapseState(overrides?: Partial<TranscriptCollapseState>) {
  return {
    onCollapseTranscript: vi.fn<(nodeId: string, collapsed: boolean) => void>(),
    onSetTranscriptCollapsed: vi.fn<(ids: Record<string, boolean>) => void>(),
    ...overrides,
  };
}

function render(
  options: Partial<Parameters<typeof useTranscriptCollapse>[0]> = {}
) {
  return renderHook(
    (p: Parameters<typeof useTranscriptCollapse>[0]) =>
      useTranscriptCollapse(p),
    {
      initialProps: {
        eventNodes: [],
        eventCount: 1,
        ...options,
      },
    }
  );
}

// =============================================================================
// Individual toggles
// =============================================================================

describe("useTranscriptCollapse → onCollapseTranscript", () => {
  it("records only the toggle, so defaults keep applying to other nodes", () => {
    const collapseState = makeCollapseState();
    const { result } = render({ collapseState });

    result.current.onCollapseTranscript("c", true);

    expect(collapseState.onCollapseTranscript).toHaveBeenCalledWith("c", true);
    expect(collapseState.onSetTranscriptCollapsed).not.toHaveBeenCalled();
  });
});

// =============================================================================
// Batched expansion
// =============================================================================

describe("useTranscriptCollapse → onExpandNodes", () => {
  it("adds the expansions to the recorded choices in one update", () => {
    const collapseState = makeCollapseState({
      transcript: { a: true, c: true },
    });
    const { result } = render({ collapseState });

    result.current.onExpandNodes?.(["a", "b"]);

    expect(collapseState.onSetTranscriptCollapsed).toHaveBeenCalledWith({
      a: false,
      b: false,
      c: true,
    });
  });

  it("records only the expansions while nothing is recorded", () => {
    const collapseState = makeCollapseState();
    const { result } = render({ collapseState });

    result.current.onExpandNodes?.(["a"]);

    expect(collapseState.onSetTranscriptCollapsed).toHaveBeenCalledWith({
      a: false,
    });
  });

  it("is undefined when the store provides no bulk setter", () => {
    const { result } = render({
      collapseState: { onCollapseTranscript: vi.fn() },
    });
    expect(result.current.onExpandNodes).toBeUndefined();
  });
});

// =============================================================================
// Bulk collapse/expand
// =============================================================================

describe("useTranscriptCollapse → bulkCollapse", () => {
  it("bulk-expands by recording every collapsible node as expanded", () => {
    const tool = eventNode(testToolEvent());
    const model = eventNode(testModelEvent());
    const info = eventNode(testInfoEvent());
    const collapseState = makeCollapseState();
    render({
      collapseState,
      bulkCollapse: "expand",
      eventNodes: [tool, model, info],
    });
    expect(collapseState.onSetTranscriptCollapsed).toHaveBeenCalledWith({
      [tool.id]: false,
      [model.id]: false,
    });
  });

  it("bulk-collapses every collapsible node", () => {
    const tool = eventNode(testToolEvent());
    const model = eventNode(testModelEvent());
    const info = eventNode(testInfoEvent());
    const collapseState = makeCollapseState();
    render({
      collapseState,
      bulkCollapse: "collapse",
      eventNodes: [tool, model, info],
    });
    expect(collapseState.onSetTranscriptCollapsed).toHaveBeenCalledWith({
      [tool.id]: true,
      [model.id]: true,
    });
  });

  it("does nothing without events", () => {
    const collapseState = makeCollapseState();
    render({ collapseState, bulkCollapse: "collapse", eventCount: 0 });
    expect(collapseState.onSetTranscriptCollapsed).not.toHaveBeenCalled();
  });
});
