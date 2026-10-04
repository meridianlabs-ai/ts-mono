// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

import { openInNewTab } from "./openInNewTab";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("openInNewTab", () => {
  it.each(["/logs/example.eval", "#/logs/example.eval"])(
    "opens %s without granting opener access",
    (route) => {
      // Return the real jsdom window as the popup so no cast is needed; the
      // spied `blur` is the popup's, the spied `focus` the opener's.
      const blur = vi.spyOn(window, "blur").mockImplementation(() => {});
      const open = vi.spyOn(window, "open").mockReturnValue(window);
      const focus = vi.spyOn(window, "focus").mockImplementation(() => {});

      openInNewTab(route);

      expect(open).toHaveBeenCalledWith(
        `${window.location.origin}${window.location.pathname}#/logs/example.eval`,
        "_blank",
        "noopener,noreferrer"
      );
      expect(blur).toHaveBeenCalledOnce();
      expect(focus).toHaveBeenCalledOnce();
    }
  );

  it("keeps the host page's path and query (e.g. ?log_dir=)", () => {
    const initial = window.location.href;
    window.history.replaceState(
      null,
      "",
      "/viewer?log_dir=s3%3A%2F%2Fb%2Flogs"
    );
    try {
      vi.spyOn(window, "focus").mockImplementation(() => {});
      const open = vi.spyOn(window, "open").mockReturnValue(null);

      openInNewTab("/logs/example.eval");

      expect(open).toHaveBeenCalledWith(
        `${window.location.origin}/viewer?log_dir=s3%3A%2F%2Fb%2Flogs#/logs/example.eval`,
        "_blank",
        "noopener,noreferrer"
      );
    } finally {
      window.history.replaceState(null, "", initial);
    }
  });
});
