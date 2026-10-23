// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { type PropsWithChildren } from "react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it } from "vitest";

import { ComponentNavigationProvider } from "@tsmono/react/components";
import { ComponentStateProvider } from "@tsmono/react/state";
import { makeStateHooks } from "@tsmono/react/testing";
import { AsyncData, loading } from "@tsmono/util";

import type {
  InputReferenceError,
  ScanResultDetail,
  ScoutApiV2,
} from "../../../api/api";
import { apiScoutServer } from "../../../api/api-scout-server";
import { ApiProvider } from "../../../state/store";
import {
  createAppConfig,
  createScanResultData,
} from "../../../test/objectFactories";
import { server } from "../../../test/setup-msw";
import { createTestWrapper } from "../../../test/test-utils";
import type { AppConfig } from "../../../types/api-types";
import { useAppConfigAsync } from "../../server/useAppConfig";
import type { ScanResultData } from "../../types";

import { ResultPanel } from "./ResultPanel";

afterEach(cleanup);

// The sidebar reads the loaded app config synchronously.
const AppConfigGate = ({ children }: PropsWithChildren) => {
  const { data } = useAppConfigAsync();
  return data ? <>{children}</> : null;
};

const resultData = createScanResultData({
  uuid: "result-uuid-1",
  explanation: "The agent gave up early.",
});

const renderPanel = (
  detail: AsyncData<ScanResultDetail>,
  api: ScoutApiV2 = apiScoutServer(),
  data: ScanResultData = resultData
) => {
  server.use(
    http.get("/api/v2/app-config", () =>
      HttpResponse.json<AppConfig>(createAppConfig())
    )
  );
  const Providers = createTestWrapper();
  render(
    <Providers>
      <ApiProvider value={api}>
        <ComponentStateProvider hooks={makeStateHooks()}>
          <AppConfigGate>
            <MemoryRouter>
              <ComponentNavigationProvider navigation={{ navigate: () => {} }}>
                <ResultPanel resultData={data} detail={detail} />
              </ComponentNavigationProvider>
            </MemoryRouter>
          </AppConfigGate>
        </ComponentStateProvider>
      </ApiProvider>
    </Providers>
  );
};

describe("ResultPanel", () => {
  it("renders the result sidebar while the input is loading", async () => {
    renderPanel(loading);
    await screen.findByText("The agent gave up early.");
    screen.getByText("Loading input");
  });

  it("says there is no input for a row without a uuid instead of loading forever", async () => {
    renderPanel(loading, apiScoutServer(), { ...resultData, uuid: undefined });
    await screen.findByText("The agent gave up early.");
    screen.getByText("No input for this result");
    expect(screen.queryByText("Loading input")).toBeNull();
  });

  it("shows why the input failed to load next to the result", async () => {
    renderPanel({ loading: false, error: new Error("Internal Server Error") });
    await screen.findByText("The agent gave up early.");
    screen.getByText("Error Loading Input");
    screen.getByText("Internal Server Error");
  });
});

const referenceDetail = (
  inputError: InputReferenceError
): AsyncData<ScanResultDetail> => ({
  loading: false,
  data: {
    input: { input_type: "transcript", input: null },
    scanEvents: [],
    inputStorage: "reference",
    inputError,
  },
});

describe("ResultPanel input stored by reference", () => {
  it("explains why the input is missing and links to the sample", async () => {
    const message =
      "The sample is 412.0 MiB, over this server's 16.0 MiB limit for referenced inputs.";
    renderPanel(referenceDetail({ reason: "too_large", message }), {
      ...apiScoutServer(),
      inputReferenceUrl: (transcriptId) =>
        `/permalink/sample/${encodeURIComponent(transcriptId)}`,
    });
    await screen.findByText("Input stored by reference");
    screen.getByText(message);
    expect(
      screen.getByRole("link", { name: "Open sample" }).getAttribute("href")
    ).toBe("/permalink/sample/transcript-1");
    expect(screen.queryByText("Unsupported Input Type")).toBeNull();
  });

  it("omits the link when the host cannot open samples", async () => {
    const message =
      "This result's input is stored by reference, and this server does not resolve references.";
    renderPanel(referenceDetail({ reason: "not_resolved", message }));
    await screen.findByText("Input stored by reference");
    screen.getByText(message);
    expect(screen.queryByRole("link", { name: "Open sample" })).toBeNull();
  });
});

describe("ResultPanel against a server without input_error", () => {
  it("falls back to a generic description", async () => {
    renderPanel({
      loading: false,
      data: {
        input: { input_type: "transcript", input: null },
        scanEvents: [],
        inputStorage: "reference",
      },
    });
    await screen.findByText("Input stored by reference");
    screen.getByText("This server did not resolve the input.");
  });
});
