import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { useRef, useState } from "react";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  testAssistantMessage,
  testChatCompletionChoice,
  testModelEvent,
  testModelOutput,
  testStepEvent,
  testTimeline,
  testTimelineEvent,
  testTimelineSpan,
  testToolEvent,
} from "@tsmono/inspect-common/testing";
import { rawEventBuilders } from "@tsmono/inspect-components/transcript/test-helpers";
import { ResizeObserverStub } from "@tsmono/react/testing";

import {
  initializeStore,
  InspectComponentProvider,
  TranscriptLayout,
} from "./index";

vi.stubGlobal("ResizeObserver", ResizeObserverStub);

beforeAll(() => {
  Element.prototype.scrollTo = function () {};
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(40);
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(800);
});

beforeEach(() => {
  initializeStore({
    downloadFiles: false,
    downloadLogs: false,
    webWorkers: false,
    streamSamples: false,
  });
});

afterEach(cleanup);

const raw = rawEventBuilders();

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

const agentAAnswer = "Agent A lane answer";
const agentBAnswer = "Agent B lane answer";
const auditorAnswer = "Auditor timeline answer";

const timelineEvents = [
  modelEvent("agent-a-message", "agent-a", agentAAnswer),
  modelEvent("agent-b-message", "agent-b", agentBAnswer, "Agent B failed"),
  modelEvent("auditor-message", "auditor-root", auditorAnswer),
];

const timelines = [
  testTimeline({
    name: "default",
    root: testTimelineSpan({
      id: "root",
      name: "Transcript",
      content: [
        testTimelineSpan({
          id: "agent-a",
          name: "Agent A",
          span_type: "agent",
          content: [testTimelineEvent({ event: "agent-a-message" })],
        }),
        testTimelineSpan({
          id: "agent-b",
          name: "Agent B",
          span_type: "agent",
          content: [testTimelineEvent({ event: "agent-b-message" })],
        }),
      ],
    }),
  }),
  testTimeline({
    name: "auditor",
    root: testTimelineSpan({
      id: "auditor-root",
      name: "Auditor",
      content: [testTimelineEvent({ event: "auditor-message" })],
    }),
  }),
];

function modelEvent(
  uuid: string,
  spanId: string,
  content: string,
  error?: string
) {
  return testModelEvent({
    ...raw.base(),
    uuid,
    span_id: spanId,
    ...(error === undefined ? {} : { error }),
    input: [],
    output: testModelOutput({
      choices: [
        testChatCompletionChoice({
          message: testAssistantMessage({ content }),
        }),
      ],
    }),
  });
}

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
  const [eventId, setEventId] = useState<string | null>(null);

  return (
    <InspectComponentProvider navigate={() => {}}>
      <output aria-label="Selected timeline row">{selected ?? "root"}</output>
      <div ref={scrollRef}>
        <TranscriptLayout
          embedded
          events={timelineEvents}
          listId="embedded-timeline-events"
          scrollRef={scrollRef}
          collapseState={{ transcript: {} }}
          timeline={{
            serverTimelines: timelines,
            markerConfig: { kinds: ["error"], depth: "direct" },
            showSwimlanes: true,
            selection: {
              selected,
              onSelect: (key, options) => {
                setSelected(key);
                if (!options?.preserveDeepLink) setEventId(null);
              },
            },
            active: { activeIndex, onActiveChange: setActiveIndex },
            onMarkerNavigate: (id, key) => {
              if (key) setSelected(key);
              setEventId(id);
            },
          }}
          deepLink={{ eventId }}
          onNavigatedToEvent={setEventId}
        />
      </div>
    </InspectComponentProvider>
  );
}

describe("InspectComponentProvider", () => {
  it("keeps transcript collapse details interactive", () => {
    render(<CollapseHarness />);

    expect(screen.getByText("nested detail after expansion")).toBeVisible();
    fireEvent.click(
      screen.getByRole("button", { name: /Collapse.*delegated task/i })
    );
    expect(screen.queryByText("nested detail after expansion")).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: /Expand.*delegated task/i })
    );
    expect(screen.getByText("nested detail after expansion")).toBeVisible();
  });

  it("keeps lane selection and timeline switching interactive", async () => {
    render(<TimelineHarness />);

    expect(document.getElementById("agent-a")).not.toBeNull();
    expect(document.getElementById("agent-b")).not.toBeNull();
    expect(document.getElementById("auditor-message")).toBeNull();

    fireEvent.click(screen.getByRole("gridcell", { name: "Agent A" }));

    await waitFor(() => {
      expect(document.getElementById("agent-a-message")).not.toBeNull();
      expect(document.getElementById("agent-b-message")).toBeNull();
    });
    expect(
      screen.getByLabelText("Selected timeline row")
    ).not.toHaveTextContent("root");

    fireEvent.click(screen.getByRole("button", { name: /default/i }));
    fireEvent.click(screen.getByRole("option", { name: "auditor" }));

    await waitFor(() => {
      expect(document.getElementById("auditor-message")).not.toBeNull();
    });
    expect(document.getElementById("agent-a")).toBeNull();
    expect(document.getElementById("agent-b")).toBeNull();
    expect(screen.getByLabelText("Selected timeline row")).toHaveTextContent(
      "root"
    );
  });

  it("feeds marker and keyboard navigation events back through deep links", async () => {
    render(<TimelineHarness />);

    fireEvent.click(screen.getByRole("gridcell", { name: "Agent A" }));
    await waitFor(() => {
      expect(document.getElementById("agent-a-message")).not.toBeNull();
      expect(document.getElementById("agent-b-message")).toBeNull();
    });

    fireEvent.click(screen.getByTitle(/Agent B failed/));

    await waitFor(() => {
      expect(document.getElementById("agent-b-message")).not.toBeNull();
    });
    expect(document.getElementById("agent-a-message")).toBeNull();
    expect(document.getElementById("auditor-message")).toBeNull();

    fireEvent.keyDown(window, { key: "l" });

    await waitFor(() => {
      expect(document.getElementById("auditor-message")).not.toBeNull();
    });
    expect(document.getElementById("agent-a")).toBeNull();
    expect(document.getElementById("agent-b")).toBeNull();
  });
});
