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
 * IntersectionObserver for jsdom tests that records what it observes and lets
 * the test report targets as intersecting. Register per test file with
 * `vi.stubGlobal("IntersectionObserver", CapturingIntersectionObserver)`;
 * `CapturingIntersectionObserver.last` is the most recently created one.
 */
export class CapturingIntersectionObserver implements IntersectionObserver {
  static last: CapturingIntersectionObserver | undefined;
  readonly root = null;
  readonly rootMargin = "";
  readonly scrollMargin = "";
  readonly thresholds = [];
  readonly observed = new Set<Element>();
  private readonly callback: IntersectionObserverCallback;

  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback;
    CapturingIntersectionObserver.last = this;
  }
  observe(target: Element) {
    this.observed.add(target);
  }
  unobserve(target: Element) {
    this.observed.delete(target);
  }
  disconnect() {
    this.observed.clear();
  }
  takeRecords() {
    return [];
  }

  /** Reports `target` as intersecting the root. */
  intersect(target: Element) {
    this.callback(
      [
        {
          target,
          isIntersecting: true,
          intersectionRatio: 1,
          boundingClientRect: new DOMRectReadOnly(),
          intersectionRect: new DOMRectReadOnly(),
          rootBounds: null,
          time: 0,
        },
      ],
      this
    );
  }
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
