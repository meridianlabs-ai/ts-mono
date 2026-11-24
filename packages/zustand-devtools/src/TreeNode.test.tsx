// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TreeNode } from "./TreeNode";
import styles from "./TreeNode.module.css";

afterEach(cleanup);

function setup(value: unknown) {
  const view = render(<TreeNode name="value" value={value} />);
  const node = () => {
    const element = view.container.querySelector(`.${styles.value}`);
    if (!element) throw new Error("Value span missing");
    return element;
  };
  return {
    node,
    update: (next: unknown) =>
      view.rerender(<TreeNode name="value" value={next} />),
  };
}

describe("TreeNode change animation", () => {
  it("does not flash an ordinary initial value", () => {
    expect(setup(1).node().classList.contains(styles.flash)).toBe(false);
  });

  it("remounts the animated value for each distinct value", () => {
    const { node, update } = setup(1);
    const first = node();
    update(2);
    const second = node();
    expect(second).not.toBe(first);
    expect(second.classList.contains(styles.flash)).toBe(true);
    update(3);
    expect(node()).not.toBe(second);
    expect(node().textContent).toBe("3");
  });

  it("keeps the same value node when re-rendering an unchanged reference", () => {
    const { node } = setup({ child: 1 });
    const first = node();
    fireEvent.click(screen.getByRole("button", { name: "value:" }));
    expect(node()).toBe(first);
    expect(node().classList.contains(styles.flash)).toBe(false);
  });

  it("does not flash or remount between signed zeros", () => {
    const { node, update } = setup(0);
    const first = node();
    update(-0);
    expect(node()).toBe(first);
    update(0);
    expect(node()).toBe(first);
    expect(node().classList.contains(styles.flash)).toBe(false);
  });

  it("does not flash an initial NaN", () => {
    expect(setup(NaN).node().classList.contains(styles.flash)).toBe(false);
  });

  it("restarts flash when entering or leaving NaN", () => {
    const { node, update } = setup(1);
    const first = node();
    update(NaN);
    const nan = node();
    expect(nan).not.toBe(first);
    update(NaN);
    expect(node()).toBe(nan);
    update(2);
    expect(node()).not.toBe(nan);
  });

  it("flashes changed function values without calling them", () => {
    const first = vi.fn();
    const second = vi.fn();
    const { node, update } = setup(first);
    const initial = node();
    update(second);
    expect(node()).not.toBe(initial);
    expect(node().classList.contains(styles.flash)).toBe(true);
    expect(first).not.toHaveBeenCalled();
    expect(second).not.toHaveBeenCalled();
  });

  it("preserves expanded children while the parent value changes", () => {
    const nested = { leaf: "unchanged" };
    const { update } = setup({ nested, other: 1 });
    fireEvent.click(screen.getByRole("button", { name: "value:" }));
    fireEvent.click(screen.getByRole("button", { name: "nested:" }));
    update({ nested, other: 2 });
    expect(
      screen
        .getByRole("button", { name: "nested:" })
        .getAttribute("aria-expanded")
    ).toBe("true");
    expect(screen.getByText('"unchanged"')).toBeTruthy();
  });
});
