// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { testEvalSpec } from "@tsmono/inspect-common/testing";
import { ContentTrustProvider } from "@tsmono/react/components";

import {
  testLogHeader,
  testSampleSummary,
} from "../../client/api/testClientApi";

import { testSamplesDescriptor } from "./descriptor/testDescriptors";
import { SampleSummaryView } from "./SampleSummaryView";

const kDisguised = "CORRECT‮gnp.exe";

vi.mock("../../state/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../state/hooks")>()),
  useSampleDescriptor: () =>
    testSamplesDescriptor({ selectedScorerDescriptor: () => undefined }),
  useSelectedScores: () => [],
  useSelectedLogDetails: () =>
    testLogHeader({
      eval: testEvalSpec({ task: kDisguised, model: kDisguised }),
    }),
  useScorePanelView: () => [undefined, () => {}],
  useEvalScorePanelView: () => undefined,
}));

afterEach(cleanup);

describe("SampleSummaryView meta line", () => {
  it("reveals hidden characters in log-derived fields when untrusted", () => {
    const { container } = render(
      <ContentTrustProvider value="untrusted">
        <SampleSummaryView
          parent_id="sample"
          sample={testSampleSummary({ id: kDisguised, limit: kDisguised })}
          collapsed
        />
      </ContentTrustProvider>
    );
    const text = container.textContent;
    expect(text.match(/CORRECT⟨U\+202E⟩gnp\.exe/g)?.length).toBe(4);
    expect(text).not.toContain("‮");
  });
});
