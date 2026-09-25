// @vitest-environment jsdom
import {
  cleanup,
  createEvent,
  fireEvent,
  render,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { inAppHref, inAppLinkClick } from "./inAppLink";

afterEach(cleanup);

const renderLink = () => {
  const navigate = vi.fn();
  const { getByRole } = render(
    <a href="#/logs/a.eval" onClick={inAppLinkClick(navigate)}>
      a
    </a>
  );
  return { link: getByRole("link"), navigate };
};

// Whether the browser would still follow the link after our handler ran.
const click = (link: HTMLElement, init: MouseEventInit) => {
  const event = createEvent.click(link, init);
  fireEvent(link, event);
  return event.defaultPrevented;
};

describe("inAppLinkClick", () => {
  it("navigates in place on a plain click", () => {
    const { link, navigate } = renderLink();
    expect(click(link, { button: 0 })).toBe(true);
    expect(navigate).toHaveBeenCalledOnce();
  });

  it("treats alt-click as a plain click rather than a download", () => {
    const { link, navigate } = renderLink();
    expect(click(link, { button: 0, altKey: true })).toBe(true);
    expect(navigate).toHaveBeenCalledOnce();
  });

  it.each(["metaKey", "ctrlKey", "shiftKey"] as const)(
    "leaves %s-click to the browser",
    (modifier) => {
      const { link, navigate } = renderLink();
      expect(click(link, { button: 0, [modifier]: true })).toBe(false);
      expect(navigate).not.toHaveBeenCalled();
    }
  );
});

describe("inAppHref", () => {
  it("passes the href through in a browser", () => {
    expect(inAppHref("#/logs/a.eval")).toBe("#/logs/a.eval");
    expect(inAppHref(undefined)).toBeUndefined();
  });

  it("drops the href inside the VS Code webview", () => {
    document.body.setAttribute("data-vscode-theme-kind", "vscode-dark");
    try {
      expect(inAppHref("#/logs/a.eval")).toBeUndefined();
    } finally {
      document.body.removeAttribute("data-vscode-theme-kind");
    }
  });
});
