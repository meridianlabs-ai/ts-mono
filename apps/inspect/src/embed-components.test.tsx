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
  ChatView,
  initializeStore,
  InspectComponentProvider,
  TranscriptLayout,
  type ChatMessage,
  type InspectComponentProviderProps,
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

function MarkerDeepLinkHarness() {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [eventId, setEventId] = useState<string | null>(null);

  return (
    <InspectComponentProvider navigate={() => {}}>
      <div ref={scrollRef}>
        <TranscriptLayout
          embedded
          events={timelineEvents}
          listId="embedded-marker-events"
          scrollRef={scrollRef}
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
            onMarkerNavigate: setEventId,
          }}
          deepLink={{ eventId }}
          onNavigatedToEvent={setEventId}
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

  it("routes in-view citation links through the host navigation adapter", async () => {
    const navigate = vi.fn<InspectComponentProviderProps["navigate"]>();
    const message: ChatMessage = {
      role: "assistant",
      content: "Open [M1]",
    };

    render(
      <InspectComponentProvider navigate={navigate}>
        <ChatView
          id="embedded-citations"
          messages={[message]}
          references={[
            {
              id: "message-1",
              cite: "[M1]",
              citeUrl: "#/sample?message=message-1",
            },
          ]}
        />
      </InspectComponentProvider>
    );

    fireEvent.click(await screen.findByRole("link", { name: "M1" }));

    expect(navigate).toHaveBeenCalledWith("/sample?message=message-1", {
      replace: true,
    });
  });

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

    expect(await screen.findByText(agentAAnswer)).toBeVisible();
    expect(screen.getByText(agentBAnswer)).toBeVisible();
    expect(screen.queryByText(auditorAnswer)).toBeNull();

    fireEvent.click(screen.getByRole("gridcell", { name: "Agent A" }));

    expect(await screen.findByText(agentAAnswer)).toBeVisible();
    await waitFor(() => {
      expect(screen.queryByText(agentBAnswer)).toBeNull();
    });
    expect(
      screen.getByLabelText("Selected timeline row")
    ).not.toHaveTextContent("root");

    fireEvent.click(screen.getByRole("button", { name: /default/i }));
    fireEvent.click(screen.getByRole("option", { name: "auditor" }));

    expect(await screen.findByText(auditorAnswer)).toBeVisible();
    expect(screen.queryByText(agentAAnswer)).toBeNull();
    expect(screen.queryByText(agentBAnswer)).toBeNull();
    expect(screen.getByLabelText("Selected timeline row")).toHaveTextContent(
      "root"
    );
  });

  it("feeds marker and keyboard navigation events back through deep links", async () => {
    render(<MarkerDeepLinkHarness />);

    fireEvent.click(screen.getByRole("gridcell", { name: "Agent A" }));
    expect(await screen.findByText(agentAAnswer)).toBeVisible();
    await waitFor(() => {
      expect(screen.queryByText(agentBAnswer)).toBeNull();
    });

    fireEvent.click(screen.getByTitle(/Agent B failed/));

    expect(await screen.findByText(agentBAnswer)).toBeVisible();
    expect(screen.queryByText(agentAAnswer)).toBeNull();
    expect(screen.queryByText(auditorAnswer)).toBeNull();

    fireEvent.keyDown(window, { key: "l" });

    expect(await screen.findByText(auditorAnswer)).toBeVisible();
    expect(screen.queryByText(agentAAnswer)).toBeNull();
    expect(screen.queryByText(agentBAnswer)).toBeNull();
  });
});
