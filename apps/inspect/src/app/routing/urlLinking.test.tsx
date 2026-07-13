// @vitest-environment jsdom
// @vitest-environment-options {"url": "https://eval.example.org/eval-set/abc123?token=t"}
//
// Regression tests for shareable copy-link URLs. The viewer uses hash
// routing, so a bare route like `/logs/...?event=x` only works for in-app
// router navigation; anything surfaced to the user as a copyable link must
// be wrapped with `toFullUrl` to include the host page's origin/path/query
// (which, when embedded — e.g. Hawk's /eval-set/<id> page — is not just "/").
import { renderHook } from "@testing-library/react";
import { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { toFullUrl, useFullSampleMessageUrlBuilder } from "./url";

// Must match the @vitest-environment-options url above.
const kHostPage = "https://eval.example.org/eval-set/abc123?token=t";

const wrapperAt = (route: string) => {
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <MemoryRouter initialEntries={[route]}>{children}</MemoryRouter>
  );
  return Wrapper;
};

describe("toFullUrl", () => {
  it("prepends the host page's origin, path and query to a hash route", () => {
    const route = "/logs/dir/file.eval/samples/sample/s1/1/transcript?event=e";
    expect(toFullUrl(route)).toBe(`${kHostPage}#${route}`);
  });
});

describe("useFullSampleMessageUrlBuilder", () => {
  it("builds an absolute shareable URL, not a bare hash route", () => {
    const route = "/logs/dir/file.eval/samples/sample/s1/1/messages";
    const { result } = renderHook(() => useFullSampleMessageUrlBuilder(), {
      wrapper: wrapperAt(route),
    });

    expect(result.current("msg-1")).toBe(`${kHostPage}#${route}?message=msg-1`);
  });

  it("returns undefined when the route has no log path", () => {
    const { result } = renderHook(() => useFullSampleMessageUrlBuilder(), {
      wrapper: wrapperAt("/"),
    });

    expect(result.current("msg-1")).toBeUndefined();
  });
});
