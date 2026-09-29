// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  testModelEvent,
  testModelOutput,
  testSentinelEvent,
  testSpanBeginEvent,
  testToolCall,
  testToolEvent,
} from "@tsmono/inspect-common/testing";
import type { SentinelEvent, ToolEvent } from "@tsmono/inspect-common/types";
import { ComponentNavigationProvider } from "@tsmono/react/components";
import { ResizeObserverStub } from "@tsmono/react/testing";

import { SentinelEventView } from "./SentinelEventView";
import { InMemoryStateWrapper } from "./testHelpers";
import { ToolEventView } from "./ToolEventView";
import { pairToolSentinels } from "./transform/toolSentinels";
import { EventNode } from "./types";

const node = (id: string, overrides: Partial<SentinelEvent>) =>
  new EventNode(id, testSentinelEvent(overrides), 0);

const decision = (
  id: string,
  path: string,
  name: string,
  action: NonNullable<SentinelEvent["decision"]>,
  overrides: Partial<SentinelEvent> = {}
) =>
  node(id, {
    path,
    name,
    function: "tool_call",
    decision: action,
    ...overrides,
  });

const observation = (
  id: string,
  path: string,
  name: string,
  suspicion: NonNullable<SentinelEvent["suspicion"]>,
  overrides: Partial<SentinelEvent> = {}
) =>
  node(id, {
    path,
    name,
    function: "tool_call",
    kind: "observation",
    suspicion,
    decision: null,
    ...overrides,
  });

const renderWithState = (ui: ReactNode) =>
  render(
    <InMemoryStateWrapper>
      <ComponentNavigationProvider navigation={{ navigate: () => {} }}>
        {ui}
      </ComponentNavigationProvider>
    </InMemoryStateWrapper>
  );

const toolNode = (overrides: Partial<ToolEvent> = {}) =>
  new EventNode(
    "tool-1",
    testToolEvent({
      id: "call_1",
      function: "bash",
      arguments: { cmd: "INPUT_TEXT" },
      result: "RESULT_TEXT",
      ...overrides,
    }),
    0
  );

const renderTool = (
  sentinels: EventNode[],
  overrides: Partial<ToolEvent> = {}
) => {
  const tool = toolNode(overrides);
  const { toolSentinels } = pairToolSentinels([...sentinels, tool]);
  return renderWithState(
    <ToolEventView
      eventNode={tool}
      childNodes={[]}
      context={{ toolSentinels }}
    />
  );
};

const pill = (count: number) =>
  screen.getByRole("button", { name: `${count} checks` });

/** The tree's row buttons, by their visible label. */
const rowButton = (label: RegExp) =>
  screen.getByRole("button", { name: label });

const rejectEvents = () => [
  decision("net", "guard/network", "no_network", "continue"),
  decision("llm", "guard/llm", "inspect_sentinel/threshold", "reject", {
    explanation: "exfiltration 0.93 is over the 0.80 threshold.",
  }),
  observation(
    "mon",
    "guard/llm/monitor",
    "llm_suspicion",
    { sabotage: 0.2, exfiltration: 0.93, deception: 0.1 },
    { audit: true }
  ),
  decision("guard", "guard", "inspect_sentinel/sequential", "reject"),
  decision("root", "", "inspect_sentinel/concurrent", "reject"),
];

