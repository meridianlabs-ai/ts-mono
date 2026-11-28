// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  SentinelEvalStats,
  SentinelStats,
} from "@tsmono/inspect-common/types";

import { InMemoryStateWrapper } from "../transcript/testHelpers";

import type { NotableStep } from "./notableSteps";
import { SentinelStatsPanel } from "./SentinelStatsPanel";

afterEach(cleanup);

const renderPanel = (ui: ReactElement) =>
  render(ui, { wrapper: InMemoryStateWrapper });

const sampleStats: SentinelStats = {
  steps: {
    tool_call: { total: 4, judged: 3, unjudged: { cancelled: 1 } },
    model_output: { total: 5, judged: 5, unjudged: {} },
  },
  actions: { reject: 1, modify: 1, proceed: 6 },
  human_reviews: { total: 2, answered: 1, timed_out: 1, cancelled: 0 },
  complete: true,
};

const remoteStats: SentinelStats = {
  steps: { tool_call: { total: 2, judged: 2, unjudged: {} } },
  actions: { proceed: 2 },
  complete: true,
  remote: {
    proxy_url: "http://127.0.0.1:4000",
    version: 1,
    release: "whole",
    model_calls: 14,
    unrecorded_calls: 2,
    results_withheld: true,
  },
};

const figure = (entry: HTMLElement, label: string): string =>
  within(entry).getByText(label, { selector: "span" }).parentElement
    ?.textContent ?? "";

const part = (entry: HTMLElement, label: string): string =>
  within(entry).getByText(label, { selector: "div" }).parentElement
    ?.textContent ?? "";

describe("SentinelStatsPanel", () => {
  it("says how much a sample's sentinel checked and what it decided", () => {
    renderPanel(
      <SentinelStatsPanel kind="sample" stats={{ guard: sampleStats }} />
    );
    const entry = screen.getByRole("region", { name: "guard" });
    expect(figure(entry, "Checked")).toBe("Checked8 of 989%steps");
    expect(figure(entry, "What it decided")).toContain(
      "Stepped in on 2 of 8 · 25%"
    );
    expect(figure(entry, "What it decided")).toContain(
      "1 rejected1 modified6 proceeded"
    );
    expect(figure(entry, "Human review")).toBe(
      "Human review2questions1 answered · 1 timed out"
    );
    expect(entry.textContent).not.toContain("Incomplete");
  });

  it("breaks a sample's steps down by stage only when it checks at more than one", () => {
    renderPanel(
      <SentinelStatsPanel kind="sample" stats={{ guard: sampleStats }} />
    );
    const rows = within(screen.getByRole("table"))
      .getAllByRole("row")
      .map((row) => row.textContent);
    expect(rows).toEqual([
      "StageReachedCheckedNot checked",
      "AfterGenerate550",
      "BeforeToolCall431 cancelled",
    ]);
    cleanup();
    renderPanel(
      <SentinelStatsPanel
        kind="sample"
        stats={{
          guard: {
            ...sampleStats,
            steps: { tool_call: { total: 1, judged: 1, unjudged: {} } },
          },
        }}
      />
    );
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.getByText("BeforeToolCall")).toBeTruthy();
  });

  it("draws the in-eval sentinel's stack from the eval's config", () => {
    renderPanel(
      <SentinelStatsPanel
        kind="sample"
        stats={{ sequential: sampleStats }}
        config={{
          name: "sequential",
          version: 2,
          children: {
            scan: { name: "regex_scan" },
            judge: { name: "acme/llm_monitor" },
          },
        }}
      />
    );
    const entry = screen.getByRole("region", { name: "sequential" });
    expect(figure(entry, "Stack")).toBe(
      "Stack(top) sequential├─ scan regex_scan└─ judge acme/llm_monitor"
    );
    expect(entry.textContent).toContain("Version2");
  });

  it("shows one sentinel at a time, picked with a switch", () => {
    renderPanel(
      <SentinelStatsPanel
        kind="sample"
        stats={{ guard: sampleStats, pii: remoteStats }}
      />
    );
    expect(screen.getByRole("region", { name: "guard" })).toBeTruthy();
    expect(screen.queryByRole("region", { name: "pii" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "pii" }));
    const entry = screen.getByRole("region", { name: "pii" });
    expect(entry.textContent).toContain("remote");
    expect(figure(entry, "Recorded")).toBe(
      "Recorded12 of 1486%model calls sent through it"
    );
    expect(entry.textContent).toContain(
      "Set up outside the eval, so its checks are not in the log. It sent decisions only; check reports were withheld."
    );
    expect(entry.textContent).toContain("Proxy http://127.0.0.1:4000");
    expect(entry.textContent).toContain("Releasewhole");
  });

  it("warns that a sample's stats are incomplete, and why", () => {
    renderPanel(
      <SentinelStatsPanel
        kind="sample"
        stats={{
          guard: {
            ...sampleStats,
            complete: false,
            incomplete_reason: "The sample was cancelled.",
          },
        }}
      />
    );
    expect(screen.getByRole("alert").textContent).toBe(
      "Incomplete: The sample was cancelled."
    );
  });

  it("says a sentinel with no step counts reported calls only", () => {
    renderPanel(
      <SentinelStatsPanel
        kind="sample"
        stats={{ pii: { ...remoteStats, steps: null } }}
      />
    );
    const entry = screen.getByRole("region", { name: "pii" });
    expect(within(entry).queryByText("Checked")).toBeNull();
    expect(entry.textContent).toContain(
      "It reported model calls only, not its individual decisions."
    );
  });

  it("lists each sentinel's own notable steps, linking each to the transcript", () => {
    const steps: NotableStep[] = [
      {
        eventId: "e1",
        status: "rejected",
        subject: "bash",
        stage: "tool_call",
        reason: "uploads a key",
      },
      {
        eventId: "e2",
        status: "not checked",
        subject: "model",
        stage: "model_output",
        proxyUrl: "http://127.0.0.1:4000",
      },
    ];
    const onOpenEvent = vi.fn();
    renderPanel(
      <SentinelStatsPanel
        kind="sample"
        stats={{ guard: sampleStats, pii: remoteStats }}
        steps={steps}
        onOpenEvent={onOpenEvent}
      />
    );
    const entry = screen.getByRole("region", { name: "guard" });
    expect(part(entry, "Steps")).toBe(
      "Stepsrejectedbash · BeforeToolCalluploads a keyshow step →"
    );
    fireEvent.click(within(entry).getByRole("button", { name: "show step →" }));
    expect(onOpenEvent).toHaveBeenCalledWith("e1", expect.anything());
  });

  it("gives an eval's samples counted and left out, and its remote calls", () => {
    const evalStats: SentinelEvalStats = {
      steps: { tool_call: { total: 10, judged: 10, unjudged: {} } },
      actions: { proceed: 10 },
      samples: 4,
      incomplete_samples: 1,
      model_calls: 12,
      unrecorded_calls: 0,
    };
    renderPanel(
      <SentinelStatsPanel
        kind="eval"
        stats={{ pii: evalStats }}
        meta={[{ label: "Samples", value: "5" }]}
      />
    );
    const entry = screen.getByRole("region", { name: "pii" });
    expect(figure(entry, "Checked")).toContain(
      "4 samples · 1 left out as incomplete"
    );
    expect(figure(entry, "Recorded")).toContain("12 of 12");
    expect(screen.getByText("Samples").parentElement?.textContent).toBe(
      "Samples5"
    );
  });

  it("renders nothing without stats", () => {
    const { container } = renderPanel(
      <SentinelStatsPanel kind="sample" stats={null} />
    );
    expect(container.textContent).toBe("");
  });
});
