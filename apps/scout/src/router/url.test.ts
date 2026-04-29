import { describe, expect, it } from "vitest";

import {
  getSidebarParam,
  getValidationParam,
  kSidebarQueryParam,
  updateSidebarParam,
  updateValidationParam,
} from "./url";

describe("sidebar param", () => {
  it("reads a recognized sidebar value", () => {
    expect(getSidebarParam(new URLSearchParams("sidebar=validation"))).toBe(
      "validation"
    );
    expect(getSidebarParam(new URLSearchParams("sidebar=search"))).toBe(
      "search"
    );
  });

  it("returns undefined for unset, empty, or unrecognized values", () => {
    expect(getSidebarParam(new URLSearchParams())).toBeUndefined();
    expect(getSidebarParam(new URLSearchParams("sidebar="))).toBeUndefined();
    expect(
      getSidebarParam(new URLSearchParams("sidebar=other"))
    ).toBeUndefined();
  });

  it("sets the sidebar param without disturbing other params", () => {
    const params = new URLSearchParams("tab=transcript-events&other=keep");
    const next = updateSidebarParam(params, "search");
    expect(next.get(kSidebarQueryParam)).toBe("search");
    expect(next.get("tab")).toBe("transcript-events");
    expect(next.get("other")).toBe("keep");
    // Original is untouched
    expect(params.has(kSidebarQueryParam)).toBe(false);
  });

  it("replaces an existing sidebar value rather than appending", () => {
    const params = new URLSearchParams("sidebar=validation");
    const next = updateSidebarParam(params, "search");
    expect(next.getAll(kSidebarQueryParam)).toEqual(["search"]);
  });
});

describe("validation param helpers", () => {
  it("opens the validation sidebar via the shared sidebar param", () => {
    const next = updateValidationParam(new URLSearchParams(), true);
    expect(next.get(kSidebarQueryParam)).toBe("validation");
    expect(getValidationParam(next)).toBe(true);
  });

  it("treats the search sidebar as not-validation", () => {
    expect(getValidationParam(new URLSearchParams("sidebar=search"))).toBe(
      false
    );
  });
});
