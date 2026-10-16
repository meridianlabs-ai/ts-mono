// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { FC, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { testEvalSpec } from "@tsmono/inspect-common/testing";
import { useHasAllContentPermissions } from "@tsmono/react/components";

import { useLogDir } from "../../app_config";
import { testClientAPI, testLogDetails } from "../../client/api/testClientApi";
import { LogDetails } from "../../client/api/types";
import { useLogHeader } from "../../log_data";
import { startTestApp, stopTestApp, TestApp } from "../../test/testApp";
import { useCurrentLogFile } from "../routing/currentSelection";

import { SelectionContentTrustProvider } from "./contentTrust";

// Logs served by the api: trusted.eval has no viewer setting,
// untrusted.eval sets trust_content=false, and loading.eval's details
// never arrive.
const logs: Record<string, LogDetails> = {
  "/logs/trusted.eval": testLogDetails({ eval: testEvalSpec() }),
  "/logs/untrusted.eval": testLogDetails({
    eval: testEvalSpec({
      viewer: { trust_content: false, scanner_result_view: {} },
    }),
  }),
};

const requested: string[] = [];

beforeEach(() => {
  requested.length = 0;
  startTestApp({
    api: testClientAPI({
      get_log_details: (file) => {
        requested.push(file);
        const details = logs[file];
        return details ? Promise.resolve(details) : new Promise(() => {});
      },
    }),
  });
});

afterEach(async () => {
  cleanup();
  await stopTestApp();
});

// Renders the trust beside whether the selected log's header has settled,
// so a test can wait for the header to land and read the trust it produced
// in the same render.
const TrustProbe = () => {
  const trusted = useHasAllContentPermissions();
  const header = useLogHeader(useLogDir(), useCurrentLogFile(), {
    demand: "passive",
  });
  return (
    <output>
      {`${trusted ? "trusted" : "untrusted"} ${header.loading ? "loading" : "settled"}`}
    </output>
  );
};

const renderAt = (path: string, Provider: FC<{ children: ReactNode }>) =>
  render(
    <TestApp path={path}>
      <Provider>
        <TrustProbe />
      </Provider>
    </TestApp>
  );

const trust = () => screen.getByRole("status").textContent;
// Headers arrive through the engine's details fetch.
const settled = (text: string) =>
  screen.findByText(text, { selector: "output" });

describe("SelectionContentTrustProvider", () => {
  it("is untrusted with nothing selected", () => {
    renderAt("/logs", SelectionContentTrustProvider);
    expect(trust()).toBe("untrusted settled");
  });

  it("is untrusted while the selected log's header loads", async () => {
    renderAt("/logs/loading.eval", SelectionContentTrustProvider);
    await waitFor(() => expect(requested).toContain("/logs/loading.eval"));
    expect(trust()).toBe("untrusted loading");
  });

  it("is trusted for a loaded log without the setting", async () => {
    renderAt("/logs/trusted.eval", SelectionContentTrustProvider);
    expect(await settled("trusted settled")).toBeInTheDocument();
  });

  it("is untrusted for a log that sets trust_content=false", async () => {
    renderAt("/logs/untrusted.eval", SelectionContentTrustProvider);
    expect(await settled("untrusted settled")).toBeInTheDocument();
  });
});

describe("a sample route takes its log's trust", () => {
  it("is trusted when the sample's log is", async () => {
    renderAt(
      "/logs/trusted.eval/samples/sample/1/1",
      SelectionContentTrustProvider
    );
    expect(await settled("trusted settled")).toBeInTheDocument();
  });

  it("is untrusted when the sample's log is untrusted", async () => {
    renderAt(
      "/logs/untrusted.eval/samples/sample/1/1",
      SelectionContentTrustProvider
    );
    expect(await settled("untrusted settled")).toBeInTheDocument();
  });

  it("is untrusted while the sample's log header loads", async () => {
    renderAt(
      "/logs/loading.eval/samples/sample/1/1",
      SelectionContentTrustProvider
    );
    await waitFor(() => expect(requested).toContain("/logs/loading.eval"));
    expect(trust()).toBe("untrusted loading");
  });
});
