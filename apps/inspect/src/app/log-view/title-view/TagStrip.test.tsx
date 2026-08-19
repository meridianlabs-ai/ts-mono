/**
 * TagStrip behavior:
 *
 * The strip is a single wrap-aware `.tagRow` container holding the
 * chips followed by the Edit pill as the last item — same pattern as
 * the Task tab. When chips wrap to extra lines, the Edit pill follows
 * the last chip onto whichever line it ends up on.
 *
 * Regression: an earlier iteration pulled Edit out as a sibling so it
 * couldn't be clipped, but that broke the inline-with-chips look. The
 * tests below pin Edit's inline placement.
 */

import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";

import { nextVisibleCount, TagStrip } from "./TagStrip";

// Vitest globals aren't enabled in this app, so RTL's automatic
// afterEach cleanup hook never fires. Run it explicitly so each test
// starts with a fresh document.
afterEach(cleanup);

describe("TagStrip", () => {
  test("Edit pill is inline with chips inside the tagRow", () => {
    // Regression for an earlier change that pulled Edit out as a sibling
    // of `.tagRow`. The Edit pill must live INSIDE the wrap-aware chip
    // container so it visually flows after the last chip — matching the
    // Task tab pattern. If something moves Edit back out of `.tagRow`,
    // this test fails.
    const { container } = render(
      <TagStrip tags={["alpha", "beta", "gamma"]} showEdit onEdit={() => {}} />
    );

    const tagRow = container.querySelector<HTMLElement>(".tagRow");
    expect(tagRow).not.toBeNull();

    const edit = screen.getByTitle("Edit tags");
    expect(tagRow!.contains(edit)).toBe(true);
    // And it's the last child so it visually follows the last chip.
    expect(tagRow!.lastElementChild).toBe(edit);
  });

  test("tagRow contains every chip plus the Edit pill", () => {
    const { container } = render(
      <TagStrip tags={["one", "two", "three"]} showEdit onEdit={() => {}} />
    );

    const tagRow = container.querySelector<HTMLElement>(".tagRow");
    expect(tagRow).not.toBeNull();
    for (const label of ["one", "two", "three"]) {
      expect(within(tagRow!).getByText(label)).toBeInTheDocument();
    }
    // Each chip is rendered as a clickable <button> so the whole pill
    // strip opens the edit dialog uniformly — three chip buttons plus
    // the trailing Edit pill.
    expect(within(tagRow!).getAllByRole("button")).toHaveLength(4);
  });

  test("clicking a chip fires onEdit when showEdit is true", () => {
    const onEdit = vi.fn();
    render(<TagStrip tags={["alpha", "beta"]} showEdit onEdit={onEdit} />);
    fireEvent.click(screen.getByText("alpha"));
    expect(onEdit).toHaveBeenCalledTimes(1);
  });

  test("chips are inert spans when showEdit is false", () => {
    // When the log isn't editable, chips fall back to non-interactive
    // <span> elements — they shouldn't surface as buttons because
    // clicking them can't open a usable dialog.
    const { container } = render(
      <TagStrip tags={["alpha", "beta"]} showEdit={false} onEdit={() => {}} />
    );
    const tagRow = container.querySelector<HTMLElement>(".tagRow");
    expect(tagRow).not.toBeNull();
    expect(within(tagRow!).queryAllByRole("button")).toHaveLength(0);
  });

  test("Edit pill labels itself as 'Tags' when there are no chips", () => {
    render(<TagStrip tags={[]} showEdit onEdit={() => {}} />);
    // With no chips present, the button labels itself so the pill
    // makes sense in isolation.
    const btn = screen.getByTitle("Edit tags");
    expect(btn).toBeInTheDocument();
    expect(btn.textContent).toMatch(/Tags/);
    expect(btn.textContent).not.toMatch(/Edit/);
  });

  test("Edit pill says 'Edit' when chips are present", () => {
    render(<TagStrip tags={["alpha", "beta"]} showEdit onEdit={() => {}} />);
    const btn = screen.getByTitle("Edit tags");
    expect(btn.textContent).toMatch(/edit/);
    expect(btn.textContent).not.toMatch(/Tags/);
  });

  test("renders nothing when there are no tags and no edit affordance", () => {
    const { container } = render(
      <TagStrip tags={[]} showEdit={false} onEdit={() => {}} />
    );
    expect(container).toBeEmptyDOMElement();
  });

  test("collapseOnWrap trims 80 tags without exceeding React's update depth", () => {
    // Regression: the trim used to shed one chip per nested setState in
    // the layout effect, so 50+ overflowing chips hit React's 50-nested-
    // update cap and threw "Maximum update depth exceeded" (react error
    // #185). jsdom has no layout, so simulate flex-wrap by deriving
    // offsetTop from child index — four items per row.
    class ResizeObserverStub {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    const spy = vi
      .spyOn(HTMLElement.prototype, "offsetTop", "get")
      .mockImplementation(function (this: HTMLElement) {
        const parent = this.parentElement;
        if (!parent) return 0;
        const idx = Array.prototype.indexOf.call(parent.children, this);
        return Math.floor(idx / 4) * 20;
      });
    try {
      const tags = Array.from({ length: 80 }, (_, i) => `tag-${i}`);
      const { container } = render(
        <TagStrip tags={tags} showEdit collapseOnWrap onEdit={() => {}} />
      );
      const tagRow = container.querySelector<HTMLElement>(".tagRow");
      expect(tagRow).not.toBeNull();
      // Converged exactly: 6 chips + overflow pill + Edit pill fill the
      // two allowed rows of the simulated 4-per-row layout (8 items),
      // with the remaining 74 tags behind the "…" pill. Pinning the
      // counts guards against over-trimming as much as under-trimming.
      expect(tagRow!.children.length).toBe(8);
      const chips = within(tagRow!)
        .getAllByRole("button")
        .filter((b) => /^tag-\d+$/.test(b.textContent ?? ""));
      expect(chips).toHaveLength(6);
      const overflow = within(tagRow!).getByText("…");
      expect(overflow.title).toMatch(/^74 more tags: /);
    } finally {
      spy.mockRestore();
      vi.unstubAllGlobals();
    }
  });
});

// The pure trim step, exercised against a simulated greedy flex-wrap
// (jsdom reports offsetTop 0 everywhere, so real measurement can't be
// tested here). Covers convergence, equivalence with the previous
// one-chip-per-step result, and the nested-update budget.
describe("nextVisibleCount", () => {
  const MAX_ROWS = 2;
  const GAP = 6;
  const EDIT_PILL = 40;
  const OVERFLOW_PILL = 30;

  // Greedy flex-wrap: returns each item's row index (a stand-in for
  // offsetTop — distinct rows get distinct values, which is all
  // nextVisibleCount relies on).
  const layoutTops = (widths: number[], containerWidth: number): number[] => {
    const tops: number[] = [];
    let row = 0;
    let x = 0;
    for (const w of widths) {
      if (x > 0 && x + GAP + w > containerWidth) {
        row++;
        x = w;
      } else {
        x = x > 0 ? x + GAP + w : w;
      }
      tops.push(row);
    }
    return tops;
  };

  // Runs the component's measure/trim loop against the simulated
  // layout, returning the converged visible count and how many
  // setState steps (nested re-renders) it took.
  const converge = (
    chipWidths: number[],
    containerWidth: number,
    step: (tops: number[], chipCount: number) => number | null
  ): { visible: number; steps: number } => {
    let visible = chipWidths.length;
    let steps = 0;
    for (;;) {
      const pills =
        visible < chipWidths.length ? [OVERFLOW_PILL, EDIT_PILL] : [EDIT_PILL];
      const widths = [...chipWidths.slice(0, visible), ...pills];
      const next = step(layoutTops(widths, containerWidth), visible);
      if (next === null) return { visible, steps };
      if (next >= visible) throw new Error("trim did not decrease");
      visible = next;
      steps++;
      if (steps > chipWidths.length + 2) throw new Error("did not converge");
    }
  };

  const batchStep = (tops: number[], chipCount: number) =>
    nextVisibleCount(tops, chipCount, MAX_ROWS);

  // The pre-fix algorithm (one chip per nested update) as the reference
  // for the converged visual result.
  const linearStep = (tops: number[], chipCount: number) =>
    new Set(tops).size > MAX_ROWS && chipCount > 0 ? chipCount - 1 : null;

  test("returns null when the row already fits", () => {
    expect(nextVisibleCount([0, 0, 0, 1, 1], 4, MAX_ROWS)).toBe(null);
  });

  test("returns null when no chips are visible", () => {
    expect(nextVisibleCount([0, 1, 2], 0, MAX_ROWS)).toBe(null);
  });

  test("jumps directly to the measured fit count", () => {
    // 4 chips on rows 0/0/1/2 plus the Edit pill on row 2: the two
    // chips on rows 0 and 1 plus the third fit, so the next probe is 3.
    expect(nextVisibleCount([0, 0, 1, 2, 2], 4, MAX_ROWS)).toBe(3);
  });

  test("still shrinks when all chips fit but the pills wrapped", () => {
    expect(nextVisibleCount([0, 0, 1, 1, 2, 2], 4, MAX_ROWS)).toBe(3);
  });

  test("trims 80 uniform chips within React's nested-update budget", () => {
    const chips = Array.from({ length: 80 }, () => 60);
    const { visible, steps } = converge(chips, 300, batchStep);
    const reference = converge(chips, 300, linearStep);
    expect(visible).toBe(reference.visible);
    expect(visible).toBeGreaterThan(0);
    // 70+ nested updates before the fix (React caps at 50).
    expect(steps).toBeLessThanOrEqual(4);
  });

  test("matches the one-per-step reference across sizes and widths", () => {
    // Deterministic pseudo-random chip widths.
    let seed = 42;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    for (const count of [1, 5, 50, 200]) {
      const chips = Array.from({ length: count }, () =>
        Math.round(30 + rand() * 150)
      );
      for (const width of [120, 250, 480, 900, 2000]) {
        const batch = converge(chips, width, batchStep);
        const reference = converge(chips, width, linearStep);
        expect(batch.visible).toBe(reference.visible);
        expect(batch.steps).toBeLessThanOrEqual(5);
      }
    }
  });
});
