// @vitest-environment jsdom
import { act, render, screen, waitFor } from "@testing-library/react";
import { FC, StrictMode, useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useMountEffect } from "../hooks/useMountEffect";
import {
  VirtualScrollerContext,
  type VirtualScroller,
} from "../virtual/VirtualScrollerContext";

import {
  FindProvider,
  useFindCoordinatorOptional,
} from "./FindCoordinatorContext";
import type { FindCoordinator, FindRow, FindSource } from "./types";
import { useFindHighlights } from "./useFindHighlights";

// ---- CSS Custom Highlight API stub (jsdom has neither CSS.highlights nor
// Highlight). Stubbed at the global boundary, per repo testing rules. ----

class HighlightStub extends Set<Range> {
  adds = 0;
  add(range: Range) {
    this.adds++;
    return super.add(range);
  }
  get ranges(): Range[] {
    return [...this];
  }
}

let highlightMap: Map<string, HighlightStub>;

function stubHighlightApi() {
  highlightMap = new Map();
  vi.stubGlobal("CSS", { highlights: highlightMap });
  vi.stubGlobal("Highlight", HighlightStub);
}

/** Every painted range — find-match plus the active one, which find-active
 *  alone paints — in document order. */
const painted = (): Range[] =>
  [
    ...(highlightMap.get("find-match")?.ranges ?? []),
    ...(highlightMap.get("find-active")?.ranges ?? []),
  ].sort((a, b) => a.compareBoundaryPoints(Range.START_TO_START, b));

// jsdom has no ResizeObserver; tests fire the recorded observers by hand.
const resizeObservers = new Set<RecordingResizeObserver>();
class RecordingResizeObserver implements ResizeObserver {
  constructor(private cb: ResizeObserverCallback) {
    resizeObservers.add(this);
  }
  fire() {
    this.cb([], this);
  }
  observe() {}
  unobserve() {}
  disconnect() {
    resizeObservers.delete(this);
  }
}
const resizeRows = () =>
  act(() => {
    for (const observer of resizeObservers) observer.fire();
  });

// jsdom has no layout: Range.getClientRects is missing entirely, and
// elementFromPoint has nothing to hit; by default it reports the row's own
// text (nothing covers the match).
beforeEach(() => {
  resizeObservers.clear();
  vi.stubGlobal("ResizeObserver", RecordingResizeObserver);
  Range.prototype.getClientRects = () =>
    Object.assign([] as DOMRect[], { item: () => null });
  document.elementFromPoint = () => screen.queryByTestId("row-e1");
});

/** A virtual scroller over a fake layout: the range's box is `boxHeight` tall
 *  at content offset `rangeTop`, the viewport starts at content offset
 *  `scrollTop`, and scrolling moves the box (clamped at `maxScrollTop`, as a
 *  list whose later rows sit at estimated sizes clamps). */
