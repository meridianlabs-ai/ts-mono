// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  testModelEvent,
  testModelOutput,
} from "@tsmono/inspect-common/testing";
import type { ModelEvent } from "@tsmono/inspect-common/types";
import {
  ComponentIconProvider,
  ComponentNavigationProvider,
  ContentTrustProvider,
} from "@tsmono/react/components";
import { ComponentStateProvider } from "@tsmono/react/state";
import {
  makeReactiveStateHooks,
  ResizeObserverStub,
  testIcons,
} from "@tsmono/react/testing";

import { ModelEventView } from "./ModelEventView";
import { EventNode } from "./types";

const renderInfoTab = (event: ModelEvent) => {
  const result = render(
    <ComponentStateProvider hooks={makeReactiveStateHooks()}>
      <ComponentIconProvider icons={testIcons}>
        <ComponentNavigationProvider navigation={{ navigate: () => {} }}>
          <ContentTrustProvider value="trusted">
            <ModelEventView
              eventNode={new EventNode<ModelEvent>("model-1", event, 0)}
              showToolCalls={true}
            />
          </ContentTrustProvider>
        </ComponentNavigationProvider>
      </ComponentIconProvider>
    </ComponentStateProvider>
  );
  fireEvent.click(screen.getByRole("tab", { name: "Info" }));
  return result;
};

const providerRows = () =>
  screen
    .getAllByRole("button", { name: /^Copy / })
    .map((button) => button.parentElement?.textContent.trim());

describe("ModelEventView provider IDs", () => {
  beforeEach(() => {
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("omits the section for events logged without provider ids", () => {
    renderInfoTab(testModelEvent({ config: { temperature: 0.5 } }));
    expect(screen.getByText("Configuration")).toBeDefined();
    expect(screen.queryByText("Provider IDs")).toBeNull();
  });

  it("shows a response id on its own", () => {
    renderInfoTab(
      testModelEvent({
        output: testModelOutput({ response_id: "msg_011Cfhy6C3DBn6t" }),
      })
    );
    expect(screen.getByText("Provider IDs")).toBeDefined();
    expect(providerRows()).toEqual(["responsemsg_011Cfhy6C3DBn6t"]);
    expect(screen.getByRole("button", { name: "Copy response" })).toBeDefined();
  });

  it("lists every request id in recorded order, including failed attempts", () => {
    renderInfoTab(
      testModelEvent({
        output: testModelOutput({ response_id: "chatcmpl-abc" }),
        request_ids: [
          { header: "x-request-id", id: "req_first", status: 429 },
          { header: "x-request-id", id: "req_second", status: 200 },
        ],
      })
    );
    expect(providerRows()).toEqual([
      "responsechatcmpl-abc",
      "x-request-idreq_first429",
      "x-request-idreq_second200",
    ]);
    expect(
      screen.getAllByRole("button", { name: "Copy x-request-id" })
    ).toHaveLength(2);
  });
});
