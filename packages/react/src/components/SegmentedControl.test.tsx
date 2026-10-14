// @vitest-environment jsdom
import {
  cleanup,
  createEvent,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SegmentedControl, type Segment } from "./SegmentedControl";

afterEach(cleanup);

const renderControl = (segments: Segment[]) => {
  const onSegmentChange = vi.fn();
  render(
    <SegmentedControl
      segments={segments}
      selectedId="tasks"
      onSegmentChange={onSegmentChange}
    />
  );
  return { onSegmentChange };
};

const click = (el: HTMLElement, init: MouseEventInit) => {
  const event = createEvent.click(el, init);
  fireEvent(el, event);
  return event.defaultPrevented;
};

const linked: Segment[] = [
  { id: "tasks", label: "Tasks", href: "#/tasks/" },
  { id: "logs", label: "Folders", href: "#/logs/" },
  { id: "off", label: "Off", href: "#/off/", disabled: true },
];

describe("SegmentedControl links", () => {
  it("renders segments with an href as links, marking the current one", () => {
    renderControl(linked);
    const folders = screen.getByRole("link", { name: "Folders" });
    expect(folders.getAttribute("href")).toBe("#/logs/");
    expect(
      screen.getByRole("link", { name: "Tasks" }).getAttribute("aria-current")
    ).toBe("page");
    expect(folders.getAttribute("aria-current")).toBeNull();
  });

  it("keeps a disabled segment as a disabled button", () => {
    renderControl(linked);
    expect(screen.getByRole("button", { name: "Off" })).toHaveProperty(
      "disabled",
      true
    );
  });

  it("switches in place on a plain click", () => {
    const { onSegmentChange } = renderControl(linked);
    const folders = screen.getByRole("link", { name: "Folders" });
    expect(click(folders, { button: 0 })).toBe(true);
    expect(onSegmentChange).toHaveBeenCalledWith("logs", 1);
  });

  it("leaves cmd/ctrl-click to the browser", () => {
    const { onSegmentChange } = renderControl(linked);
    const folders = screen.getByRole("link", { name: "Folders" });
    expect(click(folders, { button: 0, metaKey: true })).toBe(false);
    expect(click(folders, { button: 0, ctrlKey: true })).toBe(false);
    expect(onSegmentChange).not.toHaveBeenCalled();
  });

  it("stays toggle buttons without hrefs", () => {
    renderControl([
      { id: "tasks", label: "Tasks" },
      { id: "logs", label: "Folders" },
    ]);
    expect(
      screen.getByRole("button", { name: "Tasks" }).getAttribute("aria-pressed")
    ).toBe("true");
  });
});
