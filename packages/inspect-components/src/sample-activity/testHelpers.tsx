/** ResizeObserver that reports a real size synchronously on observe: the
 *  chart renders nothing at width 0, and the virtualizer computes an empty
 *  range from a zero-height scroll rect. jsdom provides neither. */
export class ImmediateResizeObserver implements ResizeObserver {
  private readonly callback: ResizeObserverCallback;
  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
  }
  observe(target: globalThis.Element) {
    const size: ResizeObserverSize = { inlineSize: 1000, blockSize: 600 };
    const rect = new DOMRectReadOnly(0, 0, 1000, 600);
    this.callback(
      [
        {
          target,
          contentRect: rect,
          borderBoxSize: [size],
          contentBoxSize: [size],
          devicePixelContentBoxSize: [size],
        },
      ],
      this
    );
  }
  unobserve() {}
  disconnect() {}
}

/** The stubbed chart width the observer above reports. */
export const kTestChartWidth = 1000;

export const kRunStart = Date.parse("2025-01-15T10:00:00.000Z") / 1000;

/** ISO timestamp `sec` seconds into the fixed run start. */
export const iso = (sec: number): string =>
  new Date((kRunStart + sec) * 1000).toISOString();
