import { describe, expect, it } from "vitest";

import {
  getSearchParam,
  getValidationParam,
  kSearchQueryParam,
  kValidationQueryParam,
  transcriptRoute,
  updateSearchParam,
  updateValidationParam,
} from "./url";

describe("validation param helpers", () => {
  it("opens the validation sidebar with validation=1", () => {
    const params = new URLSearchParams(
      "sidebar=search&tab=transcript-events&other=keep"
    );
    const next = updateValidationParam(params, true);
    expect(next.get(kValidationQueryParam)).toBe("1");
    expect(next.has("sidebar")).toBe(false);
    expect(getValidationParam(next)).toBe(true);
    expect(next.get("tab")).toBe("transcript-events");
    expect(next.get("other")).toBe("keep");
    expect(params.has(kValidationQueryParam)).toBe(false);
  });

  it("closes the validation sidebar without disturbing search", () => {
    const params = new URLSearchParams("validation=1&search=1");
    const next = updateValidationParam(params, false);
    expect(next.has(kValidationQueryParam)).toBe(false);
    expect(next.get(kSearchQueryParam)).toBe("1");
    expect(getValidationParam(next)).toBe(false);
  });

  it("does not treat the search sidebar as validation", () => {
    expect(getValidationParam(new URLSearchParams("search=1"))).toBe(false);
  });

  it("uses validation=1 when linking to a validation set", () => {
    const route = transcriptRoute(
      "transcripts",
      "sample-1",
      new URLSearchParams("search=1&sidebar=validation"),
      "/tmp/cases.csv"
    );
    expect(route).toBe(
      "/transcripts/dHJhbnNjcmlwdHM/sample-1?search=1&validation=1&validationSet=L3RtcC9jYXNlcy5jc3Y"
    );
  });
});

describe("search param helpers", () => {
  it("opens the search sidebar with search=1", () => {
    const params = new URLSearchParams(
      "sidebar=validation&tab=transcript-events&other=keep"
    );
    const next = updateSearchParam(params, true);
    expect(next.get(kSearchQueryParam)).toBe("1");
    expect(next.has("sidebar")).toBe(false);
    expect(getSearchParam(next)).toBe(true);
    expect(next.get("tab")).toBe("transcript-events");
    expect(next.get("other")).toBe("keep");
    expect(params.has(kSearchQueryParam)).toBe(false);
  });

  it("closes the search sidebar without disturbing validation", () => {
    const params = new URLSearchParams("validation=1&search=1");
    const next = updateSearchParam(params, false);
    expect(next.has(kSearchQueryParam)).toBe(false);
    expect(next.get(kValidationQueryParam)).toBe("1");
    expect(getSearchParam(next)).toBe(false);
  });
});
