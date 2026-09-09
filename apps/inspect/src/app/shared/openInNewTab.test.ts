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
        `${window.location.pathname}#/logs/example.eval`,
        "_blank",
        "noopener,noreferrer"
      );
      expect(blur).toHaveBeenCalledOnce();
      expect(focus).toHaveBeenCalledOnce();
    }
  );
});
