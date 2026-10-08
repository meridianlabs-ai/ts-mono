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
  testAssistantMessage,
  testChatCompletionChoice,
  testModelEvent,
  testModelOutput,
  testSentinelEvent,
  testSpanBeginEvent,
  testToolCall,
  testToolEvent,
} from "@tsmono/inspect-common/testing";
import type { SentinelEvent, ToolEvent } from "@tsmono/inspect-common/types";
import {
  ComponentNavigationProvider,
  ContentTrustProvider,
} from "@tsmono/react/components";
import { ResizeObserverStub } from "@tsmono/react/testing";

import { SentinelEventView } from "./SentinelEventView";
import { InMemoryStateWrapper } from "./testHelpers";
import { ToolEventView } from "./ToolEventView";
import { pairToolSentinels } from "./transform/toolSentinels";
import { EventNode, type EventNodeContext } from "./types";

const node = (id: string, overrides: Partial<SentinelEvent>) =>
  new EventNode(id, testSentinelEvent(overrides), 0);

const decision = (
  id: string,
  path: string,
  name: string,
  action: NonNullable<SentinelEvent["action"]>,
  overrides: Partial<SentinelEvent> = {}
) =>
  node(id, {
    path,
    factory: name,
    function: "tool_call",
    action,
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
    factory: name,
    function: "tool_call",
    kind: "observation",
    suspicion,
    action: null,
    ...overrides,
  });

const failure = (id: string, path: string, name: string) =>
  node(id, {
    path,
    factory: name,
    function: "tool_call",
    kind: "observation",
    status: "error",
    action: null,
    error: "RuntimeError: model unavailable",
  });

const renderWithState = (ui: ReactNode) =>
  render(
    <InMemoryStateWrapper>
      <ComponentNavigationProvider navigation={{ navigate: () => {} }}>
        <ContentTrustProvider value="trusted">{ui}</ContentTrustProvider>
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
  overrides: Partial<ToolEvent> = {},
  context: Partial<EventNodeContext> = {}
) => {
  const tool = toolNode(overrides);
  const { toolSentinels } = pairToolSentinels([...sentinels, tool]);
  return renderWithState(
    <ToolEventView
      eventNode={tool}
      childNodes={[]}
      context={{ toolSentinels, ...context }}
    />
  );
};

