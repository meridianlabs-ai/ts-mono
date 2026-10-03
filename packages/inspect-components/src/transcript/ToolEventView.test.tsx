// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  testApprovalEvent,
  testSentinelEvent,
  testToolCall,
  testToolEvent,
} from "@tsmono/inspect-common/testing";
import type {
  ApprovalEvent,
  JsonValue,
  ToolEvent,
} from "@tsmono/inspect-common/types";
import {
  ComponentNavigationProvider,
  ContentTrustProvider,
} from "@tsmono/react/components";
import { ComponentStateProvider } from "@tsmono/react/state";
import { makeStateHooks, ResizeObserverStub } from "@tsmono/react/testing";

import { InMemoryStateWrapper } from "./testHelpers";
import { ToolEventView } from "./ToolEventView";
import { pairToolApprovals } from "./transform/toolApprovals";
import { pairToolSentinels } from "./transform/toolSentinels";
import { EventNode } from "./types";

function makeNode(
  fn: string,
  args: Record<string, JsonValue>
): EventNode<ToolEvent> {
  return new EventNode<ToolEvent>(
    "tool-1",
    testToolEvent({
      id: "tool-call-1",
      function: fn,
      arguments: args,
      result: "done",
      timestamp: new Date(0).toISOString(),
      uuid: "tool-1",
    }),
    0
  );
}

const renderView = (fn: string, args: Record<string, JsonValue>) =>
  render(
    <ComponentStateProvider hooks={makeStateHooks()}>
      <ComponentNavigationProvider navigation={{ navigate: () => {} }}>
        <ContentTrustProvider value="trusted">
          <ToolEventView eventNode={makeNode(fn, args)} childNodes={[]} />
        </ContentTrustProvider>
      </ComponentNavigationProvider>
    </ComponentStateProvider>
  );

