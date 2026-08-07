// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { FC, useEffect } from "react";
import { afterEach, describe, expect, it } from "vitest";

import {
  ExtendedFindProvider,
  useExtendedFind,
  type MatchLocatorFn,
} from "./ExtendedFindContext";

interface SourceSpec {
  id: string;
  count?: number;
  locator?: MatchLocatorFn;
  /** Changing this re-registers the counter with a fresh identity. */
  bump?: number;
}

const Source: FC<SourceSpec> = ({ id, count, locator, bump }) => {
  const { registerMatchCounter, registerMatchLocator } = useExtendedFind();

  useEffect(() => {
    if (count === undefined) return;
    return registerMatchCounter(id, () => count);
    // `bump` deliberately participates: it forces the unregister/re-register
    // cycle a component with an unstable countFn performs on every render.
  }, [id, count, bump, registerMatchCounter]);

  useEffect(() => {
    if (!locator) return;
    return registerMatchLocator(id, locator);
  }, [id, locator, registerMatchLocator]);

  return null;
};

/**
 * Renders the sources in array order, which is the order they register in —
 * `ordinalAtSelection` walks counters in registration order, so the array
 * order is what the offset arithmetic is defined against.
 */
interface SourcesHarness {
  ordinal: (term: string) => number | null;
  rerender: (sources: SourceSpec[]) => void;
}

function renderSources(sources: SourceSpec[]): SourcesHarness {
  let ordinalAtSelection: ((term: string) => number | null) | null = null;
  const Probe: FC = () => {
    const { ordinalAtSelection: fn } = useExtendedFind();
    useEffect(() => {
      ordinalAtSelection = fn;
    });
    return null;
  };
  const tree = (list: SourceSpec[]) => (
    <ExtendedFindProvider>
      <Probe />
      {list.map((s) => (
        <Source key={s.id} {...s} />
      ))}
    </ExtendedFindProvider>
  );
  const view = render(tree(sources));
  if (!ordinalAtSelection) throw new Error("probe did not render");
  return {
    ordinal: (term: string) => ordinalAtSelection!(term),
    rerender: (list: SourceSpec[]) => view.rerender(tree(list)),
  };
}

describe("ordinalAtSelection", () => {
  afterEach(cleanup);

  it("returns the locator's index directly for the first source", () => {
    const { ordinal } = renderSources([
      { id: "a", count: 7, locator: () => 3 },
      { id: "b", count: 5 },
    ]);

    expect(ordinal("needle")).toBe(3);
  });

  it("offsets a later source's index by the earlier sources' counts", () => {
    const { ordinal } = renderSources([
      { id: "a", count: 7 },
      { id: "b", count: 5, locator: () => 2 },
    ]);

    expect(ordinal("needle")).toBe(9);
  });

  it("returns null when no locator claims the selection", () => {
    const { ordinal } = renderSources([
      { id: "a", count: 7 },
      { id: "b", count: 5, locator: () => null },
    ]);

    expect(ordinal("needle")).toBeNull();
  });

  it("keeps offsets stable when a source re-registers", () => {
    // Map.set on a previously-deleted key appends at the tail, so a source
    // whose countFn identity churns (an un-memoised list re-registering every
    // render) used to jump to the end of the enumeration and shift every
    // other source's offset — the counter moved with no navigation.
    const sources: SourceSpec[] = [
      { id: "a", count: 7 },
      { id: "b", count: 5, locator: () => 2 },
    ];
    const { ordinal, rerender } = renderSources(sources);
    expect(ordinal("needle")).toBe(9);

    // Re-render with "a"'s counter identity changed (same count, new closure).
    rerender([{ id: "a", count: 7, bump: 1 }, sources[1]!]);

    expect(ordinal("needle")).toBe(9);
  });

  it("ignores a locator registered without a counter", () => {
    // Offsets are meaningless without a count, so such a source is skipped
    // rather than silently reporting an index into the wrong total.
    const { ordinal } = renderSources([
      { id: "a", count: 7 },
      { id: "orphan", locator: () => 0 },
    ]);

    expect(ordinal("needle")).toBeNull();
  });
});
