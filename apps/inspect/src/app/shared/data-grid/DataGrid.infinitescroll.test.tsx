import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";

import type { ExtendedColumnDef } from "./columnTypes";
import { DataGrid } from "./DataGrid";

// Vitest globals aren't enabled in this app, so RTL's automatic afterEach
// cleanup never fires. Run it explicitly.
afterEach(cleanup);

interface Row {
  id: string;
  a: string;
}

const makeRows = (count: number): Row[] =>
  Array.from({ length: count }, (_, i) => ({ id: `r${i}`, a: `${i}a` }));

const columns: ExtendedColumnDef<Row>[] = [
  {
    id: "a",
    header: "A",
    size: 100,
    accessorFn: (r: Row) => r.a,
    cell: ({ getValue }) => <div>{getValue<string>()}</div>,
  },
];

const gridWith = (
  data: Row[],
  props: {
    hasMore: boolean;
    onScrollNearEnd: () => void;
    autoFetchPaused?: boolean;
  }
) => (
  <DataGrid<Row>
    data={data}
    columns={columns}
    getRowId={(r) => r.id}
    onRowActivate={() => {}}
    hasMore={props.hasMore}
    onScrollNearEnd={props.onScrollNearEnd}
    autoFetchPaused={props.autoFetchPaused}
  />
);

/** Give the (layout-less) jsdom scroll container real-looking geometry. */
const setScrollGeometry = (heights: {
  scrollHeight: number;
  clientHeight: number;
}) => {
  for (const [key, value] of Object.entries(heights)) {
    Object.defineProperty(HTMLElement.prototype, key, {
      configurable: true,
      get: () => value,
    });
  }
  return () => {
    for (const key of Object.keys(heights)) {
      delete (HTMLElement.prototype as unknown as Record<string, unknown>)[key];
    }
  };
};

describe("DataGrid infinite scroll trigger", () => {
  test("fires on mount when more rows exist and the content is within the threshold", () => {
    // jsdom's zero-height layout means the viewport starts "at the bottom":
    // a first page that can't fill the viewport must chain the next fetch
    // without any scroll event.
    const onScrollNearEnd = vi.fn();
    render(gridWith(makeRows(3), { hasMore: true, onScrollNearEnd }));
    expect(onScrollNearEnd).toHaveBeenCalled();
  });

  test("never fires without hasMore", () => {
    const onScrollNearEnd = vi.fn();
    render(gridWith(makeRows(3), { hasMore: false, onScrollNearEnd }));
    fireEvent.scroll(screen.getByRole("grid"));
    expect(onScrollNearEnd).not.toHaveBeenCalled();
  });

  test("fires when a scroll comes within the threshold, not before", () => {
    const restore = setScrollGeometry({
      scrollHeight: 10_000,
      clientHeight: 500,
    });
    try {
      const onScrollNearEnd = vi.fn();
      render(gridWith(makeRows(300), { hasMore: true, onScrollNearEnd }));
      // Mount check: 10,000 - 0 - 500 = 9,500px from the bottom — no fetch.
      expect(onScrollNearEnd).not.toHaveBeenCalled();

      const container = screen.getByRole("grid");
      fireEvent.scroll(container, { target: { scrollTop: 7_000 } });
      expect(onScrollNearEnd).not.toHaveBeenCalled(); // 2,500px out

      fireEvent.scroll(container, { target: { scrollTop: 8_000 } });
      expect(onScrollNearEnd).toHaveBeenCalledTimes(1); // 1,500px out
    } finally {
      restore();
    }
  });

  test("re-checks when a page lands so short pages chain the next fetch", () => {
    const onScrollNearEnd = vi.fn();
    const { rerender } = render(
      gridWith(makeRows(3), { hasMore: true, onScrollNearEnd })
    );
    const baseline = onScrollNearEnd.mock.calls.length;
    expect(baseline).toBeGreaterThan(0);

    rerender(gridWith(makeRows(6), { hasMore: true, onScrollNearEnd }));
    expect(onScrollNearEnd.mock.calls.length).toBeGreaterThan(baseline);
  });

  test("does not re-fire from a re-render when the rows are unchanged", () => {
    // Regression: an every-commit check chains unboundedly once a fetch
    // stops changing the rows (retained-page cap) — the near-end condition
    // then re-satisfies itself off the fetch's own re-render.
    const onScrollNearEnd = vi.fn();
    const rows = makeRows(3);
    const { rerender } = render(
      gridWith(rows, { hasMore: true, onScrollNearEnd })
    );
    const baseline = onScrollNearEnd.mock.calls.length;
    expect(baseline).toBeGreaterThan(0);

    rerender(gridWith(rows, { hasMore: true, onScrollNearEnd }));
    expect(onScrollNearEnd.mock.calls.length).toBe(baseline);
  });

  test("autoFetchPaused stops commit-driven fetches but not scroll-driven ones", () => {
    const onScrollNearEnd = vi.fn();
    const { rerender } = render(
      gridWith(makeRows(3), {
        hasMore: true,
        onScrollNearEnd,
        autoFetchPaused: true,
      })
    );
    rerender(
      gridWith(makeRows(6), {
        hasMore: true,
        onScrollNearEnd,
        autoFetchPaused: true,
      })
    );
    expect(onScrollNearEnd).not.toHaveBeenCalled();

    // A user scroll must still page (past a cap, or as the retry out of an
    // error) — jsdom's zero-height layout reads as "at the bottom".
    fireEvent.scroll(screen.getByRole("grid"));
    expect(onScrollNearEnd).toHaveBeenCalledTimes(1);
  });
});
