// @vitest-environment jsdom
import {
  cleanup,
  createEvent,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, onTestFinished, vi } from "vitest";

import { inAppHref, InAppLink, inAppLinkClick } from "./inAppLink";

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

describe("InAppLink", () => {
  const renderInAppLink = (
    href: string | undefined,
    stopPropagation = false
  ) => {
    const onNavigate = vi.fn();
    render(
      <InAppLink
        href={href}
        onNavigate={onNavigate}
        stopPropagation={stopPropagation}
      >
        Go
      </InAppLink>
    );
    return { onNavigate };
  };

  it("is a link to its href that navigates in place on a plain click", () => {
    const { onNavigate } = renderInAppLink("#/logs/a.eval");
    const link = screen.getByRole("link", { name: "Go" });
    expect(link.getAttribute("href")).toBe("#/logs/a.eval");
    expect(click(link, { button: 0 })).toBe(true);
    expect(onNavigate).toHaveBeenCalledOnce();
  });

  it("leaves cmd/ctrl-click to the browser", () => {
    const { onNavigate } = renderInAppLink("#/logs/a.eval");
    const link = screen.getByRole("link", { name: "Go" });
    expect(click(link, { button: 0, metaKey: true })).toBe(false);
    expect(click(link, { button: 0, ctrlKey: true })).toBe(false);
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it("is a button without an href", () => {
    const { onNavigate } = renderInAppLink(undefined);
    fireEvent.click(screen.getByRole("button", { name: "Go" }));
    expect(onNavigate).toHaveBeenCalledOnce();
  });

  it("is a button inside the VS Code webview", () => {
    document.body.setAttribute("data-vscode-theme-kind", "vscode-dark");
    try {
      renderInAppLink("#/logs/a.eval");
      expect(screen.getByRole("button", { name: "Go" })).toBeTruthy();
    } finally {
      document.body.removeAttribute("data-vscode-theme-kind");
    }
  });

  it("keeps clicks from reaching an ancestor when asked", () => {
    // A listener above React's root only fires if propagation isn't stopped.
    const onAncestorClick = vi.fn();
    document.addEventListener("click", onAncestorClick);
    onTestFinished(() =>
      document.removeEventListener("click", onAncestorClick)
    );
    renderInAppLink("#/logs/a.eval", true);
    const link = screen.getByRole("link", { name: "Go" });
    click(link, { button: 0 });
    click(link, { button: 0, metaKey: true });
    expect(onAncestorClick).not.toHaveBeenCalled();
  });
});