describe("ToolEventView", () => {
  beforeEach(() => {
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("renders long args of an unknown tool in an expandable input zone", () => {
    // A tool without a dedicated input descriptor whose args are far too long
    // for the one-line header summary (the reported case: thousands of chars).
    const longText = `${"x".repeat(3000)} END_OF_ARGS`;
    const { container } = renderView("my_custom_tool", { payload: longText });

    const input = container.querySelector(".tool-call-input");
    expect(input).not.toBeNull();
    expect(input!.textContent).toContain("END_OF_ARGS");
    // The args body lives inside an expandable panel so it can collapse/expand.
    const panel = container.querySelector("[data-expandable-panel]");
    expect(panel?.textContent).toContain("END_OF_ARGS");
  });

  it("renders multi-line object args of an unknown tool in the input zone", () => {
    const { container } = renderView("my_custom_tool", {
      config: { alpha: "a".repeat(200), beta: "b".repeat(200) },
    });

    const input = container.querySelector(".tool-call-input");
    expect(input).not.toBeNull();
    expect(input!.textContent).toContain("alpha");
    expect(input!.textContent).toContain("beta");
  });

  it("keeps a small object arg on the header line only", () => {
    // formatArg pretty-prints object/array values across multiple lines, but
    // that formatting artifact alone must not promote args to the input zone.
    const { container } = renderView("my_custom_tool", {
      coordinate: [100, 200],
    });

    expect(container.querySelector(".tool-call-input")).toBeNull();
    expect(container.textContent).toContain("coordinate: [ 100, 200 ]");
  });

  it("keeps short args of an unknown tool on the header line only", () => {
    const { container } = renderView("my_custom_tool", { path: "foo.txt" });

    expect(container.querySelector(".tool-call-input")).toBeNull();
    expect(container.textContent).toContain('path: "foo.txt"');
  });

  it("still renders a known tool's input arg in the input zone", () => {
    const { container } = renderView("bash", { cmd: "echo hello" });

    const input = container.querySelector(".tool-call-input");
    expect(input).not.toBeNull();
    expect(input!.textContent).toContain("echo hello");
  });
});

describe("ToolEventView approvals", () => {
  beforeEach(() => {
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  const approval = (id: string, overrides: Partial<ApprovalEvent>) =>
    new EventNode(
      id,
      testApprovalEvent({
        call: testToolCall({ id: "tool-call-1", function: "bash" }),
        ...overrides,
      }),
      0
    );

  const renderApproved = (
    approvals: EventNode[],
    overrides: Partial<ToolEvent> = {}
  ) => {
    const tool = new EventNode<ToolEvent>(
      "tool-1",
      testToolEvent({
        id: "tool-call-1",
        function: "bash",
        arguments: { cmd: "ORIGINAL_CMD" },
        result: "RESULT_TEXT",
        ...overrides,
      }),
      0
    );
    const { toolApprovals } = pairToolApprovals([...approvals, tool]);
    return render(
      <InMemoryStateWrapper>
        <ComponentNavigationProvider navigation={{ navigate: () => {} }}>
          <ContentTrustProvider value="trusted">
            <ToolEventView
              eventNode={tool}
              childNodes={[]}
              context={{ toolApprovals }}
            />
          </ContentTrustProvider>
        </ComponentNavigationProvider>
      </InMemoryStateWrapper>
    );
  };

  it("summarises a single approval in one row that does not expand", () => {
    const { container } = renderApproved([
      approval("a1", {
        approver: "gatekeeper",
        decision: "approve",
        explanation: "Read-only listing is safe.",
      }),
    ]);
    expect(screen.getByText("Approved")).toBeTruthy();
    expect(screen.getByText("gatekeeper")).toBeTruthy();
    expect(screen.getByText("Read-only listing is safe.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /checks/ })).toBeNull();
    expect(container.textContent).toContain("RESULT_TEXT");
  });

  it("replaces the result of a rejected call with the message the model received", () => {
    const { container } = renderApproved(
      [
        approval("a1", {
          approver: "gatekeeper",
          decision: "reject",
          explanation: "Recursive deletion is not permitted.",
        }),
      ],
      {
        error: {
          type: "approval",
          message: "MODEL_RECEIVED",
        },
      }
    );
    expect(screen.getByText("Rejected")).toBeTruthy();
    const well = container.querySelector('[class*="notRun"]');
    expect(well?.textContent).toBe(
      "Did not run. The model received this as the tool result:errorMODEL_RECEIVED"
    );
    expect(container.textContent).not.toContain("RESULT_TEXT");
    expect(container.textContent).not.toContain("approval");
  });

  it("uses the default message when a reject has no explanation", () => {
    const { container } = renderApproved(
      [approval("a1", { decision: "reject", explanation: null })],
      { result: "" }
    );
    expect(container.textContent).toContain("Tool call not approved.");
  });

  it("does not say a modify ran when a sentinel then rejected the call", () => {
    const tool = new EventNode<ToolEvent>(
      "tool-1",
      testToolEvent({
        id: "tool-call-1",
        function: "bash",
        arguments: { cmd: "ORIGINAL_CMD" },
        result: "",
        error: { type: "approval", message: "SENTINEL_SAID_NO" },
      }),
      0
    );
    const nodes = [
      approval("a1", {
        approver: "gatekeeper",
        decision: "modify",
        modified: testToolCall({
          function: "bash",
          arguments: { cmd: "PROPOSED_CMD" },
        }),
      }),
      new EventNode(
        "s1",
        testSentinelEvent({ step_id: "tool-call-1", action: "reject" }),
        0
      ),
      tool,
    ];
    const { toolApprovals } = pairToolApprovals(nodes);
    const { toolSentinels } = pairToolSentinels(nodes);
    const { container } = render(
      <InMemoryStateWrapper>
        <ComponentNavigationProvider navigation={{ navigate: () => {} }}>
          <ContentTrustProvider value="trusted">
            <ToolEventView
              eventNode={tool}
              childNodes={[]}
              context={{ toolApprovals, toolSentinels }}
            />
          </ContentTrustProvider>
        </ComponentNavigationProvider>
      </InMemoryStateWrapper>
    );
    expect(screen.queryByText("ran instead")).toBeNull();
    expect(screen.getByText("modified to")).toBeTruthy();
    expect(container.textContent).toContain("PROPOSED_CMD");
    expect(container.textContent).toContain("SENTINEL_SAID_NO");
  });

  it("strikes the original call and shows what ran instead for a modify", () => {
    const { container } = renderApproved([
      approval("a1", {
        approver: "gatekeeper",
        decision: "modify",
        explanation: "Network downloads are disabled.",
        modified: testToolCall({
          function: "bash",
          arguments: { cmd: "echo skipped" },
        }),
      }),
    ]);
    expect(screen.getByText("Modified")).toBeTruthy();
    expect(screen.getByText("ran instead")).toBeTruthy();
    expect(container.textContent).toContain("echo skipped");
    const struck = container.querySelector('[class*="struck"]');
    expect(struck?.textContent).toContain("ORIGINAL_CMD");
    expect(container.textContent).toContain("RESULT_TEXT");
  });

  it("names an escalation and expands to the numbered chain", () => {
    const { container } = renderApproved([
      approval("a1", {
        approver: "gatekeeper",
        decision: "escalate",
        explanation: "Package installs need a person.",
      }),
      approval("a2", {
        approver: "human",
        decision: "approve",
        explanation: "Fine for this run.",
      }),
    ]);
    expect(container.textContent).toContain("by human, after escalation");
    expect(screen.getByText("Fine for this run.")).toBeTruthy();
    expect(container.textContent).not.toContain("Package installs");

    fireEvent.click(screen.getByRole("button", { name: "2 checks" }));
    expect(container.textContent).toContain(
      "1gatekeeperescalatePackage installs need a person."
    );
    expect(container.textContent).toContain("2humanapprove");
  });

  it("renders chain explanations as markdown", async () => {
    const { container } = renderApproved([
      approval("a1", {
        approver: "gatekeeper",
        decision: "escalate",
        explanation: "Needs **review**.",
      }),
      approval("a2", { approver: "human", decision: "approve" }),
    ]);
    fireEvent.click(screen.getByRole("button", { name: "2 checks" }));
    await waitFor(() => {
      expect(container.querySelector("strong")?.textContent).toBe("review");
    });
  });
});
