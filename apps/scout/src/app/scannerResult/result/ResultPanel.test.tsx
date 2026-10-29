// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { type PropsWithChildren, type ReactNode } from "react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it } from "vitest";

import { ComponentNavigationProvider } from "@tsmono/react/components";
import { ComponentStateProvider } from "@tsmono/react/state";
import { makeStateHooks } from "@tsmono/react/testing";
import { AsyncData, encodeBase64Url, loading } from "@tsmono/util";

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
import { useScanDataframeDetail } from "../../server/useScanDataframeDetail";
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

const renderWithProviders = (
  panel: ReactNode,
  api: ScoutApiV2 = apiScoutServer()
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
                {panel}
              </ComponentNavigationProvider>
            </MemoryRouter>
          </AppConfigGate>
        </ComponentStateProvider>
      </ApiProvider>
    </Providers>
  );
};

const renderPanel = (
  detail: AsyncData<ScanResultDetail>,
  api: ScoutApiV2 = apiScoutServer(),
  data: ScanResultData = resultData
) =>
  renderWithProviders(<ResultPanel resultData={data} detail={detail} />, api);

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
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
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

describe("ResultPanel retrying a reference the source could not serve", () => {
  const params = {
    scansDir: "/scans",
    scanPath: "scan_id=test-scan",
    scanner: "interesting",
    uuid: "result-uuid-1",
  };

  const LiveResultPanel = () => {
    const detail = useScanDataframeDetail(params);
    return <ResultPanel resultData={resultData} detail={detail} />;
  };

  it("refetches the input and shows it once the source recovers", async () => {
    const row = {
      input_type: "transcript",
      input_data: null,
      input_storage: "reference",
      scan_events: [],
    };
    const responses = [
      {
        ...row,
        input: null,
        input_error: {
          reason: "unavailable",
          message: "Timed out reading the sample.",
        },
      },
      {
        ...row,
        input: {
          transcript_id: "transcript-1",
          messages: [],
          events: [],
          timelines: [],
          metadata: {},
        },
      },
    ];
    let requests = 0;
    server.use(
      http.get(
        `/api/v2/scans/${encodeBase64Url(params.scansDir)}/${encodeBase64Url(params.scanPath)}/${params.scanner}/${params.uuid}`,
        () => HttpResponse.json(responses[requests++])
      )
    );

    renderWithProviders(<LiveResultPanel />);
    await screen.findByText("Timed out reading the sample.");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    await screen.findByText("No transcript input available");
    expect(requests).toBe(2);
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
