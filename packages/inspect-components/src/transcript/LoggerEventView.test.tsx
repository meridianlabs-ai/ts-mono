// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { testLoggerEvent } from "@tsmono/inspect-common/testing";
import type { LoggerEvent } from "@tsmono/inspect-common/types";
import {
  ComponentNavigationProvider,
  ContentTrustProvider,
} from "@tsmono/react/components";
import { ComponentStateProvider } from "@tsmono/react/state";
import { makeStateHooks, ResizeObserverStub } from "@tsmono/react/testing";

import { LoggerEventView } from "./LoggerEventView";
import { EventNode } from "./types";

vi.stubGlobal("ResizeObserver", ResizeObserverStub);

const renderView = (
  message: string,
  trust: "trusted" | "untrusted" = "trusted"
) => {
  const event = testLoggerEvent();
  const node = new EventNode<LoggerEvent>(
    "logger-1",
    { ...event, message: { ...event.message, message } },
    0
  );
  return render(
    <ComponentStateProvider hooks={makeStateHooks()}>
      <ComponentNavigationProvider navigation={{ navigate: () => {} }}>
        <ContentTrustProvider value={trust}>
          <LoggerEventView eventNode={node} />
        </ContentTrustProvider>
      </ComponentNavigationProvider>
    </ComponentStateProvider>
  );
};

afterEach(() => {
  cleanup();
});

// The log message is log-authored text; one that merely looks like JSON must
// never throw out of render.
describe("LoggerEventView", () => {
  it("renders a JSON object message as a metadata grid", () => {
    const { container } = renderView('{"answer": 42}');

    expect(container.textContent).toContain("answer");
    expect(container.textContent).toContain("42");
    expect(container.textContent).not.toContain('{"answer"');
  });

  it("renders a JSON object message padded with a non-JSON space as a grid", () => {
    const { container } = renderView('\u00A0{"answer": 42}\uFEFF');

    expect(container.textContent).toContain("answer");
    expect(container.textContent).not.toContain('{"answer"');
  });

  it("renders a brace-wrapped non-JSON message as text", () => {
    const { container } = renderView("{not json}");

    expect(container.textContent).toContain("{not json}");
  });
});

it("keeps an untrusted JSON message literal, including duplicate keys and whitespace", () => {
  const source =
    '  {"result":"first","result":"second","label":"\u202Egnp.exe"}\n';
  const { container } = renderView(source, "untrusted");
  expect(container.querySelector("pre")?.textContent).toBe(
    source.replace("\u202E", "⟨U+202E⟩")
  );
});
