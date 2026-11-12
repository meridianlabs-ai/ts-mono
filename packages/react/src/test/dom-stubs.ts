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
