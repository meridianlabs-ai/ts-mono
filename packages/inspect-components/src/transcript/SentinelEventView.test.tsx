// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  testSentinelEvent,
  testToolCall,
  testToolEvent,
} from "@tsmono/inspect-common/testing";
import type { SentinelEvent } from "@tsmono/inspect-common/types";
import { ComponentNavigationProvider } from "@tsmono/react/components";
import { ResizeObserverStub } from "@tsmono/react/testing";

import { SentinelEventView } from "./SentinelEventView";
import { InMemoryStateWrapper } from "./testHelpers";
import { ToolEventView } from "./ToolEventView";
import { pairToolSentinels } from "./transform/toolSentinels";
import { EventNode } from "./types";

const node = (id: string, overrides: Partial<SentinelEvent>) =>
  new EventNode(id, testSentinelEvent(overrides), 0);

const renderWithState = (ui: ReactNode) =>
  render(
    <InMemoryStateWrapper>
      <ComponentNavigationProvider navigation={{ navigate: () => {} }}>
        {ui}
      </ComponentNavigationProvider>
    </InMemoryStateWrapper>
  );

const nestedFinal = () => [
  node("internet", {
    path: "attempt/internet_attempt",
    name: "internet_attempt",
    function: "internet_attempt",
    decision: "escalate",
    outcome: "escalate",
    explanation: "Fetches an unknown host.",
  }),
  node("chain", {
    path: "attempt",
    name: "chain",
    kind: "bypassed",
    function: null,
    decision: null,
    outcome: null,
  }),
  node("root", {
    path: "",
    name: "concurrent",
    kind: "bypassed",
    function: null,
    decision: null,
    outcome: null,
  }),
  node("human", {
    path: "attempt/human",
    name: "human",
    function: "human",
    decision: "reject",
    outcome: "reject",
    explanation: "Not on the allow list.",
  }),
];

describe("SentinelEventView", () => {
  beforeEach(() => {
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("renders one row per report and folds bypassed layers into a note", () => {
    const nodes = nestedFinal();
    const { standaloneSentinels } = pairToolSentinels(nodes);
    const { container } = renderWithState(
      <SentinelEventView
        eventNode={nodes[0]!}
        step={standaloneSentinels.get("internet")}
      />
    );

    expect(screen.getByText("attempt/internet_attempt")).toBeTruthy();
    expect(screen.getByText("attempt/human")).toBeTruthy();
    expect(screen.getByText("escalate")).toBeTruthy();
    expect(screen.getByText("reject")).toBeTruthy();
    expect(screen.getByText("Not on the allow list.")).toBeTruthy();
    // Bypassed layers have no row of their own.
    expect(screen.queryByText("chain")).toBeNull();

    const note = screen.getByRole("button", { name: /overrode 2 layers/ });
    expect(note.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(note);
    expect(note.getAttribute("aria-expanded")).toBe("true");
    const items = container.querySelectorAll("li");
    expect([...items].map((li) => li.textContent)).toEqual([
      "bypassedattempt",
      "bypassedconcurrent",
    ]);
  });

  it("shows the suspicion of an observation and the audit flag", () => {
    const observation = node("obs", {
      path: "monitor",
      name: "suspicion_monitor",
      kind: "observation",
      suspicion: { exfiltration: 0.8 },
      decision: null,
      outcome: null,
      audit: true,
    });
    renderWithState(<SentinelEventView eventNode={observation} />);

    expect(screen.getByText("observation")).toBeTruthy();
    expect(screen.getByText("exfiltration 0.8")).toBeTruthy();
    expect(screen.getByText("audit")).toBeTruthy();
    expect(screen.getByText("suspicion_monitor")).toBeTruthy();
  });

  it("renders before-call steps between a tool's input and output, after-call steps after it", () => {
    const tool = new EventNode(
      "tool-1",
      testToolEvent({
        id: "call_1",
        function: "bash",
        arguments: { cmd: "INPUT_TEXT" },
        result: "RESULT_TEXT",
      }),
      0
    );
    const before = node("before", {
      path: "",
      name: "before_protocol",
      decision: "continue",
      outcome: "continue",
    });
    const after = node("after", {
      stage: "tool_result",
      path: "",
      name: "after_monitor",
      kind: "observation",
      suspicion: 0.3,
      decision: null,
      outcome: null,
    });
    const { toolSentinels } = pairToolSentinels([before, tool, after]);
    const { container } = renderWithState(
      <ToolEventView
        eventNode={tool}
        childNodes={[]}
        context={{ toolSentinels }}
      />
    );

    const text = container.textContent;
    const inputAt = text.indexOf("INPUT_TEXT");
    const beforeAt = text.indexOf("before_protocol");
    const resultAt = text.indexOf("RESULT_TEXT");
    const afterAt = text.indexOf("after_monitor");
    expect(inputAt).toBeGreaterThan(-1);
    expect(beforeAt).toBeGreaterThan(inputAt);
    expect(resultAt).toBeGreaterThan(beforeAt);
    expect(afterAt).toBeGreaterThan(resultAt);
    expect(text).not.toContain("tool call");
  });

  it("renders before-call steps for a call with no output", () => {
    const tool = new EventNode(
      "tool-1",
      testToolEvent({ id: "call_1", result: "" }),
      0
    );
    const before = node("before", {
      name: "before_protocol",
      decision: "reject",
      outcome: "reject",
    });
    const { toolSentinels } = pairToolSentinels([before, tool]);
    const { container } = renderWithState(
      <ToolEventView
        eventNode={tool}
        childNodes={[]}
        context={{ toolSentinels }}
      />
    );
    expect(container.textContent).toContain("before_protocol");
    expect(container.textContent).toContain("reject");
  });

  it("shows the replacement call of a modify decision", () => {
    const modify = node("modify", {
      name: "defer_to_trusted",
      decision: "modify",
      outcome: "modify",
      modified: testToolCall({
        function: "bash",
        arguments: { cmd: "ls /workspace" },
      }),
    });
    renderWithState(<SentinelEventView eventNode={modify} />);
    expect(screen.getByText('bash(cmd="ls /workspace")')).toBeTruthy();
  });
});
