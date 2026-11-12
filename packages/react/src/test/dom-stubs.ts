/**
 * Minimal ResizeObserver for jsdom tests (which lack the API). Register per
 * test file with `vi.stubGlobal("ResizeObserver", ResizeObserverStub)`.
 */
export class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

/**
 * The CSS Custom Highlight API and Range geometry for jsdom tests, which lack
 * both. Call in `beforeEach`; `vi.unstubAllGlobals()` undoes the globals.
 * Every range reports the same box at the top of the viewport.
 */
export function stubFindHighlightApi(
  stubGlobal: (name: string, value: unknown) => void
): Map<string, Set<AbstractRange>> {
  const registry = new Map<string, Set<AbstractRange>>();
  stubGlobal("Highlight", class extends Set<AbstractRange> {});
  stubGlobal("CSS", { ...globalThis.CSS, highlights: registry });
  const box = () => new DOMRect(0, 0, 10, 10);
  Range.prototype.getBoundingClientRect = box;
  Range.prototype.getClientRects = () => {
    const rects: DOMRectList = Object.assign([box()], {
      item: (index: number) => (index === 0 ? box() : null),
    });
    return rects;
  };
  return registry;
}

/**
 * jsdom has no Popover API. Installs `showPopover`/`hidePopover`/
 * `togglePopover` stand-ins so components that open popovers can mount in
 * jsdom tests. They only set inline `display`: jsdom never matches
 * `:popover-open` (jsdom/jsdom#3721), so its UA sheet hides every
 * `[popover]`. Nothing else is simulated (top layer, light dismiss, Escape,
 * toggle events): cover those in Playwright. Call from a test setup file; it
 * does nothing outside jsdom or where the API exists.
 */
export const installPopoverStub = (): void => {
  if (
    typeof HTMLElement === "undefined" ||
    "showPopover" in HTMLElement.prototype
  ) {
    return;
  }
  Object.assign(HTMLElement.prototype, {
    showPopover(this: HTMLElement) {
      this.style.display = "block";
    },
    hidePopover(this: HTMLElement) {
      this.style.removeProperty("display");
    },
    togglePopover(this: HTMLElement) {
      const open = this.style.display !== "block";
      this.style.display = open ? "block" : "";
      return open;
    },
  });
};

/**
 * jsdom has no `showModal`/`close` on `<dialog>`. Installs stand-ins that
 * only toggle the `open` attribute (which jsdom's UA sheet shows), so modals
 * can mount in jsdom tests. Nothing else is simulated (top layer, inertness,
 * Escape, focus): cover those in Playwright. Call from a test setup file; it
 * does nothing outside jsdom or where the API exists.
 */
export const installDialogStub = (): void => {
  if (
    typeof HTMLDialogElement === "undefined" ||
    "showModal" in HTMLDialogElement.prototype
  ) {
    return;
  }
  Object.assign(HTMLDialogElement.prototype, {
    showModal(this: HTMLDialogElement) {
      this.setAttribute("open", "");
    },
    close(this: HTMLDialogElement) {
      this.removeAttribute("open");
    },
  });
};
