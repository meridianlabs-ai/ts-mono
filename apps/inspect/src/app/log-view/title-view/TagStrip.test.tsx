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

import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";

import { TagStrip } from "./TagStrip";

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
      <TagStrip
        tags={["alpha", "beta", "gamma"]}
        showEdit
        onEdit={() => {}}
      />
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
      <TagStrip
        tags={["one", "two", "three"]}
        showEdit
        onEdit={() => {}}
      />
    );

    const tagRow = container.querySelector<HTMLElement>(".tagRow");
    expect(tagRow).not.toBeNull();
    for (const label of ["one", "two", "three"]) {
      expect(within(tagRow!).getByText(label)).toBeInTheDocument();
    }
    // Exactly one button (the Edit pill).
    expect(within(tagRow!).getAllByRole("button")).toHaveLength(1);
  });

  test("Edit button still renders when there are no tags", () => {
    render(<TagStrip tags={[]} showEdit onEdit={() => {}} />);
    // With no chips present, the button labels itself ("Tags") so the
    // pill makes sense in isolation.
    const btn = screen.getByTitle("Edit tags");
    expect(btn).toBeInTheDocument();
    expect(btn.textContent).toMatch(/Tags/);
  });

  test("renders nothing when there are no tags and no edit affordance", () => {
    const { container } = render(
      <TagStrip tags={[]} showEdit={false} onEdit={() => {}} />
    );
    expect(container).toBeEmptyDOMElement();
  });
});
