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
        call: testToolCall({
          id: "tool-call-1",
          function: "bash",
          arguments: { cmd: "ORIGINAL_CMD" },
        }),
        ...overrides,
      }),
      0
    );

  const modify = (cmd: string) =>
    testToolCall({ id: "tool-call-1", function: "bash", arguments: { cmd } });

  const inputZone = (container: HTMLElement) =>
    container.querySelector('[class*="inputZone"]');

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

  const renderWithChecks = (nodes: EventNode[], tool: EventNode<ToolEvent>) => {
    const { toolApprovals } = pairToolApprovals(nodes);
    const { toolSentinels } = pairToolSentinels(nodes);
    return render(
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
  };

  it("shows an approver's replacement as the call a sentinel then rejected", () => {
    // The approver's modify runs first and the ToolEvent records its
    // replacement; the sentinel then rejects that replacement.
    const tool = new EventNode<ToolEvent>(
      "tool-1",
      testToolEvent({
        id: "tool-call-1",
        function: "bash",
        arguments: { cmd: "APPROVER_CMD" },
        result: "",
        error: { type: "approval", message: "SENTINEL_SAID_NO" },
      }),
      0
    );
    const nodes = [
      approval("a1", {
        approver: "gatekeeper",
        decision: "modify",
        modified: modify("APPROVER_CMD"),
      }),
      new EventNode(
        "s1",
        testSentinelEvent({ step_id: "tool-call-1", action: "reject" }),
        0
      ),
      tool,
    ];
    const { container } = renderWithChecks(nodes, tool);
    expect(screen.getByText("proposed")).toBeTruthy();
    expect(container.querySelector('[class*="struck"]')?.textContent).toContain(
      "ORIGINAL_CMD"
    );
    expect(inputZone(container)?.textContent).toContain("APPROVER_CMD");
    expect(container.textContent).toContain("SENTINEL_SAID_NO");
  });

  it("shows each modify's proposal struck when an approver and a sentinel both modify", () => {
    const tool = new EventNode<ToolEvent>(
      "tool-1",
      testToolEvent({
        id: "tool-call-1",
        function: "bash",
        arguments: { cmd: "SENTINEL_CMD" },
        result: "RESULT_TEXT",
      }),
      0
    );
    const nodes = [
      approval("a1", { decision: "modify", modified: modify("APPROVER_CMD") }),
      new EventNode(
        "s1",
        testSentinelEvent({
          step_id: "tool-call-1",
          action: "modify",
          modified: modify("SENTINEL_CMD"),
        }),
        0
      ),
      tool,
    ];
    const { container } = renderWithChecks(nodes, tool);
    const struck = [...container.querySelectorAll('[class*="struck"]')].map(
      (el) => el.textContent
    );
    expect(struck).toEqual([
      expect.stringContaining("ORIGINAL_CMD"),
      expect.stringContaining("APPROVER_CMD"),
    ]);
    const labels = [...container.querySelectorAll('[class*="replaced"]')].map(
      (el) => el.firstElementChild?.textContent
    );
    expect(labels).toEqual(["proposed", "replaced"]);
    expect(inputZone(container)?.textContent).toContain("SENTINEL_CMD");
  });

  it("shows the call that ran as the input and the approver's proposal struck", () => {
    const { container } = renderApproved(
      [
        approval("a1", {
          approver: "gatekeeper",
          decision: "modify",
          explanation: "Network downloads are disabled.",
          modified: modify("echo skipped"),
        }),
      ],
      { arguments: { cmd: "echo skipped" } }
    );
    expect(screen.getByText("Modified")).toBeTruthy();
    expect(screen.getByText("proposed")).toBeTruthy();
    expect(inputZone(container)?.textContent).toContain("echo skipped");
    const struck = container.querySelector('[class*="struck"]');
    expect(struck?.textContent).toContain("ORIGINAL_CMD");
    expect(struck?.textContent).not.toContain("echo skipped");
    expect(container.textContent).toContain("RESULT_TEXT");
  });

  it("shows the approver's replacement as what ran in a log that recorded the proposal", () => {
    // Logs written before the ToolEvent recorded an approver's modify keep
    // the proposal in its arguments.
    const { container } = renderApproved([
      approval("a1", { decision: "modify", modified: modify("echo skipped") }),
    ]);
    expect(inputZone(container)?.textContent).toContain("echo skipped");
    expect(inputZone(container)?.textContent).not.toContain("ORIGINAL_CMD");
    expect(container.querySelector('[class*="struck"]')?.textContent).toContain(
      "ORIGINAL_CMD"
    );
  });

  it("keeps the custom tool view of a rejected call", () => {
    const { container } = renderApproved(
      [
        new EventNode(
          "a1",
          testApprovalEvent({
            call: testToolCall({
              id: "tool-call-1",
              function: "submit",
              arguments: { answer: "ANSWER_TEXT" },
            }),
            decision: "reject",
            explanation: "Not yet.",
          }),
          0
        ),
      ],
      {
        function: "submit",
        arguments: { answer: "ANSWER_TEXT" },
        result: "",
        error: { type: "approval", message: "Not yet." },
      }
    );
    expect(container.querySelector('[class*="submitView"]')).not.toBeNull();
    expect(container.querySelector('[class*="notRun"]')?.textContent).toContain(
      "Not yet."
    );
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

  it("ignores the proposal's custom view in a log that recorded the proposal", () => {
    const { container } = renderApproved(
      [
        approval("a1", {
          decision: "modify",
          modified: modify("echo skipped"),
        }),
      ],
      { view: { format: "markdown", content: "PROPOSAL_VIEW" } }
    );
    expect(inputZone(container)?.textContent).toContain("echo skipped");
    expect(container.textContent).not.toContain("PROPOSAL_VIEW");
  });

  it("shows each call of a reused call id with its own approval", () => {
    const tool = (nodeId: string, cmd: string, rejected = false) =>
      new EventNode<ToolEvent>(
        nodeId,
        testToolEvent({
          id: "tool-call-1",
          function: "bash",
          arguments: { cmd },
          result: rejected ? "" : "RESULT_TEXT",
          error: rejected
            ? { type: "approval", message: "MODEL_RECEIVED" }
            : null,
        }),
        0
      );
    const first = tool("tool-1", "FIRST_CMD");
    const second = tool("tool-2", "SECOND_CMD", true);
    const nodes = [
      approval("a1", {
        decision: "modify",
        call: modify("PROPOSED_CMD"),
        modified: modify("FIRST_CMD"),
      }),
      first,
      approval("a2", { decision: "reject", call: modify("SECOND_CMD") }),
      second,
    ];

    const { container, unmount } = renderWithChecks(nodes, first);
    expect(screen.getByText("Modified")).toBeTruthy();
    expect(screen.queryByText("Rejected")).toBeNull();
    expect(inputZone(container)?.textContent).toContain("FIRST_CMD");
    expect(container.querySelector('[class*="struck"]')?.textContent).toContain(
      "PROPOSED_CMD"
    );
    expect(container.textContent).toContain("RESULT_TEXT");
    unmount();

    const view = renderWithChecks(nodes, second);
    expect(screen.getByText("Rejected")).toBeTruthy();
    expect(screen.queryByText("Modified")).toBeNull();
    expect(view.container.querySelector('[class*="struck"]')).toBeNull();
    expect(view.container.textContent).toContain("MODEL_RECEIVED");
  });
});
