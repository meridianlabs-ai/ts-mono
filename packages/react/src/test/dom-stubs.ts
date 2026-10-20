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
