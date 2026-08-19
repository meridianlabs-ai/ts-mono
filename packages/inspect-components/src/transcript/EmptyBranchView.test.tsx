import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { testSpanBeginEvent } from "@tsmono/inspect-common/testing";
import type { SpanBeginEvent } from "@tsmono/inspect-common/types";

import { EmptyBranchView } from "./EmptyBranchView";
import { EventNode } from "./types";

function makeNode(
  metadata: Record<string, unknown> | null
): EventNode<SpanBeginEvent> {
  return new EventNode<SpanBeginEvent>(
    "node-1",
    testSpanBeginEvent({
      name: "Branch 2 (empty)",
      id: "emptybranch-empty",
      span_id: "emptybranch-empty",
      type: "empty_branch",
      timestamp: new Date(0).toISOString(),
      uuid: "emptybranch-empty",
      metadata,
    }),
    0
  );
}

describe("EmptyBranchView", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders headline regardless of terminator", () => {
    render(
      <EmptyBranchView
        eventNode={makeNode({
          empty_branch: { branchName: "Branch 2", terminator: null },
        })}
      />
    );
    expect(screen.getByText(/no events in this branch/i)).toBeDefined();
  });

  it("renders detail line with terminator when present", () => {
    render(
      <EmptyBranchView
        eventNode={makeNode({
          empty_branch: {
            branchName: "Branch 2",
            terminator: "restart_conversation",
          },
        })}
      />
    );
    expect(screen.getByText(/branch ended via/i)).toBeDefined();
    expect(screen.getByText("restart_conversation")).toBeDefined();
  });

  it("omits detail line when terminator is null", () => {
    const { container } = render(
      <EmptyBranchView
        eventNode={makeNode({
          empty_branch: { branchName: "Branch 2", terminator: null },
        })}
      />
    );
    expect(container.querySelector("code")).toBeNull();
  });

  it("renders null when metadata is missing", () => {
    const { container } = render(
      <EmptyBranchView eventNode={makeNode(null)} />
    );
    expect(container.innerHTML).toBe("");
  });
});