function fakeScroller(opts: {
  rangeTop: number;
  viewportHeight?: number;
  scrollTop?: number;
  maxScrollTop?: number;
  /** A range starting at a line wrap reports an empty box first. */
  leadingEmptyRect?: boolean;
  /** How far the list's own compensation moves the viewport between our
   *  scroll and its settle callback. */
  settleShift?: number;
}) {
  const viewportHeight = opts.viewportHeight ?? 600;
  const state = {
    scrollTop: opts.scrollTop ?? 1000,
    maxScrollTop: opts.maxScrollTop ?? Infinity,
    /** False while the row is unmeasured / not laid out. */
    boxed: true,
  };
  // The shift models the list's compensation for rows measured after the
  // first jump: it happens once, before the scroll is reported settled.
  let settleShift = opts.settleShift ?? 0;
  /** Content offsets the row asked to centre, in order. */
  const targets: number[] = [];
  const centreInRow = vi.fn(
    (_node: Element, box: DOMRect, onDone?: () => void) => {
      const offset =
        box.top + state.scrollTop - (viewportHeight - box.height) / 2;
      targets.push(offset);
      state.scrollTop = Math.max(0, Math.min(offset, state.maxScrollTop));
      state.scrollTop += settleShift;
      settleShift = 0;
      onDone?.();
      return true;
    }
  );
  const listeners = new Set<(node: Element) => void>();
  Range.prototype.getClientRects = () => {
    const rects: DOMRect[] = [];
    if (opts.leadingEmptyRect) rects.push(new DOMRect(0, 0, 0, 0));
    if (state.boxed) {
      rects.push(new DOMRect(0, opts.rangeTop - state.scrollTop, 10, 10));
    }
    return Object.assign(rects, { item: () => null });
  };
  const scroller: VirtualScroller = {
    viewportRect: () => new DOMRect(0, 0, 800, viewportHeight),
    // The row lands at the viewport top (row start 0 in this fixture).
    scrollToRow: (_node, onDone) => {
      state.scrollTop = 0;
      onDone?.();
      return true;
    },
    centreInRow,
    onRowMeasured: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  /** The list measured the row (post-commit). */
  const measure = () =>
    act(() => {
      for (const l of listeners) l(screen.getByTestId("row-e1"));
    });
  return { scroller, centreInRow, targets, state, measure };
}

/** Content offset that centres a 10px box at `rangeTop` in the viewport. */
const centred = (rangeTop: number, viewportHeight = 600) =>
  rangeTop - (viewportHeight - 10) / 2;

// ---- Harness -------------------------------------------------------------

const flush = () => act(() => new Promise((resolve) => setTimeout(resolve, 0)));

function occurrencesSource(
  anchorId: string,
  count = 2,
  text = "needle"
): FindSource {
  return rowsSource([
    { anchor: { id: anchorId }, index: 0, count, texts: [text] },
  ]);
}

function rowsSource(rows: FindRow[]): FindSource {
  return {
    find: () => Promise.resolve({ rows, atEnd: true, complete: true }),
  };
}

const Row: FC<{ anchorId: string; children: React.ReactNode }> = ({
  anchorId,
  children,
}) => {
  const ref = useRef<HTMLDivElement>(null);
  useFindHighlights(ref, anchorId);
  return (
    <div data-testid={`row-${anchorId}`} ref={ref}>
      {children}
    </div>
  );
};

function renderRows(children: React.ReactNode) {
  const captured: { coordinator?: FindCoordinator } = {};
  const Probe = () => {
    const coordinator = useFindCoordinatorOptional();
    useMountEffect(() => {
      captured.coordinator = coordinator ?? undefined;
    });
    return null;
  };
  render(
    <FindProvider>
      <Probe />
      {children}
    </FindProvider>
  );
  const coordinator = captured.coordinator;
  if (!coordinator) throw new Error("coordinator not mounted");
  return coordinator;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

// ---- Offset mapping over split text nodes ---------------------------------

describe("useFindHighlights range mapping", () => {
  beforeEach(stubHighlightApi);

  /** Highlight `html` given the source matched `texts` in the row (source
   *  count `count`); returns the painted ranges, the active range and the
   *  coordinator. */
  async function highlight(html: string, texts: string | string[], count = 1) {
    const coordinator = renderRows(
      <Row anchorId="e1">
        <span dangerouslySetInnerHTML={{ __html: html }} />
      </Row>
    );
    act(() => {
      coordinator.registerSurface({
        scopeId: "test",
        source: rowsSource([
          {
            anchor: { id: "e1" },
            index: 0,
            count,
            texts: typeof texts === "string" ? [texts] : texts,
          },
        ]),
        reveal: () => {},
      });
      coordinator.setTerm("typed");
    });
    await flush();
    return {
      root: screen.getByTestId("row-e1").firstElementChild!,
      ranges: painted(),
      active: highlightMap.get("find-active")?.ranges[0] ?? null,
      coordinator,
    };
  }

  it("builds ranges that span element boundaries", async () => {
    // "needle" split across an element boundary: "nee" + <b>"dle"</b>
    const { root, ranges } = await highlight("nee<b>dle here</b>", "needle");
    expect(ranges).toHaveLength(1);
    const range = ranges[0]!;
    expect(range.startContainer).toBe(root.firstChild);
    expect(range.startOffset).toBe(0);
    expect(range.endContainer).toBe(root.querySelector("b")!.firstChild);
    expect(range.endOffset).toBe(3);
    expect(range.toString()).toBe("needle");
  });

  it("scans the plain concatenation of searchable text, skipping the chrome", async () => {
    const { ranges } = await highlight(
      '<span>needle</span><span>nee</span><span data-find-chrome="true">needle</span><span>dle</span>',
      "needle"
    );
    expect(ranges).toHaveLength(2);
    // The second occurrence bridges the skipped chrome, as the projection's
    // "needle" does.
    expect(ranges[1]?.startContainer.textContent).toBe("nee");
    expect(ranges[1]?.endContainer.textContent).toBe("dle");
  });

  it("highlights every DOM occurrence of the texts the source matched, exactly", async () => {
    const { ranges } = await highlight("Needle and NEEDLE and needle", [
      "Needle",
      "needle",
    ]);
    expect(ranges.map((r) => r.toString())).toEqual(["Needle", "needle"]);
  });

  it("matches a quoted text literally, not its bare word", async () => {
    const { ranges } = await highlight('say "hi" and say hi', '"hi"');
    expect(ranges).toHaveLength(1);
    expect(ranges[0]!.toString()).toBe('"hi"');
  });

  it("treats regex syntax in a text literally", async () => {
    const { ranges } = await highlight("a.b axb (a.b)", "a.b");
    expect(ranges.map((r) => r.toString())).toEqual(["a.b", "a.b"]);
  });

  it("highlights the variants a folding source returns where the DOM text differs from the typed term", async () => {
    // Typed "istanbul" / "strasse" / "cafe": the source matched these forms.
    const { ranges } = await highlight(
      "İstanbul istanbul ISTANBUL; straße strasse; café cafe",
      ["İstanbul", "istanbul", "ISTANBUL", "straße", "strasse", "café", "cafe"]
    );
    expect(ranges.map((r) => r.toString())).toEqual([
      "İstanbul",
      "istanbul",
      "ISTANBUL",
      "straße",
      "strasse",
      "café",
      "cafe",
    ]);
  });

  it("keeps a variant containing NUL intact", async () => {
    // As a text node: the HTML parser would replace NUL.
    const coordinator = renderRows(<Row anchorId="e1">{"a\0b a b"}</Row>);
    act(() => {
      coordinator.registerSurface({
        scopeId: "test",
        source: rowsSource([
          {
            anchor: { id: "e1" },
            index: 0,
            count: 1,
            texts: ["a\0b"],
          },
        ]),
        reveal: () => {},
      });
      coordinator.setTerm("typed");
    });
    await flush();
    expect(painted().map((r) => r.toString())).toEqual(["a\0b"]);
  });

  it("prefers the longest variant where one is a prefix of another", async () => {
    // Decomposed é: "e" + combining acute.
    const { ranges } = await highlight("e\u0301", ["e", "e\u0301"]);
    expect(ranges.map((r) => r.toString())).toEqual(["e\u0301"]);
  });

  it("paints up to the cap but steps through every DOM match; N stops at the source count", async () => {
    const { ranges, coordinator } = await highlight(
      "needle ".repeat(1001),
      "needle",
      3
    );
    expect(ranges).toHaveLength(1000);
    // The source counted 3; the DOM has 1001, so a fourth step stays in the
    // row (a source-count step would have wrapped) while N stops at 3.
    for (let i = 0; i < 3; i++) act(() => coordinator.next());
    await flush();
    expect(coordinator.getState()).toMatchObject({
      activeOccurrence: 3,
      activeOrdinal: 2,
    });
    expect(highlightMap.get("find-active")?.ranges[0]?.startOffset).toBe(
      3 * "needle ".length
    );
  });

  it("steps through the DOM matches, not the source estimate", async () => {
    const { ranges, coordinator } = await highlight(
      "needle and Needle",
      ["needle", "Needle"],
      5
    );
    expect(ranges).toHaveLength(2);
    act(() => coordinator.next());
    expect(coordinator.getState()).toMatchObject({
      activeOccurrence: 1,
      activeOrdinal: 1,
    });
    act(() => coordinator.next()); // past the two DOM matches: wraps
    expect(coordinator.getState()).toMatchObject({
      activeOccurrence: 0,
      activeOrdinal: 0,
    });
  });
});

// ---- The hook: registry contributions + flash fallback ---------------------

describe("useFindHighlights", () => {
  it("registers match ranges and the active occurrence with the registry", async () => {
    stubHighlightApi();
    const coordinator = renderRows(
      <Row anchorId="e1">needle one needle two</Row>
    );
    act(() => {
      coordinator.registerSurface({
        scopeId: "test",
        source: occurrencesSource("e1"),
        reveal: () => {},
      });
      coordinator.setTerm("needle");
    });
    await flush();

    // The active occurrence is painted by find-active alone; the two
    // highlights never share a range.
    const matchHighlight = highlightMap.get("find-match");
    expect(matchHighlight?.ranges.map((r) => r.startOffset)).toEqual([11]);
    const activeHighlight = highlightMap.get("find-active");
    expect(activeHighlight?.ranges).toHaveLength(1);
    // Survey activated occurrence 0 — the first rendered occurrence.
    expect(activeHighlight?.ranges[0]?.toString()).toBe("needle");
    expect(activeHighlight?.ranges[0]?.startOffset).toBe(0);
  });

  it("moves the active highlight when stepping", async () => {
    stubHighlightApi();
    const coordinator = renderRows(<Row anchorId="e1">needle x needle</Row>);
    act(() => {
      coordinator.registerSurface({
        scopeId: "test",
        source: occurrencesSource("e1"),
        reveal: () => {},
      });
      coordinator.setTerm("needle");
    });
    await flush();

    act(() => coordinator.next());
    await flush();

    const activeHighlight = highlightMap.get("find-active");
    expect(activeHighlight?.ranges).toHaveLength(1);
    expect(activeHighlight?.ranges[0]?.startOffset).toBe(9);
  });

  it("centres the active occurrence through the enclosing virtual scroller, once", async () => {
    stubHighlightApi();
    const { scroller, centreInRow, targets } = fakeScroller({
      rangeTop: 6000,
    });
    const coordinator = renderRows(
      <VirtualScrollerContext.Provider value={scroller}>
        <Row anchorId="e1">needle</Row>
      </VirtualScrollerContext.Provider>
    );
    act(() => {
      coordinator.registerSurface({
        scopeId: "test",
        source: occurrencesSource("e1", 1),
        reveal: () => {},
      });
      coordinator.setTerm("needle");
    });
    await flush();
    expect(highlightMap.get("find-active")?.ranges).toHaveLength(1);
    // Content offset of the range top (6000) less half the free viewport.
    expect(centreInRow).toHaveBeenCalledTimes(1);
    expect(targets).toContain(centred(6000));

    // A DOM mutation re-applies the highlights without scrolling again.
    act(() => {
      screen.getByTestId("row-e1").append(document.createTextNode(" needle"));
    });
    await waitFor(() => expect(painted()).toHaveLength(2));
    expect(centreInRow).toHaveBeenCalledTimes(1);
  });

  it("centres once the row has been measured when the range had no box at first", async () => {
    stubHighlightApi();
    const { scroller, centreInRow, state, measure } = fakeScroller({
      rangeTop: 6000,
    });
    state.boxed = false;
    const coordinator = renderRows(
      <VirtualScrollerContext.Provider value={scroller}>
        <Row anchorId="e1">needle</Row>
      </VirtualScrollerContext.Provider>
    );
    act(() => {
      coordinator.registerSurface({
        scopeId: "test",
        source: occurrencesSource("e1", 1),
        reveal: () => {},
      });
      coordinator.setTerm("needle");
    });
    await flush();
    expect(centreInRow).not.toHaveBeenCalled();

    state.boxed = true;
    measure();
    expect(centreInRow).toHaveBeenCalledTimes(1);
    measure();
    expect(centreInRow).toHaveBeenCalledTimes(1);
  });

  it("centres again when the list's compensation moved the landing off-screen before the scroll settled, once", async () => {
    stubHighlightApi();
    // Our centring scroll lands, then rows measured above shift the viewport
    // by 900 before the virtualizer reports the scroll done.
    const { scroller, centreInRow, targets, measure } = fakeScroller({
      rangeTop: 6000,
      settleShift: 900,
    });
    const coordinator = renderRows(
      <VirtualScrollerContext.Provider value={scroller}>
        <Row anchorId="e1">needle</Row>
      </VirtualScrollerContext.Provider>
    );
    act(() => {
      coordinator.registerSurface({
        scopeId: "test",
        source: occurrencesSource("e1", 1),
        reveal: () => {},
      });
      coordinator.setTerm("needle");
    });
    await flush();
    measure();
    // The first scroll, then one corrective scroll from its settle callback.
    expect(centreInRow).toHaveBeenCalledTimes(2);
    expect(targets[0]).toBe(centred(6000));
    measure();
    expect(centreInRow).toHaveBeenCalledTimes(2);
  });

  it("re-centres once the row grows when the first scroll was clamped short of the target, and not after", async () => {
    stubHighlightApi();
    // The list's max scroll offset sits at estimated sizes: 2000, while the
    // occurrence's centre wants 5705.
    const { scroller, centreInRow, targets, state } = fakeScroller({
      rangeTop: 6000,
      maxScrollTop: 2000,
    });
    const coordinator = renderRows(
      <VirtualScrollerContext.Provider value={scroller}>
        <Row anchorId="e1">needle</Row>
      </VirtualScrollerContext.Provider>
    );
    act(() => {
      coordinator.registerSurface({
        scopeId: "test",
        source: occurrencesSource("e1", 1),
        reveal: () => {},
      });
      coordinator.setTerm("needle");
    });
    await flush();
    expect(centreInRow).toHaveBeenCalledTimes(1);
    expect(state.scrollTop).toBe(2000);

    // The row's own measurement lands: the list can now reach the target.
    state.maxScrollTop = Infinity;
    resizeRows();
    expect(centreInRow).toHaveBeenCalledTimes(2);
    expect(targets.at(-1)).toBe(centred(6000));
    expect(state.scrollTop).toBe(centred(6000));

    // Shown once: a later growth (a live row) never pulls the view back.
    state.scrollTop = 0;
    resizeRows();
    expect(centreInRow).toHaveBeenCalledTimes(2);
  });

  it("measures visibility from the first box with area (a range starting at a line wrap reports an empty one first)", async () => {
    stubHighlightApi();
    const { scroller, targets } = fakeScroller({
      rangeTop: 6000,
      leadingEmptyRect: true,
    });
    const coordinator = renderRows(
      <VirtualScrollerContext.Provider value={scroller}>
        <Row anchorId="e1">needle</Row>
      </VirtualScrollerContext.Provider>
    );
    act(() => {
      coordinator.registerSurface({
        scopeId: "test",
        source: occurrencesSource("e1", 1),
        reveal: () => {},
      });
      coordinator.setTerm("needle");
    });
    await flush();
    expect(targets).toContain(centred(6000));
  });

  it("centres an occurrence whose box straddles the viewport's bottom edge", async () => {
    stubHighlightApi();
    const { scroller, targets } = fakeScroller({
      rangeTop: 1595,
    });
    const coordinator = renderRows(
      <VirtualScrollerContext.Provider value={scroller}>
        <Row anchorId="e1">needle</Row>
      </VirtualScrollerContext.Provider>
    );
    act(() => {
      coordinator.registerSurface({
        scopeId: "test",
        source: occurrencesSource("e1", 1),
        reveal: () => {},
      });
      coordinator.setTerm("needle");
    });
    await flush();
    expect(targets).toContain(centred(1595));
  });

  it("centres an occurrence inside the scroller's box that sits behind a sticky header", async () => {
    stubHighlightApi();
    const { scroller, centreInRow, targets } = fakeScroller({
      rangeTop: 1050,
    });
    const header = document.createElement("header");
    document.body.append(header);
    // The header covers the top 100px of the scroller.
    document.elementFromPoint = (_x, y) =>
      y < 100 ? header : screen.queryByTestId("row-e1");
    const coordinator = renderRows(
      <VirtualScrollerContext.Provider value={scroller}>
        <Row anchorId="e1">needle</Row>
      </VirtualScrollerContext.Provider>
    );
    act(() => {
      coordinator.registerSurface({
        scopeId: "test",
        source: occurrencesSource("e1", 1),
        reveal: () => {},
      });
      coordinator.setTerm("needle");
    });
    await flush();
    expect(targets).toContain(centred(1050));

    // Uncovered and inside the box: nothing to do.
    centreInRow.mockClear();
    act(() => coordinator.setTerm(""));
    act(() => coordinator.setTerm("needle"));
    await flush();
    expect(centreInRow).not.toHaveBeenCalled();
    header.remove();
  });

  it("falls back to DOM scrolling for a row outside a VirtualList", async () => {
    stubHighlightApi();
    // A range below the window's viewport, so the fallback must scroll.
    Range.prototype.getClientRects = () =>
      Object.assign([new DOMRect(0, 5000, 10, 10)], { item: () => null });
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    const coordinator = renderRows(<Row anchorId="e1">needle</Row>);
    act(() => {
      coordinator.registerSurface({
        scopeId: "test",
        source: occurrencesSource("e1", 1),
        reveal: () => {},
      });
      coordinator.setTerm("needle");
    });
    await flush();
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
  });

  it("centres the occurrence of a row that mounts already active (the list jumped to it), even when the row's position left it in view", async () => {
    stubHighlightApi();
    const { scroller, centreInRow, targets, measure } = fakeScroller({
      rangeTop: 1700,
      viewportHeight: 900,
    });
    const captured: { coordinator?: FindCoordinator } = {};
    const Probe = () => {
      const coordinator = useFindCoordinatorOptional();
      useMountEffect(() => {
        captured.coordinator = coordinator ?? undefined;
      });
      return null;
    };
    const ui = (mounted: boolean) => (
      <FindProvider>
        <Probe />
        <VirtualScrollerContext.Provider value={scroller}>
          {mounted ? <Row anchorId="e1">needle</Row> : null}
        </VirtualScrollerContext.Provider>
      </FindProvider>
    );
    const { rerender } = render(ui(false));
    const coordinator = captured.coordinator!;
    act(() => {
      coordinator.registerSurface({
        scopeId: "test",
        source: occurrencesSource("e1", 1),
        reveal: () => {},
      });
      coordinator.setTerm("needle");
    });
    await flush();
    expect(coordinator.getState().activeRow).toBe(0);

    // The virtualizer renders the row once its jump reaches it; the target
    // is taken only after the list measured the band (estimated sizes before
    // that would move it).
    rerender(ui(true));
    expect(centreInRow).not.toHaveBeenCalled();
    // A re-survey (live poll) re-runs the row's effect meanwhile: still
    // waiting for the measurement, still a jump.
    act(() => {
      coordinator.updateSource(
        "test",
        rowsSource([
          {
            anchor: { id: "e1" },
            index: 0,
            count: 1,
            texts: ["needle", "Needle"],
          },
        ])
      );
    });
    await flush();
    expect(centreInRow).not.toHaveBeenCalled();
    measure();
    expect(centreInRow).toHaveBeenCalledTimes(1);
    expect(targets).toContain(centred(1700, 900));
  });

  it("centres a row that mounts already active once under StrictMode's effect double-invoke", async () => {
    stubHighlightApi();
    const { scroller, centreInRow, targets, measure } = fakeScroller({
      rangeTop: 1700,
      viewportHeight: 900,
    });
    const captured: { coordinator?: FindCoordinator } = {};
    const Probe = () => {
      const coordinator = useFindCoordinatorOptional();
      useMountEffect(() => {
        captured.coordinator = coordinator ?? undefined;
      });
      return null;
    };
    const ui = (mounted: boolean) => (
      <StrictMode>
        <FindProvider>
          <Probe />
          <VirtualScrollerContext.Provider value={scroller}>
            {mounted ? <Row anchorId="e1">needle</Row> : null}
          </VirtualScrollerContext.Provider>
        </FindProvider>
      </StrictMode>
    );
    const { rerender } = render(ui(false));
    const coordinator = captured.coordinator!;
    act(() => {
      coordinator.registerSurface({
        scopeId: "test",
        source: occurrencesSource("e1", 1),
        reveal: () => {},
      });
      coordinator.setTerm("needle");
    });
    await flush();
    rerender(ui(true));
    expect(centreInRow).not.toHaveBeenCalled();
    measure();
    expect(centreInRow).toHaveBeenCalledTimes(1);
    expect(targets).toEqual([centred(1700, 900)]);
  });

  it("does not scroll a mounted row that a relocation (same-scope re-register) puts the user back on", async () => {
    stubHighlightApi();
    const { scroller, centreInRow, state } = fakeScroller({ rangeTop: 6000 });
    const coordinator = renderRows(
      <VirtualScrollerContext.Provider value={scroller}>
        <Row anchorId="e1">needle</Row>
      </VirtualScrollerContext.Provider>
    );
    const surface = () => ({
      scopeId: "test",
      source: occurrencesSource("e1", 1),
      reveal: () => {},
    });
    let unregister = () => {};
    act(() => {
      unregister = coordinator.registerSurface(surface());
      coordinator.setTerm("needle");
    });
    await flush();
    expect(centreInRow).toHaveBeenCalledTimes(1);
    const scrollToRow = vi.spyOn(scroller, "scrollToRow");

    // The user scrolls the occurrence out of view, switches tabs and back.
    state.scrollTop = 0;
    act(() => unregister());
    expect(coordinator.getState().activeRow).toBeNull();
    act(() => {
      coordinator.registerSurface(surface());
    });
    await flush();
    expect(coordinator.getState().activeRow).toBe(0);
    expect(highlightMap.get("find-active")?.ranges).toHaveLength(1);
    expect(centreInRow).toHaveBeenCalledTimes(1);
    expect(scrollToRow).not.toHaveBeenCalled();
    expect(state.scrollTop).toBe(0);
  });

  it("does not scroll an active row that remounts (scrolled out of the render window and back)", async () => {
    stubHighlightApi();
    const { scroller, centreInRow, state, measure } = fakeScroller({
      rangeTop: 6000,
    });
    const captured: { coordinator?: FindCoordinator } = {};
    const Probe = () => {
      const coordinator = useFindCoordinatorOptional();
      useMountEffect(() => {
        captured.coordinator = coordinator ?? undefined;
      });
      return null;
    };
    const ui = (mounted: boolean) => (
      <FindProvider>
        <Probe />
        <VirtualScrollerContext.Provider value={scroller}>
          {mounted ? <Row anchorId="e1">needle</Row> : null}
        </VirtualScrollerContext.Provider>
      </FindProvider>
    );
    const { rerender } = render(ui(true));
    const coordinator = captured.coordinator!;
    act(() => {
      coordinator.registerSurface({
        scopeId: "test",
        source: occurrencesSource("e1", 1),
        reveal: () => {},
      });
      coordinator.setTerm("needle");
    });
    await flush();
    expect(centreInRow).toHaveBeenCalledTimes(1);
    const scrollToRow = vi.spyOn(scroller, "scrollToRow");

    state.scrollTop = 0;
    rerender(ui(false));
    rerender(ui(true));
    measure();
    await flush();
    expect(coordinator.getState().activeRow).toBe(0);
    expect(highlightMap.get("find-active")?.ranges).toHaveLength(1);
    expect(centreInRow).toHaveBeenCalledTimes(1);
    expect(scrollToRow).not.toHaveBeenCalled();
    expect(state.scrollTop).toBe(0);
  });

  it("leaves the scroll alone when the occurrence is already in view", async () => {
    stubHighlightApi();
    Range.prototype.getClientRects = () =>
      Object.assign([new DOMRect(0, 100, 10, 10)], { item: () => null });
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    const coordinator = renderRows(<Row anchorId="e1">needle</Row>);
    act(() => {
      coordinator.registerSurface({
        scopeId: "test",
        source: occurrencesSource("e1", 1),
        reveal: () => {},
      });
      coordinator.setTerm("needle");
    });
    await flush();
    expect(highlightMap.get("find-active")?.ranges).toHaveLength(1);
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it("clears contributions when the term clears", async () => {
    stubHighlightApi();
    const coordinator = renderRows(<Row anchorId="e1">needle</Row>);
    act(() => {
      coordinator.registerSurface({
        scopeId: "test",
        source: occurrencesSource("e1"),
        reveal: () => {},
      });
      coordinator.setTerm("needle");
    });
    await flush();
    expect(painted()).toHaveLength(1);

    act(() => coordinator.setTerm(""));
    await flush();
    expect(highlightMap.get("find-match")).toBeUndefined();
    expect(highlightMap.get("find-active")).toBeUndefined();
  });

  it("clears its contributions when the row unmounts", async () => {
    stubHighlightApi();
    const captured: { coordinator?: FindCoordinator } = {};
    const Probe = () => {
      const coordinator = useFindCoordinatorOptional();
      useMountEffect(() => {
        captured.coordinator = coordinator ?? undefined;
      });
      return null;
    };
    const ui = (withRow: boolean) => (
      <FindProvider>
        <Probe />
        {withRow ? <Row anchorId="e1">needle</Row> : null}
      </FindProvider>
    );
    const { rerender } = render(ui(true));
    act(() => {
      captured.coordinator!.registerSurface({
        scopeId: "test",
        source: occurrencesSource("e1"),
        reveal: () => {},
      });
      captured.coordinator!.setTerm("needle");
    });
    await flush();
    expect(painted()).toHaveLength(1);

    rerender(ui(false));
    expect(highlightMap.get("find-match")).toBeUndefined();
    expect(highlightMap.get("find-active")).toBeUndefined();
  });

  it("re-publishes the highlights when a row's ranges change, keeping the other rows' ranges, and not when they don't", async () => {
    stubHighlightApi();
    const coordinator = renderRows(
      <>
        <Row anchorId="e1">needle x needle</Row>
        <Row anchorId="e2">needle</Row>
      </>
    );
    act(() => {
      coordinator.registerSurface({
        scopeId: "test",
        source: rowsSource([
          { anchor: { id: "e1" }, index: 0, count: 2, texts: ["needle"] },
          { anchor: { id: "e2" }, index: 1, count: 1, texts: ["needle"] },
        ]),
        reveal: () => {},
      });
      coordinator.setTerm("needle");
    });
    await flush();
    const match = highlightMap.get("find-match")!;
    // e1's second occurrence and e2's one; e1's first is the active.
    expect(match.size).toBe(2);
    expect(highlightMap.get("find-active")!.size).toBe(1);
    const e1Range = match.ranges.find(
      (r) => r.startContainer.parentElement?.dataset.testid === "row-e1"
    )!;

    // A mutation that leaves e2's ranges as they were: nothing is published
    // (a registered Highlight is costly to touch in Firefox).
    act(() => {
      screen.getByTestId("row-e2").append(document.createTextNode(" plain"));
    });
    await flush();
    expect(highlightMap.get("find-match")).toBe(match);
    expect(match.adds).toBe(2);

    act(() => {
      screen.getByTestId("row-e2").append(document.createTextNode(" needle"));
    });
    await waitFor(() => expect(highlightMap.get("find-match")!.size).toBe(3));
    // Published as a fresh set; e1's range object is the same one.
    expect(highlightMap.get("find-match")!.ranges).toContain(e1Range);
  });

  it("removes only the unmounted row's ranges, after its nodes are gone", async () => {
    stubHighlightApi();
    const captured: { coordinator?: FindCoordinator } = {};
    const Probe = () => {
      const coordinator = useFindCoordinatorOptional();
      useMountEffect(() => {
        captured.coordinator = coordinator ?? undefined;
      });
      return null;
    };
    const ui = (withSecond: boolean) => (
      <FindProvider>
        <Probe />
        <Row anchorId="e1">needle x needle</Row>
        {withSecond ? <Row anchorId="e2">needle</Row> : null}
      </FindProvider>
    );
    const { rerender } = render(ui(true));
    act(() => {
      captured.coordinator!.registerSurface({
        scopeId: "test",
        source: rowsSource([
          { anchor: { id: "e1" }, index: 0, count: 2, texts: ["needle"] },
          { anchor: { id: "e2" }, index: 1, count: 1, texts: ["needle"] },
        ]),
        reveal: () => {},
      });
      captured.coordinator!.setTerm("needle");
    });
    await flush();
    const match = highlightMap.get("find-match")!;
    expect(match.size).toBe(2);
    const kept = match.ranges.find(
      (r) => r.startContainer.parentElement?.dataset.testid === "row-e1"
    );

    rerender(ui(false));
    expect(highlightMap.get("find-match")!.ranges).toEqual([kept]);
    expect(highlightMap.get("find-active")?.size).toBe(1);
  });

  it("ignores the list's landing callback once the band has closed", async () => {
    stubHighlightApi();
    const { scroller, centreInRow } = fakeScroller({ rangeTop: 6000 });
    let landed: (() => void) | undefined;
    vi.spyOn(scroller, "scrollToRow").mockImplementation((_node, onDone) => {
      landed = onDone;
      return true;
    });
    const coordinator = renderRows(
      <VirtualScrollerContext.Provider value={scroller}>
        <Row anchorId="e1">needle</Row>
      </VirtualScrollerContext.Provider>
    );
    act(() => {
      coordinator.registerSurface({
        scopeId: "test",
        source: occurrencesSource("e1", 1),
        reveal: () => {},
      });
      coordinator.setTerm("needle");
    });
    await flush();
    // Mounted at activation with the occurrence out of view: the row asked
    // the list to bring it in first and waits for the landing.
    expect(landed).toBeDefined();
    expect(centreInRow).not.toHaveBeenCalled();

    act(() => coordinator.close());
    expect(highlightMap.get("find-match")).toBeUndefined();
    // The row's text changes meanwhile (markdown finishing), so a late
    // re-scan would have new ranges to publish.
    screen.getByTestId("row-e1").append(document.createTextNode(" needle"));
    act(() => landed!());
    expect(highlightMap.get("find-match")).toBeUndefined();
    expect(highlightMap.get("find-active")).toBeUndefined();
    expect(centreInRow).not.toHaveBeenCalled();
  });

  it("flashes a reveal once without Custom Highlights: a re-survey that keeps the row does not flash again", async () => {
    const coordinator = renderRows(<Row anchorId="e1">needle</Row>);
    act(() => {
      coordinator.registerSurface({
        scopeId: "test",
        source: occurrencesSource("e1", 1),
        reveal: () => {},
      });
      coordinator.setTerm("needle");
    });
    await flush();
    const row = screen.getByTestId("row-e1");
    expect(row.classList.contains("find-flash")).toBe(true);
    act(() => {
      row.dispatchEvent(new Event("animationend"));
    });
    expect(row.classList.contains("find-flash")).toBe(false);

    act(() => {
      coordinator.updateSource(
        "test",
        rowsSource([
          {
            anchor: { id: "e1" },
            index: 0,
            count: 1,
            texts: ["needle", "Needle"],
          },
        ])
      );
    });
    await flush();
    expect(coordinator.getState().activeRow).toBe(0);
    expect(row.classList.contains("find-flash")).toBe(false);
  });

  it("flashes the row instead when Custom Highlights are unsupported", async () => {
    // No stub: CSS.highlights and Highlight are absent in jsdom.
    const coordinator = renderRows(<Row anchorId="e1">needle</Row>);
    act(() => {
      coordinator.registerSurface({
        scopeId: "test",
        source: occurrencesSource("e1"),
        reveal: () => {},
      });
      coordinator.setTerm("needle");
    });
    await flush();

    const row = document.querySelector('[data-testid="row-e1"]');
    expect(row?.classList.contains("find-flash")).toBe(true);
  });

  it("announces again when the row becomes the active anchor again", async () => {
    // No Custom Highlights: the announcement is the flash class.
    const source = rowsSource([
      {
        anchor: { id: "e1" },
        index: 0,
        count: 1,
        texts: ["needle"],
      },
      {
        anchor: { id: "e2" },
        index: 0,
        count: 1,
        texts: ["needle"],
      },
    ]);
    const coordinator = renderRows(
      <>
        <Row anchorId="e1">needle</Row>
        <Row anchorId="e2">needle</Row>
      </>
    );
    act(() => {
      coordinator.registerSurface({
        scopeId: "test",
        source,
        reveal: () => {},
      });
      coordinator.setTerm("needle");
    });
    await flush();
    const row1 = screen.getByTestId("row-e1");
    expect(row1.classList.contains("find-flash")).toBe(true);
    act(() => {
      row1.dispatchEvent(new Event("animationend"));
    });
    expect(row1.classList.contains("find-flash")).toBe(false);

    act(() => coordinator.next());
    await flush();
    expect(screen.getByTestId("row-e2").classList.contains("find-flash")).toBe(
      true
    );
    expect(row1.classList.contains("find-flash")).toBe(false);

    act(() => coordinator.next()); // wraps back to e1
    await flush();
    expect(row1.classList.contains("find-flash")).toBe(true);
  });

  it("scrolls a range that renders later, once", async () => {
    stubHighlightApi();
    Range.prototype.getClientRects = () =>
      Object.assign([new DOMRect(0, 5000, 10, 10)], { item: () => null });
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    // The projection has one occurrence; the row renders it only later
    // (async markdown / Prism churn).
    const coordinator = renderRows(<Row anchorId="e1">pending</Row>);
    act(() => {
      coordinator.registerSurface({
        scopeId: "test",
        source: occurrencesSource("e1", 1),
        reveal: () => {},
      });
      coordinator.setTerm("needle");
    });
    await flush();
    const row = screen.getByTestId("row-e1");
    expect(row.classList.contains("find-flash")).toBe(true);
    expect(scrollIntoView).not.toHaveBeenCalled();

    act(() => {
      row.append(document.createTextNode(" needle"));
    });
    await waitFor(() =>
      expect(highlightMap.get("find-active")?.ranges).toHaveLength(1)
    );
    expect(scrollIntoView).toHaveBeenCalledTimes(1);

    act(() => {
      row.append(document.createTextNode(" needle"));
    });
    await waitFor(() => expect(painted()).toHaveLength(2));
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
  });

  it("waits for a pending markdown render, then announces the rendered text once", async () => {
    stubHighlightApi();
    Range.prototype.getClientRects = () =>
      Object.assign([new DOMRect(0, 5000, 10, 10)], { item: () => null });
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    const coordinator = renderRows(
      <Row anchorId="e1">
        <span data-markdown-pending="true">needle</span>
      </Row>
    );
    act(() => {
      coordinator.registerSurface({
        scopeId: "test",
        source: occurrencesSource("e1", 1),
        reveal: () => {},
      });
      coordinator.setTerm("needle");
    });
    await flush();
    const row = screen.getByTestId("row-e1");
    expect(scrollIntoView).not.toHaveBeenCalled();
    expect(row.classList.contains("find-flash")).toBe(false);

    act(() => {
      row.querySelector("span")!.removeAttribute("data-markdown-pending");
    });
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalledTimes(1));

    act(() => {
      row.append(document.createTextNode(" needle"));
    });
    await waitFor(() => expect(painted()).toHaveLength(2));
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
  });

  it("withdraws its DOM count while markdown is pending, so stepping uses the source count", async () => {
    stubHighlightApi();
    const coordinator = renderRows(
      <Row anchorId="e1">
        <span>needle</span>
      </Row>
    );
    act(() => {
      coordinator.registerSurface({
        scopeId: "test",
        source: occurrencesSource("e1", 3),
        reveal: () => {},
      });
      coordinator.setTerm("needle");
    });
    await flush();
    // One DOM match: Enter wraps within the row.
    act(() => coordinator.next());
    expect(coordinator.getState().activeOccurrence).toBe(0);

    const span = screen.getByTestId("row-e1").querySelector("span")!;
    act(() => span.setAttribute("data-markdown-pending", "true"));
    await flush(); // the observer's microtask has run
    act(() => coordinator.next());
    expect(coordinator.getState().activeOccurrence).toBe(1);

    act(() => span.removeAttribute("data-markdown-pending"));
    await waitFor(() =>
      expect(coordinator.getState().activeOccurrence).toBe(0)
    );
  });

  it("opens a closed <details> holding the active occurrence before centring it", async () => {
    stubHighlightApi();
    // A closed <details> lays out nothing: no box until it is open.
    Range.prototype.getClientRects = function (this: Range) {
      const details = this.startContainer.parentElement?.closest("details");
      const boxed = !details || details.open;
      return Object.assign(boxed ? [new DOMRect(0, 5000, 10, 10)] : [], {
        item: () => null,
      });
    };
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    const coordinator = renderRows(
      <Row anchorId="e1">
        <details>
          <summary>tool</summary>
          needle
        </details>
      </Row>
    );
    act(() => {
      coordinator.registerSurface({
        scopeId: "test",
        source: occurrencesSource("e1", 1),
        reveal: () => {},
      });
      coordinator.setTerm("needle");
    });
    await flush();
    const details = screen.getByTestId("row-e1").querySelector("details")!;
    expect(details.open).toBe(true);
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(coordinator.getState().activeOrdinal).toBe(0);

    // The user closing it again is respected: no re-open on later mutations.
    act(() => {
      details.open = false;
      details.append(document.createTextNode(" needle"));
    });
    await waitFor(() => expect(painted()).toHaveLength(2));
    expect(details.open).toBe(false);
  });

  it("flashes a row that renders none of the source's matches, and stepping moves on", async () => {
    stubHighlightApi();
    // The source matched link URLs the row does not render.
    const coordinator = renderRows(
      <>
        <Row anchorId="e1">nothing rendered</Row>
        <Row anchorId="e2">needle</Row>
      </>
    );
    act(() => {
      coordinator.registerSurface({
        scopeId: "test",
        source: rowsSource([
          {
            anchor: { id: "e1" },
            index: 0,
            count: 2,
            texts: ["needle"],
          },
          {
            anchor: { id: "e2" },
            index: 0,
            count: 1,
            texts: ["needle"],
          },
        ]),
        reveal: () => {},
      });
      coordinator.setTerm("needle");
    });
    await flush();

    const row = screen.getByTestId("row-e1");
    expect(row.classList.contains("find-flash")).toBe(true);
    expect(highlightMap.get("find-active")).toBeUndefined();
    expect(coordinator.getState()).toMatchObject({
      activeRow: 0,
      activeOrdinal: null,
      count: 3,
    });

    act(() => coordinator.next());
    await flush();
    // N counts the skipped row's source estimate: the total is not rewritten.
    expect(coordinator.getState()).toMatchObject({
      activeRow: 1,
      activeOrdinal: 2,
    });
    expect(highlightMap.get("find-active")?.ranges[0]?.toString()).toBe(
      "needle"
    );
  });
});
