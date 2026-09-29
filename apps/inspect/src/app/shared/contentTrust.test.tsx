// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useContentTrust } from "@tsmono/react/components";

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
  // Headers as read from the server this session (defaults to `headers`); a
  // file absent from it hasn't been read yet.
  serverHeaders?: Record<string, Header>;
}

const mocks = vi.hoisted(() => {
  const state: MockState = { headers: {} };
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
  useServerLogContentTrust: (_dir: string, file: string | undefined) => {
    const header =
      file === undefined
        ? undefined
        : (mocks.serverHeaders ?? mocks.headers)[file];
    return header === undefined || header.eval.viewer?.trust_content === false
      ? "untrusted"
      : "trusted";
  },
}));

const TRUSTED: Header = { eval: {} };
const UNTRUSTED: Header = { eval: { viewer: { trust_content: false } } };

const TrustProbe = () => <span>{useContentTrust()}</span>;
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
  mocks.serverHeaders = undefined;
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

  it("is untrusted while a cached trusted header awaits its server read", () => {
    mocks.selectedLogFile = "a.eval";
    mocks.headers = { "a.eval": TRUSTED };
    mocks.serverHeaders = {};
    expect(selectionTrust()).toBe("untrusted");
  });

  it("is untrusted when the server read finds the file now untrusted", () => {
    // The file was rewritten since its trusted header was cached.
    mocks.selectedLogFile = "a.eval";
    mocks.headers = { "a.eval": TRUSTED };
    mocks.serverHeaders = { "a.eval": UNTRUSTED };
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

  it("is untrusted until the sample's log header is read from the server", () => {
    mocks.selectedLogFile = "a.eval";
    mocks.sampleLogFile = "a.eval";
    mocks.headers = { "a.eval": TRUSTED };
    mocks.serverHeaders = {};
    expect(sampleTrust()).toBe("untrusted");
  });

  it("is untrusted while the selected sample's log header loads", () => {
    mocks.selectedLogFile = "a.eval";
    mocks.sampleLogFile = "b.eval";
    mocks.headers = { "a.eval": TRUSTED };
    expect(sampleTrust()).toBe("untrusted");
  });
});
