// @vitest-environment jsdom
import {
  cleanup,
  createEvent,
  fireEvent,
  render,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ComponentStateProvider } from "../state/ComponentStateContext";
import { makeStateHooks } from "../test";

import { ComponentNavigationProvider } from "./ComponentNavigationContext";
import { MarkdownDivWithReferences } from "./MarkdownDivWithReferences";

afterEach(cleanup);

const renderRefs = async (previewRefsOnHover?: boolean) => {
  const navigate = vi.fn();
  const { container } = render(
    <ComponentStateProvider hooks={makeStateHooks()}>
      <ComponentNavigationProvider navigation={{ navigate }}>
        <MarkdownDivWithReferences
          markdown="See [M1] and [M2]."
          options={{ previewRefsOnHover }}
          references={[
            { id: "m1", cite: "[M1]", citeUrl: "#/logs/a.eval?message=m1" },
            { id: "m2", cite: "[M2]" },
          ]}
        />
      </ComponentNavigationProvider>
    </ComponentStateProvider>
  );
  const link = await waitFor(() => {
    const el = container.querySelector<HTMLElement>('[data-ref-id="m1"]');
    if (!el) throw new Error("references not rendered yet");
    return el;
  });
  return { container, link, navigate };
};

// Whether the browser would still follow the link after the handler ran.
const click = (el: HTMLElement, init: MouseEventInit) => {
  const event = createEvent.click(el, init);
  fireEvent(el, event);
  return event.defaultPrevented;
};

// With hover previews off, the component's React click handler routes
// reference links in-app; with them on (the default), a native listener stops
// propagation first and the link behaves natively.
describe("MarkdownDivWithReferences reference links", () => {
  it("navigates in-app on a plain click", async () => {
    const { link, navigate } = await renderRefs(false);
    expect(click(link, { button: 0 })).toBe(true);
    expect(navigate).toHaveBeenCalledWith("/logs/a.eval?message=m1", {
      replace: true,
    });
  });

  it.each([false, undefined])(
    "leaves cmd/ctrl-click to the browser (previewRefsOnHover: %s)",
    async (previewRefsOnHover) => {
      const { link, navigate } = await renderRefs(previewRefsOnHover);
      expect(click(link, { button: 0, metaKey: true })).toBe(false);
      expect(click(link, { button: 0, ctrlKey: true })).toBe(false);
      expect(navigate).not.toHaveBeenCalled();
    }
  );

  it("renders a reference without a URL as text, not a link", async () => {
    const { container, link } = await renderRefs();
    expect(link.tagName).toBe("A");
    const plain = container.querySelector('[data-ref-id="m2"]');
    expect(plain?.tagName).toBe("SPAN");
    expect(plain?.className).toBe(link.className);
  });
});
