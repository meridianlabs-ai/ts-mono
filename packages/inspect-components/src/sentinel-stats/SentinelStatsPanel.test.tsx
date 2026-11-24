// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type {
  SentinelEvalStats,
  SentinelStats,
} from "@tsmono/inspect-common/types";

import { SentinelStatsPanel } from "./SentinelStatsPanel";

afterEach(cleanup);

const sampleStats: SentinelStats = {
  steps: {
    tool_call: { total: 4, judged: 3, unjudged: { cancelled: 1 } },
    model_output: { total: 5, judged: 5, unjudged: {} },
  },
  actions: { reject: 1, proceed: 6 },
  human_reviews: { total: 2, answered: 1, timed_out: 1, cancelled: 0 },
  complete: true,
};

describe("SentinelStatsPanel", () => {
  it("shows a sample's steps by stage, its decisions and its questions", () => {
    render(<SentinelStatsPanel stats={{ guard: sampleStats }} />);
    const entry = screen.getByRole("region", { name: "guard" });
    const rows = within(entry)
      .getAllByRole("row")
      .map((row) => row.textContent);
    expect(rows).toEqual([
      "StageReachedJudgedNot judged",
      "model output550",
      "before call431 (cancelled 1)",
    ]);
    expect(entry.textContent).toContain("proceed 6 · reject 1");
    expect(entry.textContent).toContain(
      "2 questions · 1 answered · 1 timed out · 0 cancelled"
    );
    expect(entry.textContent).not.toContain("Incomplete");
    expect(entry.textContent).not.toContain("Remote");
  });

  it("says why a remote sentinel's stats are incomplete, and what it saw", () => {
    render(
      <SentinelStatsPanel
        stats={{
          "http://127.0.0.1:4000": {
            steps: null,
            complete: false,
            incomplete_reason: "cancelled",
            remote: {
              proxy_url: "http://127.0.0.1:4000",
              version: 1,
              release: "whole",
              model_calls: 3,
              unrecorded_calls: 1,
              results_withheld: true,
            },
          },
        }}
      />
    );
    const entry = screen.getByRole("region", {
      name: "http://127.0.0.1:4000",
    });
    expect(entry.textContent).toContain("Incomplete: cancelled");
    expect(entry.textContent).toContain("No step counts.");
    expect(entry.textContent).toContain(
      "3 model calls · 1 unrecorded by the remote sentinel · results withheld from the eval"
    );
    expect(within(entry).queryByRole("table")).toBeNull();
  });

  it.each([
    [false, /results sent to the eval/],
    [undefined, /results withheld: not reported/],
  ])(
    "says whether a remote sentinel withheld results when it reports %s",
    (withheld, text) => {
      render(
        <SentinelStatsPanel
          stats={{
            guard: {
              ...sampleStats,
              remote: {
                proxy_url: "http://127.0.0.1:4000",
                version: 1,
                release: "whole",
                model_calls: 1,
                unrecorded_calls: 0,
                results_withheld: withheld,
              },
            },
          }}
        />
      );
      expect(screen.getByText(text)).toBeTruthy();
    }
  );

  it("gives an eval's count of samples, how many it left out, and its remote calls", () => {
    const evalStats: SentinelEvalStats = {
      steps: sampleStats.steps,
      actions: sampleStats.actions,
      human_reviews: sampleStats.human_reviews,
      model_calls: 12,
      unrecorded_calls: 2,
      samples: 9,
      incomplete_samples: 1,
    };
    render(<SentinelStatsPanel stats={{ guard: evalStats }} />);
    const entry = screen.getByRole("region", { name: "guard" });
    expect(entry.textContent).toContain(
      "9 samples counted · 1 left out as incomplete"
    );
    expect(entry.textContent).toContain(
      "12 model calls · 2 unrecorded by the remote sentinel"
    );
    expect(entry.textContent).not.toContain("Incomplete");
  });

  it("renders nothing without stats", () => {
    const { container } = render(<SentinelStatsPanel stats={null} />);
    expect(container.textContent).toBe("");
  });
});
