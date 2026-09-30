// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
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

const notRunText = (container: HTMLElement) =>
  container.querySelector('[class*="notRun"]')?.textContent;

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
    expect(container.textContent).not.toContain("took effect");
    const open = screen
      .getAllByRole("button", { expanded: true })
      .map((b) => b.textContent);
    expect(open).toEqual(["5 checks", expect.stringContaining("guard/llm")]);
    // The detail of an unflagged decision has no meta line.
    expect(container.querySelector('[class*="meta"]')).toBeNull();
    expect(container.textContent).not.toContain("before call");
  });

  it("names the check under a rewording combinator and shows what the model received", async () => {
    const own = "`curl` needs the network, which this task does not allow.";
    const rewritten = `${own} (network: reject; protected: continue)`;
    const { container } = renderTool(
      [
        decision("net", "guard/network", "no_network", "reject", {
          explanation: own,
        }),
        decision("prot", "guard/protected", "protected", "continue"),
        decision("guard", "guard", "inspect_sentinel/concurrent", "reject", {
          explanation: rewritten,
        }),
        observation("audit", "audit", "suspicion", 0.2),
        decision("root", "", "inspect_sentinel/concurrent", "reject", {
          explanation: rewritten,
        }),
      ],
      { result: "", error: { type: "approval", message: rewritten } }
    );
    expect(screen.getByText("Rejected")).toBeTruthy();
    expect(screen.getByText("guard/network")).toBeTruthy();
    await waitFor(() => {
      expect(
        container.querySelector('[class*="summary"] [class*="reason"]')
          ?.textContent
      ).toBe(own);
    });
    expect(notRunText(container)).toContain(rewritten);

    fireEvent.click(pill(5));
    const open = screen
      .getAllByRole("button", { expanded: true })
      .map((b) => b.textContent);
    expect(open).toEqual([
      "5 checks",
      expect.stringContaining("guard/network"),
    ]);
  });

  it("marks each row's kind with an icon", () => {
    renderTool(rejectEvents());
    fireEvent.click(pill(5));
    const icon = (label: RegExp) =>
      rowButton(label).querySelector('i[class*="kindIcon"]')?.className;
    expect(icon(/\(top\)/)).toContain("bi-signpost-split");
    expect(icon(/guard\/llm\/monitor/)).toContain("bi-activity");
  });

  it("names the function only for an instance that reported from several", () => {
    const { container } = renderTool([
      observation("args", "check", "checker", 0.1, { function: "check_args" }),
      observation("cwd", "check", "checker", 0.2, { function: "check_cwd" }),
      decision("root", "", "concurrent", "continue", { function: "protocol" }),
    ]);
    fireEvent.click(pill(3));
    fireEvent.click(rowButton(/\(top\)/));
    expect(container.textContent).not.toContain("function:");
    fireEvent.click(
      screen.getAllByRole("button", { name: /check checker/ })[0]!
    );
    expect(container.textContent).toContain("function: check_args");
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
    expect(container.querySelector('[class*="meta"]')?.textContent).toBe(
      "flagged"
    );

    fireEvent.click(monitor);
    expect(monitor.getAttribute("aria-expanded")).toBe("false");
    expect(container.querySelector('[class*="meta"]')).toBeNull();
  });

  it("shows the first score of several with a chip, and every score in the detail", () => {
    const { container } = renderTool(rejectEvents());
    fireEvent.click(pill(5));

    expect(screen.getByText("exfiltration 0.93")).toBeTruthy();
    expect(screen.getByText("2 more scores")).toBeTruthy();
    expect(screen.getByRole("img", { name: "flagged" })).toBeTruthy();

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
      error: { type: "approval", message: "MODEL_SAW_THIS" },
    });
    expect(container.textContent).toContain(
      "Did not run. The model received this as the tool result:"
    );
    expect(container.textContent).toContain("MODEL_SAW_THIS");
    expect(container.textContent).not.toContain("RESULT_TEXT");
  });

  it("falls back to the explanation, then the default approval message", () => {
    const { container } = renderTool(
      [decision("root", "", "rule", "reject", { explanation: "ROOT_REASON" })],
      { result: "", error: null }
    );
    expect(notRunText(container)).toContain("ROOT_REASON");
    cleanup();
    const bare = renderTool([decision("root", "", "rule", "reject")], {
      result: "",
      error: null,
    });
    expect(notRunText(bare.container)).toContain("Tool call not approved.");
  });

  it("keeps the result of a call whose root returned nothing over a child's reject", () => {
    const { container } = renderTool([
      decision("rule", "rule", "no_network", "reject", {
        explanation: "CHILD_REASON",
      }),
    ]);
    expect(screen.getByText("Continued")).toBeTruthy();
    expect(screen.queryByText("Rejected")).toBeNull();
    expect(container.textContent).toContain("RESULT_TEXT");
    expect(container.textContent).not.toContain("Did not run");
  });

  it("keeps a real result when a reject was recorded but the call ran", () => {
    const { container } = renderTool([decision("root", "", "rule", "reject")]);
    expect(container.textContent).toContain("RESULT_TEXT");
    expect(container.textContent).not.toContain("Did not run");
  });

  it("says the sample was terminated for a terminate", () => {
    const { container } = renderTool(
      [decision("root", "", "rule", "terminate", { explanation: "stop" })],
      { result: "" }
    );
    expect(screen.getByText("Terminated")).toBeTruthy();
    expect(notRunText(container)).toBe(
      "Did not run. The sample was terminated."
    );
  });

  it("shows an escalation and keeps the result", () => {
    const { container } = renderTool([
      decision("root", "", "escalate_on_doubt", "escalate", {
        explanation: "Needs a person.",
      }),
    ]);
    expect(screen.getByText("Escalated")).toBeTruthy();
    expect(container.textContent).toContain("RESULT_TEXT");
  });

  it("renders the summary reason as markdown, clamped when the checks expand", async () => {
    const { container } = renderTool([
      decision("rule", "rule", "no_network", "reject"),
      decision("root", "", "concurrent", "reject", {
        explanation: "Uses **curl**.",
      }),
    ]);
    await waitFor(() => {
      expect(container.querySelector("strong")?.textContent).toBe("curl");
    });
    const reason = container.querySelector("strong")!.closest("div");
    expect(reason?.className).toContain("clamped");
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
      observation("fail", "failures", "failure_count", 0.2),
    ]);
    expect(screen.getByText("Observed")).toBeTruthy();
    expect(screen.getByText("exfiltration 0.08")).toBeTruthy();
    expect(screen.getByText("failure_count 0.2")).toBeTruthy();
  });

  it("calls an explicit root continue continued, with the monitors' scores", () => {
    renderTool([
      observation("mon", "monitor", "llm_suspicion", {
        exfiltration: 0.62,
        sabotage: 0.05,
      }),
      decision("root", "", "threshold", "continue"),
    ]);
    expect(screen.getByText("Continued")).toBeTruthy();
    expect(screen.getByText("exfiltration 0.62")).toBeTruthy();
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
    expect(screen.getByText("modified")).toBeTruthy();
    expect(container.textContent).not.toContain("took effect");
  });

  it("shows the call the root ran, not a child's different proposal", () => {
    const { container } = renderTool(
      [
        decision("net", "guard/network", "no_network", "modify", {
          modified: testToolCall({
            function: "bash",
            arguments: { cmd: "CHILD_CMD" },
          }),
        }),
        decision("root", "", "sequential", "modify", {
          modified: testToolCall({
            function: "bash",
            arguments: { cmd: "ROOT_CMD" },
          }),
        }),
      ],
      { arguments: { cmd: "curl https://example.com" } }
    );
    const ranInstead = screen.getByText("ran instead").parentElement;
    expect(ranInstead?.textContent).toContain("ROOT_CMD");
    expect(container.textContent).not.toContain("CHILD_CMD");
  });

  it("strikes short original args that sit in the header", () => {
    const tool = new EventNode(
      "tool-1",
      testToolEvent({
        id: "call_1",
        function: "read_file",
        arguments: { path: "secret.txt" },
        result: "RESULT_TEXT",
      }),
      0
    );
    const { toolSentinels } = pairToolSentinels([
      decision("root", "", "rule", "modify", {
        modified: testToolCall({
          function: "read_file",
          arguments: { path: "public.txt" },
        }),
      }),
      tool,
    ]);
    const { container } = renderWithState(
      <ToolEventView
        eventNode={tool}
        childNodes={[]}
        context={{ toolSentinels }}
      />
    );
    const struck = container.querySelector('[class*="struckText"]');
    expect(struck?.textContent).toContain("secret.txt");
  });

  it("puts the checks of a custom tool view below the view", () => {
    const { container } = renderTool(
      [decision("root", "", "rule", "continue", { explanation: "CHECK_TEXT" })],
      {
        function: "submit",
        arguments: { answer: "ANSWER_TEXT" },
        result: "ANSWER_TEXT",
      }
    );
    expect(container.querySelector('[class*="submitView"]')).not.toBeNull();
    const text = container.textContent;
    expect(text.indexOf("ANSWER_TEXT")).toBeGreaterThan(-1);
    expect(text.indexOf("CHECK_TEXT")).toBeGreaterThan(
      text.indexOf("ANSWER_TEXT")
    );
  });

  it("strikes a replaced call that would take a custom tool view", () => {
    const { container } = renderTool(
      [
        decision("root", "", "rule", "modify", {
          modified: testToolCall({
            function: "submit",
            arguments: { answer: "NEW_ANSWER" },
          }),
        }),
      ],
      { function: "submit", arguments: { answer: "OLD_ANSWER" } }
    );
    expect(container.querySelector('[class*="submitView"]')).toBeNull();
    const struck = container.querySelector('[class*="struck"]');
    expect(struck?.textContent).toContain("OLD_ANSWER");
    const text = container.textContent;
    expect(text.indexOf("NEW_ANSWER")).toBeGreaterThan(
      text.indexOf("OLD_ANSWER")
    );
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
      node("byp", {
        path: "gate",
        name: "gatekeeper",
        kind: "bypassed",
        function: null,
        decision: null,
      }),
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
    fireEvent.click(pill(4));
    expect(screen.getByText("cancelled")).toBeTruthy();
    expect(screen.getByText("bypassed")).toBeTruthy();
    expect(rowButton(/review/).textContent).toContain("escalate · superseded");
    for (const label of [/gate/, /slow/, /review/]) {
      expect(rowButton(label).className).toContain("inactive");
    }
    expect(rowButton(/\(top\)/).className).not.toContain("inactive");
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
    expect(screen.getByText("Continued")).toBeTruthy();
    fireEvent.click(pill(2));
    expect(screen.getByText("(top)")).toBeTruthy();
  });

  it("gives an event shown alone an honest verdict", () => {
    const { container } = renderWithState(
      <SentinelEventView
        eventNode={node("byp", {
          path: "guard",
          name: "concurrent",
          kind: "bypassed",
          function: null,
          decision: null,
        })}
      />
    );
    expect(screen.getByText("Bypassed")).toBeTruthy();
    expect(container.textContent).not.toContain("Continued");
  });
});
