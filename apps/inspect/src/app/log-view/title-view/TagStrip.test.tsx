/**
 * Regression: the Edit button used to live inside the wrap-aware
 * `.tagRow` container. When chips wrapped onto a second line, the
 * Edit button wrapped with them (it's the last flex item) and ended
 * up on its own row below the chips — out of reach if the user's
 * window was tight enough to push chips past the first row.
 *
 * Fix: pull Edit out of `.tagRow` and render it as a flex *sibling*
 * inside the bodyContainer. `.tagRow` still wraps its chips
 * internally, but Edit stays anchored beside the chip block,
 * vertically centered against whatever height the wrapped chips
 * take.
 */

import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";

import { TagStrip } from "./TagStrip";

// Vitest globals aren't enabled in this app, so RTL's automatic
// afterEach cleanup hook never fires. Run it explicitly so each test
// starts with a fresh document.
afterEach(cleanup);

describe("TagStrip", () => {
  test("renders the Edit button as a sibling of the wrap-aware tagRow, not a descendant", () => {
    render(
      <TagStrip
        tags={["alpha", "beta", "gamma", "delta"]}
        showEdit
        onEdit={() => {}}
      />
    );

    const edit = screen.getByRole("button", { name: /edit/i });
    // The wrap-aware container has `flex-wrap: wrap`; if Edit is nested
    // inside it, it wraps to a new line with the trailing chips.
    expect(edit.closest(".tagRow")).toBeNull();
  });

  test("the tagRow contains every chip and only chips", () => {
    const { container } = render(
      <TagStrip
        tags={["one", "two", "three"]}
        showEdit
        onEdit={() => {}}
      />
    );

    const tagRow = container.querySelector<HTMLElement>(".tagRow");
    expect(tagRow).not.toBeNull();
    // Each tag is rendered (label is the visible text).
    for (const label of ["one", "two", "three"]) {
      expect(within(tagRow!).getByText(label)).toBeInTheDocument();
    }
    // The Edit button is not in the tagRow.
    expect(within(tagRow!).queryByRole("button")).toBeNull();
  });

  test("Edit button still renders when there are no tags", () => {
    render(<TagStrip tags={[]} showEdit onEdit={() => {}} />);
    expect(screen.getByRole("button", { name: /edit/i })).toBeInTheDocument();
  });

  test("renders nothing when there are no tags and no edit affordance", () => {
    const { container } = render(
      <TagStrip tags={[]} showEdit={false} onEdit={() => {}} />
    );
    expect(container).toBeEmptyDOMElement();
  });
});
