// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { type PropsWithChildren } from "react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ComponentNavigationProvider,
  ExtendedFindProvider,
  FindBand,
  FindTargetProvider,
} from "@tsmono/react/components";
import { ComponentStateProvider } from "@tsmono/react/state";
import { makeStateHooks, stubFindHighlightApi } from "@tsmono/react/testing";

import {
  createAppConfig,
  createScanResultData,
} from "../../../test/objectFactories";
import { server } from "../../../test/setup-msw";
import { createTestWrapper } from "../../../test/test-utils";
import type { AppConfig } from "../../../types/api-types";
import { useAppConfigAsync } from "../../server/useAppConfig";

import { ResultSidebar } from "./ResultSidebar";

// Reference links read the scan route, which needs the loaded app config.
const AppConfigGate = ({ children }: PropsWithChildren) => {
  const { data } = useAppConfigAsync();
  return data ? <>{children}</> : null;
};

const renderSidebar = (explanation: string) => {
  server.use(
    http.get("/api/v2/app-config", () =>
      HttpResponse.json<AppConfig>(createAppConfig())
    )
  );
  const Wrapper = createTestWrapper();
  render(
    <Wrapper>
      <AppConfigGate>
        <ComponentStateProvider hooks={makeStateHooks()}>
          <MemoryRouter>
            <ComponentNavigationProvider navigation={{ navigate: () => {} }}>
              <ResultSidebar
                resultData={createScanResultData({
                  explanation,
                  messageReferences: [
                    { type: "message", id: "m17", cite: "[M17]" },
                  ],
                })}
              />
            </ComponentNavigationProvider>
          </MemoryRouter>
        </ComponentStateProvider>
      </AppConfigGate>
    </Wrapper>
  );
};

// The transcript beside the sidebar, standing in with one paragraph.
const findBeside = (transcriptText: string, term: string): string => {
  render(
    <ExtendedFindProvider>
      <FindTargetProvider>
        <FindBand onClose={() => {}} />
        <p>{transcriptText}</p>
      </FindTargetProvider>
    </ExtendedFindProvider>
  );
  const input = screen.getByPlaceholderText("Find");
  fireEvent.change(input, { target: { value: term } });
  fireEvent.keyDown(input, { key: "Enter" });
  return screen.getByTestId("find-band-match-count").textContent;
};

describe("ResultSidebar", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("keeps grep excerpts of the transcript out of in-page Find", async () => {
    stubFindHighlightApi(vi.stubGlobal);
    renderSidebar(
      '[M17]: ...    except Exception as e:  print(f"**Error** downloading {path}")'
    );
    await screen.findByText(/downloading/);

    expect(
      findBeside(`print(f"Error downloading {path}")`, "downloading {path}")
    ).toBe("1 of 1");
  });

  it("still finds text in a scanner's own explanation", async () => {
    stubFindHighlightApi(vi.stubGlobal);
    renderSidebar(
      'The user asked the assistant to "think step by step" [M17].'
    );
    await screen.findByText(/step by step/);

    expect(findBeside("Think step by step.", "think step by step")).toBe(
      "1 of 2"
    );
  });
});
