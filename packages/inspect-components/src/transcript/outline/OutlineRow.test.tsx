// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { OutlineLoadingRow } from "./OutlineRow";
import styles from "./OutlineRow.module.css";

describe("OutlineLoadingRow", () => {
  afterEach(() => cleanup());

  it("renders a row-shaped loading affordance with a spinner and label", () => {
    const { container } = render(<OutlineLoadingRow />);
    expect(screen.getByText("loading")).toBeDefined();
    // Uses the outline row layout so it reads as the next item in the tree.
    expect(container.querySelector(`.${styles.eventRow}`)).not.toBeNull();
    expect(container.querySelector(`.${styles.spinner}`)).not.toBeNull();
  });

  it("exposes a polite live-region status", () => {
    const { container } = render(<OutlineLoadingRow />);
    const status = container.querySelector('[role="status"]');
    expect(status).not.toBeNull();
    expect(status!.getAttribute("aria-live")).toBe("polite");
  });
});
