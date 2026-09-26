// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useContentTrust, type ContentTrust } from "@tsmono/react/components";

import {
  SelectedSampleContentTrustProvider,
  SelectionContentTrustProvider,
  useSelectedSamplesContentTrust,
} from "./contentTrust";

interface Header {
  eval: { viewer?: { trust_content?: boolean } };
}

interface MockState {
  selectedLogFile?: string;
  sampleLogFile?: string;
  // A file absent from `headers` is still loading.
  headers: Record<string, Header>;
  // Trust read with each settled row, keyed by sampleSummaryKey.
  rowTrusts: Map<string, ContentTrust>;
}

const mocks = vi.hoisted(() => {
  const state: MockState = { headers: {}, rowTrusts: new Map() };
  return state;
});

vi.mock("../../state/store", () => ({
  useStore: (selector: (state: unknown) => unknown) =>
    selector({
      logs: { selectedLogFile: mocks.selectedLogFile },
      log: {
        selectedSampleHandle: mocks.sampleLogFile
          ? { id: 1, epoch: 1, logFile: mocks.sampleLogFile }
          : undefined,
      },
    }),
}));

vi.mock("../../app_config", () => ({ useLogDir: () => "dir" }));

vi.mock("../../log_data", () => ({
  useLogHeader: (_dir: string, file: string | undefined) =>
    file !== undefined && file in mocks.headers
      ? { loading: false, data: mocks.headers[file] }
      : { loading: file !== undefined, data: undefined },
  useSampleSummariesContentTrust: () => mocks.rowTrusts,
  sampleSummaryKey: (id: string | number, epoch: number) => `${id}:${epoch}`,
}));

const TRUSTED: Header = { eval: {} };
const UNTRUSTED: Header = { eval: { viewer: { trust_content: false } } };

const TrustProbe = () => <span>{useContentTrust()}</span>;
const RowTrustProbe = ({ id }: { id: number }) => (
  <span>{useSelectedSamplesContentTrust()(id, 1)}</span>
);

const rowTrust = (id: number) =>
  render(<RowTrustProbe id={id} />).container.textContent;

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
  mocks.rowTrusts = new Map();
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
  it("is trusted when the selected log and sample's log are", () => {
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

  it("is untrusted when the selected log is untrusted", () => {
    mocks.selectedLogFile = "b.eval";
    mocks.sampleLogFile = "a.eval";
    mocks.headers = { "a.eval": TRUSTED, "b.eval": UNTRUSTED };
    expect(sampleTrust()).toBe("untrusted");
  });

  it("is untrusted while the selected sample's log header loads", () => {
    mocks.selectedLogFile = "a.eval";
    mocks.sampleLogFile = "b.eval";
    mocks.headers = { "a.eval": TRUSTED };
    expect(sampleTrust()).toBe("untrusted");
  });
});

describe("useSelectedSamplesContentTrust", () => {
  it("uses the trust read with each settled row", () => {
    mocks.selectedLogFile = "a.eval";
    mocks.headers = { "a.eval": TRUSTED };
    // Row 2 is left over from an untrusted log after a switch.
    mocks.rowTrusts = new Map([
      ["1:1", "trusted"],
      ["2:1", "untrusted"],
    ]);
    expect(rowTrust(1)).toBe("trusted");
    expect(rowTrust(2)).toBe("untrusted");
  });

  it("doesn't wait on the selected log's header for a settled row", () => {
    mocks.selectedLogFile = "a.eval";
    mocks.rowTrusts = new Map([["1:1", "trusted"]]);
    expect(rowTrust(1)).toBe("trusted");
  });

  it("uses the selected log's trust for a pending row", () => {
    mocks.selectedLogFile = "a.eval";
    mocks.headers = { "a.eval": UNTRUSTED };
    expect(rowTrust(3)).toBe("untrusted");
    mocks.headers = { "a.eval": TRUSTED };
    expect(rowTrust(3)).toBe("trusted");
  });

  it("treats a pending row as untrusted while the header loads", () => {
    mocks.selectedLogFile = "a.eval";
    expect(rowTrust(3)).toBe("untrusted");
  });
});
