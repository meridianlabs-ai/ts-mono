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
 * ResizeObserver for jsdom tests that lets the test report sizes. Register
 * per test file with `vi.stubGlobal("ResizeObserver", CapturingResizeObserver)`;
 * `CapturingResizeObserver.last` is the most recently created one.
 */
export class CapturingResizeObserver implements ResizeObserver {
  static last: CapturingResizeObserver | undefined;
  private readonly callback: ResizeObserverCallback;

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
    CapturingResizeObserver.last = this;
  }
  observe() {}
  unobserve() {}
  disconnect() {}

  /** Reports `target` at `blockSize` px tall. */
  resize(target: Element, blockSize: number) {
    const size = { blockSize, inlineSize: 100 };
    this.callback(
      [
        {
          target,
          borderBoxSize: [size],
          contentBoxSize: [size],
          devicePixelContentBoxSize: [size],
          contentRect: new DOMRectReadOnly(0, 0, 100, blockSize),
        },
      ],
      this
    );
  }
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
