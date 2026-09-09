import { render, screen } from "@testing-library/react";
import { createRef } from "react";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { ResizeObserverStub } from "@tsmono/react/testing";

import {
  ChatView,
  initializeStore,
  InspectComponentProvider,
  TranscriptLayout,
  type ChatMessage,
} from "./index";

vi.stubGlobal("ResizeObserver", ResizeObserverStub);

beforeAll(() => {
  initializeStore({
    downloadFiles: false,
    downloadLogs: false,
    webWorkers: false,
    streamSamples: false,
  });
});

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

  it("composes TranscriptLayout without host-app find providers", () => {
    const scrollRef = createRef<HTMLDivElement>();

    render(
      <InspectComponentProvider navigate={() => {}}>
        <div ref={scrollRef}>
          <TranscriptLayout
            embedded
            events={[]}
            listId="embedded-events"
            scrollRef={scrollRef}
          />
        </div>
      </InspectComponentProvider>
    );

    expect(
      screen.getByText("No events match the current filter")
    ).toBeVisible();
  });
});
