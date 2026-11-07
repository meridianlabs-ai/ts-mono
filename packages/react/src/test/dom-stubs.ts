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
