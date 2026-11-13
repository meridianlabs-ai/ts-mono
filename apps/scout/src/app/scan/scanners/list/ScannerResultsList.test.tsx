// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { from } from "arquero";
import { http, HttpResponse } from "msw";
import { type PropsWithChildren } from "react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import {
  ComponentNavigationProvider,
  ExtendedFindProvider,
  type FindSource,
} from "@tsmono/react/components";
import { ComponentStateProvider } from "@tsmono/react/state";
import {
  domCountByItem,
  FindSourcesProbe,
  makeStateHooks,
  ResizeObserverStub,
} from "@tsmono/react/testing";

import {
  createAppConfig,
  createStatus,
} from "../../../../test/objectFactories";
import { server } from "../../../../test/setup-msw";
import { createTestWrapper } from "../../../../test/test-utils";
import type { AppConfig } from "../../../../types/api-types";
import { useAppConfigAsync } from "../../../server/useAppConfig";

import { ScannerResultsList } from "./ScannerResultsList";

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
  // jsdom has no layout; the virtualizer sizes its viewport from clientHeight.
  vi.spyOn(Element.prototype, "clientHeight", "get").mockReturnValue(600);
  // jsdom has no scrollTo; VirtualList calls it during mount.
  Element.prototype.scrollTo = function () {};
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// Rows read the scan route, which needs the loaded app config.
const AppConfigGate = ({ children }: PropsWithChildren) => {
  const { data } = useAppConfigAsync();
  return data ? <>{children}</> : null;
};

const result = (uuid: string, explanation: string, label: string) => ({
  uuid,
  value: "true",
  value_type: "boolean",
  input_type: "transcript",
  explanation,
  label,
  transcript_source_id: `hidden-source-${uuid}`,
  transcript_metadata: "{}",
  transcript_task_set: "popularity",
  transcript_task_id: 7,
  transcript_model: "mockllm/model",
});

it("counts Find matches in the text each result row shows", async () => {
  server.use(
    http.get("/api/v2/app-config", () =>
      HttpResponse.json<AppConfig>(createAppConfig())
    )
  );
  const Wrapper = createTestWrapper();
  let sources: (() => ReadonlyMap<string, FindSource>) | undefined;
  render(
    <Wrapper>
      <AppConfigGate>
        <ComponentStateProvider hooks={makeStateHooks()}>
          <ComponentNavigationProvider navigation={{ navigate: () => {} }}>
            <ExtendedFindProvider>
              <FindSourcesProbe onSources={(get) => (sources = get)} />
              <MemoryRouter>
                <ScannerResultsList
                  id="results"
                  selectedScan={createStatus()}
                  columnTable={from([
                    result("a", "The model refused twice.", "refusal"),
                    result("b", "No refusal here.", "compliance"),
                  ])}
                />
              </MemoryRouter>
            </ExtendedFindProvider>
          </ComponentNavigationProvider>
        </ComponentStateProvider>
      </AppConfigGate>
    </Wrapper>
  );
  expect(await screen.findByText("No refusal here.")).toBeTruthy();
  const source = sources?.().get("results");
  if (!source) throw new Error("expected the results to register for Find");

  // Field names and values the rows never show.
  expect(source.countByItem("transcriptSourceId")).toEqual([]);
  expect(source.countByItem("hidden-source")).toEqual([]);

  for (const term of ["refus", "popularity/7", "mockllm", "true"]) {
    const counts = source.countByItem(term);
    expect(counts.length).toBeGreaterThan(0);
    expect(counts).toEqual(domCountByItem(source, document.body, term));
  }
});
