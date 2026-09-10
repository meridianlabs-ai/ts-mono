import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useRef, useState } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { ResizeObserverStub } from "@tsmono/react/testing";
import {
  testStepEvent,
  testTimeline,
  testTimelineEvent,
  testTimelineSpan,
  testToolEvent,
} from "@tsmono/inspect-common/testing";
import { rawEventBuilders } from "@tsmono/inspect-components/transcript/test-helpers";

import {
  ChatView,
  initializeStore,
  InspectComponentProvider,
  TranscriptLayout,
  type ChatMessage,
} from "./index";

vi.stubGlobal("ResizeObserver", ResizeObserverStub);

beforeAll(() => {
  Element.prototype.scrollTo = function () {};
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(40);
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(800);
  initializeStore({
    downloadFiles: false,
    downloadLogs: false,
    webWorkers: false,
    streamSamples: false,
  });
});

afterEach(cleanup);

const raw = rawEventBuilders();
const toolSpanEvents = [
  raw.spanBegin("tool-span", "read_file", "tool", null),
  testToolEvent({
    ...raw.base(),
    uuid: "tool-event",
    span_id: "tool-span",
    function: "read_file",
    result: "tool result after expansion",
  }),
  raw.spanEnd("tool-span"),
];

const stepEvents = [
  testStepEvent({
    uuid: "step-begin",
    action: "begin",
    name: "delegated task",
  }),
  testToolEvent({
    uuid: "nested-tool-event",
    function: "read_file",
    result: "nested detail after expansion",
  }),
  testStepEvent({ uuid: "step-end", action: "end", name: "delegated task" }),
];

const timelines = [
  testTimeline({
    name: "default",
    root: testTimelineSpan({
      id: "root",
      name: "Transcript",
      content: [
        testTimelineSpan({
          name: "Agent A",
          span_type: "agent",
          content: [
            testTimelineSpan({
              id: "tool-span",
              name: "read_file",
              span_type: "tool",
              content: [testTimelineEvent({ event: "tool-event" })],
            }),
          ],
        }),
      ],
    }),
  }),
  testTimeline({
    name: "auditor",
    root: testTimelineSpan({ id: "auditor-root", name: "Auditor" }),
  }),
];

function CollapseHarness() {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>();

  return (
    <InspectComponentProvider navigate={() => {}}>
      <div ref={scrollRef}>
        <TranscriptLayout
          embedded
          events={stepEvents}
          listId="embedded-collapse-events"
          scrollRef={scrollRef}
          collapseState={{
            transcript: collapsed,
            onCollapseTranscript: (id, value) =>
              setCollapsed((current) => ({ ...current, [id]: value })),
            onSetTranscriptCollapsed: setCollapsed,
          }}
          timeline={{ showSwimlanes: false }}
        />
      </div>
    </InspectComponentProvider>
  );
}

function TimelineHarness() {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  return (
    <InspectComponentProvider navigate={() => {}}>
      <output aria-label="Selected timeline row">{selected ?? "root"}</output>
      <output aria-label="Active timeline">{timelines[activeIndex]?.name}</output>
      <div ref={scrollRef}>
        <TranscriptLayout
          embedded
          events={toolSpanEvents}
          listId="embedded-timeline-events"
          scrollRef={scrollRef}
          timeline={{
            serverTimelines: timelines,
            showSwimlanes: true,
            selection: { selected, onSelect: setSelected },
            active: {
              activeIndex,
              onActiveChange: (index) => {
                setSelected(null);
                setActiveIndex(index);
              },
            },
          }}
        />
      </div>
    </InspectComponentProvider>
  );
}

describe("InspectComponentProvider", () => {
  it("composes the message view in raw mode without host-app providers", () => {
    const message: ChatMessage = {
      role: "assistant",
      content: '{"value":"<think>literal</think>"}',
    };

    const { container } = render(
      <InspectComponentProvider displayMode="raw" navigate={() => {}}>
        <ChatView id="embedded-chat" messages={[message]} />
      </InspectComponentProvider>
    );

    expect(container.querySelector("pre")?.textContent).toBe(message.content);
  });

  it("keeps transcript collapse details interactive", () => {
    render(<CollapseHarness />);

    expect(screen.getByText("nested detail after expansion")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: /Collapse.*delegated task/i }));
    expect(screen.queryByText("nested detail after expansion")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Expand.*delegated task/i }));
    expect(screen.getByText("nested detail after expansion")).toBeVisible();
  });

  it("keeps lane selection and timeline switching interactive", () => {
    render(<TimelineHarness />);
    fireEvent.click(screen.getByRole("gridcell", { name: "Agent A" }));
    expect(screen.getByLabelText("Selected timeline row")).not.toHaveTextContent(
      "root"
    );

    fireEvent.click(screen.getByRole("button", { name: /default/i }));
    fireEvent.click(screen.getByRole("option", { name: "auditor" }));
    expect(screen.getByLabelText("Active timeline")).toHaveTextContent("auditor");
    expect(screen.getByLabelText("Selected timeline row")).toHaveTextContent(
      "root"
    );
  });
});
