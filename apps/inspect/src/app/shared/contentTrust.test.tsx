// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useHasAllContentPermissions } from "@tsmono/react/components";

import {
  SelectedSampleContentTrustProvider,
  SelectionContentTrustProvider,
} from "./contentTrust";

interface Header {
  eval: { viewer?: { trust_content?: boolean } };
}

interface MockState {
  selectedLogFile?: string;
  sampleLogFile?: string;
  // A file absent from `headers` is still loading.
  headers: Record<string, Header>;
}

const mocks = vi.hoisted(() => {
  const state: MockState = { headers: {} };
  return state;
});

vi.mock("../routing/currentSelection", () => ({
  useCurrentLogFile: () => mocks.selectedLogFile,
  useCurrentSampleHandle: () =>
    mocks.sampleLogFile
      ? { id: 1, epoch: 1, logFile: mocks.sampleLogFile }
      : undefined,
}));

vi.mock("../../app_config", () => ({ useLogDir: () => "dir" }));

vi.mock("../../log_data", () => ({
  useLogHeader: (_dir: string, file: string | undefined) =>
    file !== undefined && file in mocks.headers
      ? { loading: false, data: mocks.headers[file] }
      : { loading: file !== undefined, data: undefined },
}));

const TRUSTED: Header = { eval: {} };
const UNTRUSTED: Header = { eval: { viewer: { trust_content: false } } };

const TrustProbe = () => (
  <span>{useHasAllContentPermissions() ? "trusted" : "untrusted"}</span>
);
const selectionTrust = () =>
  render(
    <SelectionContentTrustProvider>
      <TrustProbe />
    </SelectionContentTrustProvider>
  ).container.textContent;

const sampleTrust = () =>
  render(
    <SelectedSampleContentTrustProvider>
      <TrustProbe />
    </SelectedSampleContentTrustProvider>
  ).container.textContent;

afterEach(() => {
  cleanup();
  mocks.selectedLogFile = undefined;
  mocks.sampleLogFile = undefined;
  mocks.headers = {};
});

describe("SelectionContentTrustProvider", () => {
  it("is untrusted with nothing selected", () => {
    expect(selectionTrust()).toBe("untrusted");
  });

  it("is untrusted while the selected log's header loads", () => {
    mocks.selectedLogFile = "a.eval";
    expect(selectionTrust()).toBe("untrusted");
  });

  it("is trusted for a loaded log without the setting", () => {
    mocks.selectedLogFile = "a.eval";
    mocks.headers = { "a.eval": TRUSTED };
    expect(selectionTrust()).toBe("trusted");
  });

  it("is untrusted for a log that sets trust_content=false", () => {
    mocks.selectedLogFile = "a.eval";
    mocks.headers = { "a.eval": UNTRUSTED };
    expect(selectionTrust()).toBe("untrusted");
  });

  it("ignores a sample selection left over from another log", () => {
    mocks.selectedLogFile = "a.eval";
    mocks.sampleLogFile = "b.eval";
    mocks.headers = { "a.eval": TRUSTED, "b.eval": UNTRUSTED };
    expect(selectionTrust()).toBe("trusted");
  });
});

describe("SelectedSampleContentTrustProvider", () => {
  it("is trusted when the sample's log is", () => {
    mocks.selectedLogFile = "a.eval";
    mocks.sampleLogFile = "a.eval";
    mocks.headers = { "a.eval": TRUSTED };
    expect(sampleTrust()).toBe("trusted");
  });

  it("is untrusted when the selected sample's log is untrusted", () => {
    mocks.selectedLogFile = "a.eval";
    mocks.sampleLogFile = "b.eval";
    mocks.headers = { "a.eval": TRUSTED, "b.eval": UNTRUSTED };
    expect(sampleTrust()).toBe("untrusted");
  });

  it("falls back to the selected log without a sample selection", () => {
    mocks.selectedLogFile = "b.eval";
    mocks.headers = { "b.eval": UNTRUSTED };
    expect(sampleTrust()).toBe("untrusted");
  });

  it("is untrusted while the selected sample's log header loads", () => {
    mocks.selectedLogFile = "a.eval";
    mocks.sampleLogFile = "b.eval";
    mocks.headers = { "a.eval": TRUSTED };
    expect(sampleTrust()).toBe("untrusted");
  });
});
