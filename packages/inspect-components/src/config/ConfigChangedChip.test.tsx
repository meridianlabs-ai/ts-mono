// @vitest-environment jsdom
import {
  cleanup,
  createEvent,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TimelineLink } from "./ConfigChangedChip";

afterEach(cleanup);

const click = (el: HTMLElement, init: MouseEventInit) => {
  const event = createEvent.click(el, init);
  fireEvent(el, event);
  return event.defaultPrevented;
};

describe("TimelineLink", () => {
  it("links to the timeline when given its URL", () => {
    render(<TimelineLink onClick={vi.fn()} href="#/logs/a.eval/timeline" />);
    const link = screen.getByRole("link", { name: "View on timeline" });
    expect(link.getAttribute("href")).toBe("#/logs/a.eval/timeline");
  });

  it("shows the timeline in place on a plain click", () => {
    const onClick = vi.fn();
    render(<TimelineLink onClick={onClick} href="#/logs/a.eval/timeline" />);
    const link = screen.getByRole("link", { name: "View on timeline" });
    expect(click(link, { button: 0 })).toBe(true);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("leaves cmd/ctrl-click to the browser", () => {
    const onClick = vi.fn();
    render(<TimelineLink onClick={onClick} href="#/logs/a.eval/timeline" />);
    const link = screen.getByRole("link", { name: "View on timeline" });
    expect(click(link, { button: 0, metaKey: true })).toBe(false);
    expect(click(link, { button: 0, ctrlKey: true })).toBe(false);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("is a button without a URL", () => {
    const onClick = vi.fn();
    render(<TimelineLink onClick={onClick} />);
    fireEvent.click(screen.getByRole("button", { name: "View on timeline" }));
    expect(onClick).toHaveBeenCalledOnce();
  });
});
