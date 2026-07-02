import { describe, expect, it } from "vitest";

import { EvalSample } from "@tsmono/inspect-common/types";
import { AsyncData, data, loading } from "@tsmono/util";

import { SampleHandle } from "../app/types";
import { SampleSummary } from "../client/api/types";
import { SampleNotFoundError } from "../log_data";

import { sampleQueryKey, withErrorSummaryFallback } from "./sampleQuery";

const makeSummary = (overrides: Partial<SampleSummary> = {}): SampleSummary =>
  ({
    id: "s1",
    epoch: 1,
    input: "input",
    target: "target",
    ...overrides,
  }) as SampleSummary;

const makeSample = (): EvalSample =>
  ({ id: "s1", epoch: 1, events: [], messages: [] }) as unknown as EvalSample;

const notFound = (): AsyncData<EvalSample> => ({
  loading: false,
  error: new SampleNotFoundError("log.eval", "s1", 1),
});

describe("withErrorSummaryFallback", () => {
  it("synthesizes an errored sample when the body is missing and the summary records an error", () => {
    const result = withErrorSummaryFallback(
      notFound(),
      makeSummary({ error: "boom" })
    );
    expect(result.loading).toBe(false);
    expect(result.error).toBeUndefined();
    expect(result.data?.id).toBe("s1");
    expect(result.data?.epoch).toBe(1);
    expect(result.data?.error?.message).toBe("boom");
  });

  it.each([
    {
      name: "missing body without a summary error stays an error",
      result: notFound(),
      summary: makeSummary(),
    },
    {
      name: "missing body without a summary stays an error",
      result: notFound(),
      summary: undefined,
    },
  ])("$name", ({ result, summary }) => {
    const out = withErrorSummaryFallback(result, summary);
    expect(out.error).toBeInstanceOf(SampleNotFoundError);
    expect(out.data).toBeUndefined();
  });

  it("passes non-miss errors through even when the summary has an error", () => {
    const failure: AsyncData<EvalSample> = {
      loading: false,
      error: new Error("network down"),
    };
    const out = withErrorSummaryFallback(
      failure,
      makeSummary({ error: "boom" })
    );
    expect(out.error?.message).toBe("network down");
  });

  it("passes loading and settled data through untouched", () => {
    const summary = makeSummary({ error: "boom" });
    expect(withErrorSummaryFallback(loading, summary)).toBe(loading);
    const settled = data(makeSample());
    expect(withErrorSummaryFallback(settled, summary)).toBe(settled);
  });
});

describe("sampleQueryKey", () => {
  it("keys on dir, file, id and epoch", () => {
    const handle: SampleHandle = { id: 7, epoch: 2, logFile: "log.eval" };
    expect(sampleQueryKey("dir", handle)).toEqual([
      "sample",
      "dir",
      "log.eval",
      7,
      2,
    ]);
  });

  it("parks idle observers on a null slot per dir", () => {
    expect(sampleQueryKey("dir", undefined)).toEqual([
      "sample",
      "dir",
      null,
      null,
      null,
    ]);
  });
});