describe("sentinel checks in a tool card", () => {
  beforeEach(() => {
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("summarises a reject by the check that took effect, collapsed", () => {
    renderTool(rejectEvents(), {
      error: {
        type: "approval",
        message: "exfiltration 0.93 is over the 0.80 threshold.",
      },
    });
    expect(screen.getByText("Rejected")).toBeTruthy();
    expect(screen.getByText("guard/llm")).toBeTruthy();
    expect(screen.getByText("flagged")).toBeTruthy();
    expect(pill(5).getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("(top)")).toBeNull();
  });

  it("opens the tree with the row that took effect open", () => {
    const { container } = renderTool(rejectEvents());
    fireEvent.click(pill(5));

    expect(screen.getByText("(top)")).toBeTruthy();
    expect(screen.getByText("reject · took effect")).toBeTruthy();
    const open = screen
      .getAllByRole("button", { expanded: true })
      .map((b) => b.textContent);
    expect(open).toEqual(["5 checks", expect.stringContaining("guard/llm")]);
    expect(container.textContent).toContain(
      "decision · took effect · before call · tool_call"
    );
  });

  it("keeps one detail open per tree and closes it on a second click", () => {
    const { container } = renderTool(rejectEvents());
    fireEvent.click(pill(5));

    const monitor = rowButton(/guard\/llm\/monitor/);
    fireEvent.click(monitor);
    expect(monitor.getAttribute("aria-expanded")).toBe("true");
    expect(
      screen
        .getAllByRole("button", { expanded: true })
        .map((b) => b.textContent)
    ).toHaveLength(2);
    expect(container.textContent).toContain(
      "observation · flagged · before call"
    );

    fireEvent.click(monitor);
    expect(monitor.getAttribute("aria-expanded")).toBe("false");
    expect(container.textContent).not.toContain("observation · flagged");
  });

  it("shows the first score of several with a chip, and every score in the detail", () => {
    const { container } = renderTool(rejectEvents());
    fireEvent.click(pill(5));

    expect(screen.getByText("exfiltration 0.93")).toBeTruthy();
    expect(screen.getByText("2 more scores")).toBeTruthy();
    expect(screen.getByLabelText("flagged")).toBeTruthy();

    fireEvent.click(rowButton(/guard\/llm\/monitor/));
    const text = container.textContent;
    expect(text.indexOf("exfiltration0.93")).toBeLessThan(
      text.indexOf("sabotage0.2")
    );
    expect(text.indexOf("sabotage0.2")).toBeLessThan(
      text.indexOf("deception0.1")
    );
  });

  it("replaces the result with what the model received for a reject", () => {
    const { container } = renderTool(rejectEvents(), {
      result: "",
      error: { type: "approval", message: "MODEL_SAW_THIS" },
    });
    expect(container.textContent).toContain(
      "Did not run. The model received this as the tool result:"
    );
    expect(container.textContent).toContain("MODEL_SAW_THIS");
    expect(container.textContent).not.toContain("RESULT_TEXT");
  });

  it("falls back to the explanation, then the default approval message", () => {
    const { container } = renderTool([decision("root", "", "rule", "reject")], {
      error: null,
    });
    expect(container.textContent).toContain("Tool call not approved.");
  });

  it("starts a quiet step collapsed with no row open", () => {
    const { container } = renderTool([
      decision("rule", "guard", "no_network", "continue"),
      observation("mon", "scope", "suspicion", 0.15),
      decision("root", "", "concurrent", "continue"),
    ]);
    expect(screen.getByText("Continued")).toBeTruthy();
    expect(screen.getByText("suspicion 0.15")).toBeTruthy();
    expect(container.textContent).not.toContain(" by ");
    fireEvent.click(pill(3));
    expect(screen.getAllByRole("button", { expanded: true })).toHaveLength(1);
    expect(container.textContent).not.toContain("took effect");
    expect(container.textContent).toContain("RESULT_TEXT");
  });

  it("calls a monitors-only step observed", () => {
    renderTool([
      observation("mon", "monitor", "llm_suspicion", {
        exfiltration: 0.08,
        sabotage: 0.05,
      }),
      decision("root", "", "concurrent", "continue"),
    ]);
    expect(screen.getByText("Observed")).toBeTruthy();
    expect(screen.getByText("exfiltration 0.08")).toBeTruthy();
  });

  it("does not make a single check expandable", () => {
    renderTool([
      observation("fail", "observe/failure_count", "failure_count", 0.2, {
        explanation: "1 earlier calls failed",
      }),
    ]);
    expect(screen.getByText("Observed")).toBeTruthy();
    expect(screen.getByText("observe/failure_count")).toBeTruthy();
    expect(screen.getByText("1 earlier calls failed")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /checks/ })).toBeNull();
  });

  it("strikes the original call and shows the replacement for a modify", () => {
    const { container } = renderTool(
      [
        decision("net", "guard/network", "no_network", "modify", {
          explanation: "Network access is disabled.",
          modified: testToolCall({
            function: "bash",
            arguments: { cmd: "cp /cache/data.csv /work/data.csv" },
          }),
        }),
        decision("root", "", "sequential", "modify", {
          modified: testToolCall({
            function: "bash",
            arguments: { cmd: "cp /cache/data.csv /work/data.csv" },
          }),
        }),
      ],
      { arguments: { cmd: "curl https://example.com" } }
    );
    expect(screen.getByText("Modified")).toBeTruthy();
    expect(screen.getByText("ran instead")).toBeTruthy();
    expect(container.textContent).toContain("cp /cache/data.csv");
    const struck = container.querySelector('[class*="struck"]');
    expect(struck?.textContent).toContain("curl https://example.com");

    fireEvent.click(pill(2));
    expect(screen.getByText("modify · took effect")).toBeTruthy();
    expect(screen.getByText("modified")).toBeTruthy();
  });

  it("renders before-call checks in the input region and after-call checks after the result", () => {
    const { container } = renderTool([
      decision("before", "", "before_protocol", "continue", {
        explanation: "BEFORE_REASON",
      }),
      observation("after", "", "after_monitor", 0.3, {
        stage: "tool_result",
        explanation: "AFTER_REASON",
      }),
    ]);
    const text = container.textContent;
    const inputAt = text.indexOf("INPUT_TEXT");
    const beforeAt = text.indexOf("BEFORE_REASON");
    const resultAt = text.indexOf("RESULT_TEXT");
    const afterAt = text.indexOf("AFTER_REASON");
    expect(inputAt).toBeGreaterThan(-1);
    expect(beforeAt).toBeGreaterThan(inputAt);
    expect(resultAt).toBeGreaterThan(beforeAt);
    expect(afterAt).toBeGreaterThan(resultAt);
  });

  it("shows bypassed, cancelled and superseded checks as muted rows", () => {
    renderTool([
      decision("esc", "review", "escalate_on_doubt", "escalate"),
      node("sup", {
        path: "review",
        name: "escalate_on_doubt",
        function: "tool_call",
        kind: "superseded",
        decision: "escalate",
      }),
      node("slow", {
        path: "slow",
        name: "slow_judge",
        kind: "cancelled",
        function: null,
        decision: null,
      }),
      decision("root", "", "concurrent", "continue"),
    ]);
    fireEvent.click(pill(3));
    expect(screen.getByText("cancelled")).toBeTruthy();
    expect(rowButton(/review/).textContent).toContain("escalate · superseded");
  });

  it("folds the step's monitor model calls into a line at the end", () => {
    const tool = toolNode();
    const span = new EventNode(
      "span-1",
      testSpanBeginEvent({ id: "span-1", type: "sentinel", name: "sentinel" }),
      0
    );
    span.children = ["mc-1", "mc-2"].map(
      (id) =>
        new EventNode(
          id,
          testModelEvent({
            role: "monitor",
            model: "monitor-model",
            output: testModelOutput({ completion: "0.9" }),
          }),
          1
        )
    );
    span.children.push(decision("before", "", "llm_monitor", "continue"));
    const { toolSentinels } = pairToolSentinels([span, tool]);
    renderWithState(
      <ToolEventView
        eventNode={tool}
        childNodes={[]}
        context={{ toolSentinels }}
      />
    );

    const toggle = screen.getByRole("button", {
      name: "2 monitor model calls",
    });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryAllByText(/monitor-model/)).toHaveLength(0);
    fireEvent.click(toggle);
    expect(screen.getAllByText(/monitor-model/i)).toHaveLength(2);
  });
});

describe("SentinelEventView", () => {
  beforeEach(() => {
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("renders a model-stage step as an event row with its checks", () => {
    const nodes = [
      observation("m1", "monitor", "suspicion", 0.4, {
        stage: "model_output",
        step_id: "msg_1",
      }),
      decision("m2", "", "threshold", "continue", {
        stage: "model_output",
        step_id: "msg_1",
      }),
    ];
    const { standaloneSentinels } = pairToolSentinels(nodes);
    const { container } = renderWithState(
      <SentinelEventView
        eventNode={nodes[0]!}
        step={standaloneSentinels.get("m1")}
      />
    );
    expect(container.textContent).toContain("model output");
    expect(screen.getByText("Observed")).toBeTruthy();
    fireEvent.click(pill(2));
    expect(screen.getByText("(top)")).toBeTruthy();
  });
});
