// @vitest-environment jsdom
import {
  cleanup,
  createEvent,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, onTestFinished, vi } from "vitest";

import { OpenSampleLink, type SampleOpener } from "./OpenSampleLink";

afterEach(cleanup);

const renderLink = () => {
  const opener: SampleOpener = {
    href: (id, epoch) => `/#/logs/a.eval/samples/sample/${id}/${epoch}`,
    open: vi.fn(),
  };
  render(
    <OpenSampleLink
      opener={opener}
      sample={{ id: 3, epoch: 1 }}
      className="open"
      stopPropagation
    >
      open →
    </OpenSampleLink>
  );
  // Stands in for the clickable history row around the link: a listener
  // above React's root only fires if the click's propagation isn't stopped.
  const onRowClick = vi.fn();
  document.addEventListener("click", onRowClick);
  onTestFinished(() => document.removeEventListener("click", onRowClick));
  return { link: screen.getByRole("link"), opener, onRowClick };
};

const click = (el: HTMLElement, init: MouseEventInit) => {
  const event = createEvent.click(el, init);
  fireEvent(el, event);
  return event.defaultPrevented;
};

describe("OpenSampleLink", () => {
  it("links to the sample", () => {
    expect(renderLink().link).toHaveAttribute(
      "href",
      "/#/logs/a.eval/samples/sample/3/1"
    );
  });

  it("opens the sample in place on a plain click, without activating the row", () => {
    const { link, opener, onRowClick } = renderLink();
    expect(click(link, { button: 0 })).toBe(true);
    expect(opener.open).toHaveBeenCalledWith(3, 1);
    expect(onRowClick).not.toHaveBeenCalled();
  });

  it("leaves cmd/ctrl-click to the browser", () => {
    const { link, opener, onRowClick } = renderLink();
    expect(click(link, { button: 0, metaKey: true })).toBe(false);
    expect(click(link, { button: 0, ctrlKey: true })).toBe(false);
    expect(opener.open).not.toHaveBeenCalled();
    expect(onRowClick).not.toHaveBeenCalled();
  });
});