/** The model's output proposing a call, which precedes the checks of the call. */
const proposal = (args: ToolEvent["arguments"], fn = "bash") =>
  new EventNode(
    "proposal",
    testModelEvent({
      output: testModelOutput({
        choices: [
          testChatCompletionChoice({
            message: testAssistantMessage({
              tool_calls: [
                testToolCall({ id: "call_1", function: fn, arguments: args }),
              ],
            }),
          }),
        ],
      }),
    }),
    0
  );

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
    vi.restoreAllMocks();
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

  it("shows what a reject told the agent in the check's detail", () => {
    const { container } = renderTool(
      [
        decision("rule", "rule", "no_network", "reject", {
          message: "USE_X_INSTEAD",
          explanation: "INTERNAL_REASON",
        }),
        decision("root", "", "inspect_sentinel/concurrent", "reject", {
          message: "USE_X_INSTEAD",
        }),
      ],
      { result: "", error: { type: "approval", message: "USE_X_INSTEAD" } }
    );
    fireEvent.click(pill(2));
    const detail = container.querySelector('[class*="detail"]');
    expect(detail?.textContent).toContain("told the agent");
    expect(detail?.textContent).toContain("USE_X_INSTEAD");
    expect(detail?.textContent).toContain("INTERNAL_REASON");
  });

  it("links the cites in a check's explanation to what its references name", async () => {
    const { container } = renderTool(
      [
        observation("mon", "audit", "suspicion", 0.9, {
          explanation: "edits the tests [M2] after reading [E5]",
          references: [
            { type: "message", id: "msg_2", cite: "[M2]" },
            { type: "event", id: "evt_5", cite: "[E5]" },
          ],
        }),
        decision("root", "", "inspect_sentinel/threshold", "reject", {
          explanation: "suspicion 0.90 from audit: edits the tests [M2]",
          references: [{ type: "message", id: "msg_2", cite: "[M2]" }],
        }),
      ],
      { result: "" },
      { makeCiteUrl: (id, type) => `#/${type}/${id}` }
    );
    fireEvent.click(pill(2));
    fireEvent.click(rowButton(/audit/));
    await waitFor(() => {
      const links = [...container.querySelectorAll("[data-ref-id]")].map(
        (link) => [link.textContent, link.getAttribute("href")]
      );
      // The summary's reason links its cite too.
      expect(links).toEqual([
        ["M2", "#/message/msg_2"],
        ["M2", "#/message/msg_2"],
        ["E5", "#/event/evt_5"],
      ]);
    });
  });

  it("leaves a cite unlinked without a host to route it", async () => {
    const { container } = renderTool([
      observation("mon", "audit", "suspicion", 0.9, {
        explanation: "edits the tests [M2]",
        references: [{ type: "message", id: "msg_2", cite: "[M2]" }],
      }),
      decision("root", "", "inspect_sentinel/threshold", "continue"),
    ]);
    fireEvent.click(pill(2));
    fireEvent.click(rowButton(/audit/));
    await waitFor(() => {
      const cite = container.querySelector("[data-ref-id]");
      expect(cite?.textContent).toBe("M2");
      expect(cite?.getAttribute("href")).toBeNull();
    });
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

  it("falls back to the message, then the default approval message", () => {
    const { container } = renderTool(
      [
        decision("root", "", "rule", "reject", {
          message: "ROOT_MESSAGE",
          explanation: "ROOT_REASON",
        }),
      ],
      { result: "", error: null }
    );
    expect(notRunText(container)).toContain("ROOT_MESSAGE");
    expect(notRunText(container)).not.toContain("ROOT_REASON");
    cleanup();
    const unexplained = renderTool(
      [decision("root", "", "rule", "reject", { explanation: "ROOT_REASON" })],
      { result: "", error: null }
    );
    expect(notRunText(unexplained.container)).toContain(
      "Tool call not approved."
    );
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

  it("says an escalate with no handler above it proceeded, in a neutral tone", () => {
    const { container } = renderTool([
      decision("root", "", "escalate_on_doubt", "escalate", {
        explanation: "Needs a person.",
      }),
    ]);
    expect(screen.getByText("Escalated (no handler; proceeded)")).toBeTruthy();
    expect(container.querySelector('[class*="inset"]')?.className).not.toMatch(
      /modify|reject/
    );
    expect(container.textContent).toContain("RESULT_TEXT");
  });

  /** Lays out every element as `scrollHeight` tall in a box `clientHeight` tall, measured as soon as it is observed. */
  const stubLayout = (scrollHeight: number, clientHeight: number) => {
    vi.stubGlobal(
      "ResizeObserver",
      class implements ResizeObserver {
        constructor(private callback: ResizeObserverCallback) {}
        observe(target: Element) {
          const entry: ResizeObserverEntry = {
            target,
            contentRect: target.getBoundingClientRect(),
            borderBoxSize: [],
            contentBoxSize: [],
            devicePixelContentBoxSize: [],
          };
          this.callback([entry], this);
        }
        unobserve() {}
        disconnect() {}
      }
    );
    vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(
      scrollHeight
    );
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(
      clientHeight
    );
  };

  it("renders the summary reason as markdown, clamping one that overflows with a toggle", async () => {
    stubLayout(60, 30);
    const { container } = renderTool([
      decision("rule", "rule", "no_network", "reject"),
      decision("root", "", "concurrent", "reject", {
        explanation: "Uses **curl**.",
      }),
    ]);
    await waitFor(() => {
      expect(container.querySelector("strong")?.textContent).toBe("curl");
    });
    const reason = () =>
      container.querySelector("strong")!.closest('[class*="reason"]');
    expect(reason()?.className).toContain("clamped");
    fireEvent.click(screen.getByRole("button", { name: "more" }));
    expect(reason()?.className).not.toContain("clamped");
    fireEvent.click(screen.getByRole("button", { name: "less" }));
    expect(reason()?.className).toContain("clamped");
  });

  it("offers no toggle for a reason that fits in the clamp", async () => {
    stubLayout(30, 30);
    const long = `Uses **curl**. ${"More context. ".repeat(20)}`;
    const { container } = renderTool([
      decision("rule", "rule", "no_network", "reject"),
      decision("root", "", "concurrent", "reject", { explanation: long }),
    ]);
    await waitFor(() => {
      expect(container.querySelector("strong")?.textContent).toBe("curl");
    });
    expect(screen.queryByRole("button", { name: "more" })).toBeNull();
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

  it("expands a single check to its detail", () => {
    const { container } = renderTool(
      [
        decision("root", "", "rule", "reject", {
          message: "USE_X_INSTEAD",
          explanation: "INTERNAL_REASON",
        }),
      ],
      { result: "", error: { type: "approval", message: "USE_X_INSTEAD" } }
    );
    expect(screen.getByText("Rejected")).toBeTruthy();
    expect(container.querySelector('[class*="detail"]')).toBeNull();
    const details = screen.getByRole("button", { name: "details" });
    fireEvent.click(details);
    expect(details.getAttribute("aria-expanded")).toBe("true");
    const detail = container.querySelector('[class*="detail"]');
    expect(detail?.textContent).toContain("told the agent");
    expect(detail?.textContent).toContain("USE_X_INSTEAD");
    expect(screen.queryByText("(top)")).toBeNull();
  });

  it("summarises a lone observation with its explanation", () => {
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

  it("shows the call that ran as the input and the model's proposal struck", () => {
    const ran = { cmd: "cp /cache/data.csv /work/data.csv" };
    const { container } = renderTool(
      [
        proposal({ cmd: "curl https://example.com" }),
        decision("net", "guard/network", "no_network", "modify", {
          explanation: "Network access is disabled.",
          modified: testToolCall({ function: "bash", arguments: ran }),
        }),
        decision("root", "", "sequential", "modify", {
          modified: testToolCall({ function: "bash", arguments: ran }),
        }),
      ],
      { arguments: ran }
    );
    expect(screen.getByText("Modified")).toBeTruthy();
    expect(screen.getByText("proposed")).toBeTruthy();
    const struck = container.querySelector('[class*="struck"]');
    expect(struck?.textContent).toContain("curl https://example.com");
    expect(struck?.textContent).not.toContain("cp /cache");
    const input = container.querySelector('[class*="inputZone"]');
    expect(input?.textContent).toContain("cp /cache/data.csv");
    expect(input?.className).not.toContain("struck");
    expect(container.textContent).toContain("RESULT_TEXT");

    fireEvent.click(pill(2));
    expect(screen.getByText("modified")).toBeTruthy();
    expect(container.textContent).not.toContain("took effect");
  });

  it("shows the call the root ran, not a child's different proposal", () => {
    const { container } = renderTool(
      [
        proposal({ cmd: "curl https://example.com" }),
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
      { arguments: { cmd: "ROOT_CMD" } }
    );
    expect(
      container.querySelector('[class*="inputZone"]')?.textContent
    ).toContain("ROOT_CMD");
    expect(container.textContent).not.toContain("CHILD_CMD");
  });

  it("shows a modify without a strike when the proposal is not in the transcript", () => {
    const { container } = renderTool(
      [
        decision("root", "", "rule", "modify", {
          modified: testToolCall({
            function: "read_file",
            arguments: { path: "public.txt" },
          }),
        }),
      ],
      { function: "read_file", arguments: { path: "public.txt" } }
    );
    expect(screen.getByText("Modified")).toBeTruthy();
    expect(screen.queryByText("proposed")).toBeNull();
    expect(container.querySelector('[class*="struck"]')).toBeNull();
    expect(container.textContent).toContain("public.txt");
  });

  it("shows no proposal when it matches the call that ran", () => {
    const args = { cmd: "ls" };
    const { container } = renderTool(
      [
        proposal(args),
        decision("root", "", "rule", "modify", {
          modified: testToolCall({ function: "bash", arguments: args }),
        }),
      ],
      { arguments: args }
    );
    expect(screen.queryByText("proposed")).toBeNull();
    expect(container.querySelector('[class*="struck"]')).toBeNull();
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

  it("keeps the custom tool view of a modified call, showing the call that ran", () => {
    const { container } = renderTool(
      [
        proposal({ answer: "OLD_ANSWER" }, "submit"),
        decision("root", "", "rule", "modify", {
          modified: testToolCall({
            function: "submit",
            arguments: { answer: "NEW_ANSWER" },
          }),
        }),
      ],
      {
        function: "submit",
        arguments: { answer: "NEW_ANSWER" },
        result: "NEW_ANSWER",
      }
    );
    const view = container.querySelector('[class*="submitView"]');
    expect(view?.textContent).toContain("NEW_ANSWER");
    expect(view?.textContent).not.toContain("OLD_ANSWER");
    const struck = container.querySelector('[class*="struck"]');
    expect(struck?.textContent).toContain("OLD_ANSWER");
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
        factory: "gatekeeper",
        status: "bypassed",
        function: null,
        action: null,
      }),
      decision("esc", "review", "escalate_on_doubt", "escalate"),
      node("sup", {
        path: "review",
        factory: "escalate_on_doubt",
        function: "tool_call",
        status: "superseded",
        action: "escalate",
      }),
      node("slow", {
        path: "slow",
        factory: "slow_judge",
        kind: "observation",
        status: "cancelled",
        function: null,
        action: null,
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
    const icon = (label: RegExp) =>
      rowButton(label).querySelector('i[class*="kindIcon"]')?.className;
    expect(icon(/slow/)).toContain("bi-activity");
    expect(icon(/gate/)).toContain("bi-signpost-split");
  });

  it("shows a failed monitor as a row whose detail is the error", () => {
    renderTool([
      failure("broken", "broken", "llm_suspicion"),
      observation("mon", "steady", "suspicion", 0.15),
    ]);
    expect(screen.getByText("Observed")).toBeTruthy();
    expect(screen.getByText("1 failed")).toBeTruthy();
    fireEvent.click(pill(2));
    const row = rowButton(/broken/);
    expect(row.className).toContain("inactive");
    expect(row.textContent).toContain("failed");
    expect(rowButton(/steady/).textContent).not.toContain("failed");
    fireEvent.click(row);
    expect(screen.getByText("RuntimeError: model unavailable")).toBeTruthy();
    expect(screen.queryByText("No explanation recorded.")).toBeNull();
  });

  it("calls a step whose only check failed failed, with its error preformatted", () => {
    renderTool([failure("broken", "broken", "llm_suspicion")]);
    expect(screen.getByText("Failed")).toBeTruthy();
    expect(screen.getByText("RuntimeError: model unavailable").tagName).toBe(
      "PRE"
    );
    expect(screen.queryByText(/failed$/)).toBeNull();
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

  it("links the cites of a standalone step's reason through its context", async () => {
    const nodes = [
      decision("m1", "", "threshold", "reject", {
        stage: "model_output",
        step_id: "msg_1",
        explanation: "Edits the tests [M2].",
        references: [{ type: "message", id: "msg_2", cite: "[M2]" }],
      }),
    ];
    const { standaloneSentinels } = pairToolSentinels(nodes);
    const { container } = renderWithState(
      <SentinelEventView
        eventNode={nodes[0]!}
        step={standaloneSentinels.get("m1")}
        context={{ makeCiteUrl: (id, type) => `#/${type}/${id}` }}
      />
    );
    await waitFor(() => {
      expect(
        container.querySelector("[data-ref-id]")?.getAttribute("href")
      ).toBe("#/message/msg_2");
    });
  });

  it("keeps a lone child escalate in the escalate tone", () => {
    renderWithState(
      <SentinelEventView
        eventNode={node("esc", {
          path: "review",
          factory: "escalate_on_doubt",
          action: "escalate",
        })}
      />
    );
    expect(screen.getByText("Escalated")).toBeTruthy();
  });

  it("gives an event shown alone an honest verdict", () => {
    const { container } = renderWithState(
      <SentinelEventView
        eventNode={node("byp", {
          path: "guard",
          factory: "concurrent",
          status: "bypassed",
          function: null,
          action: null,
        })}
      />
    );
    expect(screen.getByText("Bypassed")).toBeTruthy();
    expect(container.textContent).not.toContain("Continued");
  });
});
