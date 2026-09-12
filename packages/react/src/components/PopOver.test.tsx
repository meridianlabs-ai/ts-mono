// @vitest-environment jsdom
import { act, waitFor } from "@testing-library/react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

import { PopOver } from "./PopOver";

it("portals shadow-root popovers outside overflow ancestors", async () => {
  const host = document.createElement("div");
  const shadowRoot = host.attachShadow({ mode: "open" });
  const overflowContainer = document.createElement("div");
  const trigger = document.createElement("button");
  const mount = document.createElement("div");
  overflowContainer.style.overflow = "hidden";
  overflowContainer.append(trigger, mount);
  shadowRoot.append(overflowContainer);
  document.body.append(host);
  const root = createRoot(mount);

  try {
    act(() => {
      root.render(
        <PopOver
          hoverDelay={0}
          id="shadow-popover"
          isOpen
          positionEl={trigger}
          setIsOpen={vi.fn()}
          showArrow={false}
        >
          <span>Popover content</span>
        </PopOver>
      );
    });

    await waitFor(() => {
      const portal = shadowRoot.getElementById("shadow-popover");
      expect(portal).not.toBeNull();
      expect(portal?.parentNode).toBe(shadowRoot);
      expect(overflowContainer.contains(portal)).toBe(false);
      expect(portal?.textContent).toContain("Popover content");
    });
  } finally {
    act(() => root.unmount());
    host.remove();
  }
});
