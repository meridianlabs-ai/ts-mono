// @vitest-environment jsdom
// @vitest-environment-options {"url": "https://eval.example.org/eval-set/abc123?token=t"}
//
// The viewer uses hash routing, so a bare route like `/logs/...?event=x` only
// works for in-app router navigation. `toFullUrl` is the `toShareUrl`
// transform handed to shared components: it wraps a route with the host
// page's origin/path/query (which, when embedded — e.g. Hawk's /eval-set/<id>
// page — is not just "/").
import { describe, expect, it } from "vitest";

import { toFullUrl } from "./url";

// Host page the viewer is embedded in, from the @vitest-environment-options
// URL above (a non-root path with a query, like Hawk's /eval-set/<id>).
const kHostPage = `${window.location.origin}${window.location.pathname}${window.location.search}`;

describe("toFullUrl", () => {
  it("prepends the host page's origin, path and query to a hash route", () => {
    const route = "/logs/dir/file.eval/samples/sample/s1/1/transcript?event=e";
    expect(toFullUrl(route)).toBe(`${kHostPage}#${route}`);
  });
});
