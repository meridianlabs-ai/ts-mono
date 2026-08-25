// @vitest-environment jsdom
import { act, render } from "@testing-library/react";
import { FC, useEffect, useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FindProvider, useFindCoordinator } from "./FindCoordinatorContext";
import type {
  FindCoordinator,
  FindMatch,
  FindSource,
  FindStreamItem,
} from "./types";
import { computeRowRanges, useFindHighlights } from "./useFindHighlights";

// ---- CSS Custom Highlight API stub (jsdom has neither CSS.highlights nor
// Highlight). Stubbed at the global boundary, per repo testing rules. ----

class HighlightStub {
  ranges: Range[];
  constructor(...ranges: Range[]) {
    this.ranges = ranges;
  }
}

let highlightMap: Map<string, HighlightStub>;

function stubHighlightApi() {
  highlightMap = new Map();
  vi.stubGlobal("CSS", { highlights: highlightMap });
  vi.stubGlobal("Highlight", HighlightStub);
}

// ---- Harness -------------------------------------------------------------

const flush = () => act(() => new Promise((resolve) => setTimeout(resolve, 0)));

function singleMatchSource(anchorId: string): FindSource {
  return {
    scopeId: "test",
    capabilities: { complete: true },
    // eslint-disable-next-line @typescript-eslint/require-await
    async *find(): AsyncIterable<FindStreamItem> {
      const matches: FindMatch[] = [
        { anchor: { kind: "event", id: anchorId }, occurrence: 0 },
        { anchor: { kind: "event", id: anchorId }, occurrence: 1 },
      ];
      yield { kind: "matches", matches };
      yield {
        kind: "end",
        complete: true,
        total: { value: 2, relation: "eq" },
      };
    },
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
    const coordinator = useFindCoordinator();
    useEffect(() => {
      captured.coordinator = coordinator;
    }, [coordinator]);
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

// ---- computeRowRanges: offset mapping over split text nodes ---------------

describe("computeRowRanges", () => {
  beforeEach(stubHighlightApi);

  it("builds ranges that span element boundaries", () => {
    const root = document.createElement("div");
    // "needle" split across an element boundary: "nee" + <b>"dle"</b>
    root.append("nee");
    const b = document.createElement("b");
    b.textContent = "dle here";
    root.append(b);

    const ranges = computeRowRanges(root, "needle");
    expect(ranges).toHaveLength(1);
    const range = ranges[0]!;
    expect(range.startContainer).toBe(root.firstChild);
    expect(range.startOffset).toBe(0);
    expect(range.endContainer).toBe(b.firstChild);
    expect(range.endOffset).toBe(3);
    expect(range.toString()).toBe("needle");
  });

  it("skips data-unsearchable subtrees", () => {
    const root = document.createElement("div");
    root.innerHTML =
      '<span>needle</span><span data-unsearchable="true">needle</span>';

    const ranges = computeRowRanges(root, "needle");
    expect(ranges).toHaveLength(1);
    // Concatenation must also not bridge across the skipped subtree.
    expect(ranges[0]!.toString()).toBe("needle");
  });

  it("matches case-insensitively and finds every occurrence", () => {
    const root = document.createElement("div");
    root.textContent = "Needle and NEEDLE and needle";
    const ranges = computeRowRanges(root, "needle");
    expect(ranges).toHaveLength(3);
  });

  it("matches JSON-escaped variants so highlights agree with source counts", () => {
    const root = document.createElement("div");
    // The rendered text carries the JSON-escaped form of `say "hi"`.
    root.textContent = '{"cmd":"say \\"hi\\""}';
    const ranges = computeRowRanges(root, 'say "hi"');
    expect(ranges).toHaveLength(1);
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
        source: singleMatchSource("e1"),
        reveal: () => Promise.resolve("revealed"),
      });
      coordinator.setTerm("needle");
    });
    await flush();

    const matchHighlight = highlightMap.get("find-match");
    expect(matchHighlight?.ranges).toHaveLength(2);
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
        source: singleMatchSource("e1"),
        reveal: () => Promise.resolve("revealed"),
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

  it("clears contributions when the term clears", async () => {
    stubHighlightApi();
    const coordinator = renderRows(<Row anchorId="e1">needle</Row>);
    act(() => {
      coordinator.registerSurface({
        scopeId: "test",
        source: singleMatchSource("e1"),
        reveal: () => Promise.resolve("revealed"),
      });
      coordinator.setTerm("needle");
    });
    await flush();
    expect(highlightMap.get("find-match")).toBeDefined();

    act(() => coordinator.setTerm(""));
    await flush();
    expect(highlightMap.get("find-match")).toBeUndefined();
    expect(highlightMap.get("find-active")).toBeUndefined();
  });

  it("flashes the row instead when Custom Highlights are unsupported", async () => {
    // No stub: CSS.highlights and Highlight are absent in jsdom.
    const coordinator = renderRows(<Row anchorId="e1">needle</Row>);
    act(() => {
      coordinator.registerSurface({
        scopeId: "test",
        source: singleMatchSource("e1"),
        reveal: () => Promise.resolve("revealed"),
      });
      coordinator.setTerm("needle");
    });
    await flush();

    const row = document.querySelector('[data-testid="row-e1"]');
    expect(row?.classList.contains("find-flash")).toBe(true);
  });

  it("flashes when the active occurrence exceeds the rendered occurrences", async () => {
    stubHighlightApi();
    // The projection counts 2 occurrences but the render shows only 1.
    const coordinator = renderRows(<Row anchorId="e1">needle only-once</Row>);
    act(() => {
      coordinator.registerSurface({
        scopeId: "test",
        source: singleMatchSource("e1"),
        reveal: () => Promise.resolve("revealed"),
      });
      coordinator.setTerm("needle");
    });
    await flush();

    act(() => coordinator.next()); // occurrence 1 — not in the rendered text
    await flush();

    const row = document.querySelector('[data-testid="row-e1"]');
    expect(row?.classList.contains("find-flash")).toBe(true);
    // Highlight what exists: the single rendered occurrence stays marked.
    expect(highlightMap.get("find-match")?.ranges).toHaveLength(1);
    expect(highlightMap.get("find-active")).toBeUndefined();
  });
});
