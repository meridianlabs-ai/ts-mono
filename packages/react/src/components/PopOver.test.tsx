// @vitest-environment jsdom
import { act, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PopOver } from "./PopOver";

const HoverCard = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [chip, setChip] = useState<HTMLElement | null>(null);
  return (
    <>
      <span ref={setChip} onMouseEnter={() => setIsOpen(true)}>
        Chip
      </span>
      <PopOver
        id="card"
        isOpen={isOpen}
        setIsOpen={setIsOpen}
        positionEl={chip}
        hoverDelay={200}
      >
        <span>Card body</span>
      </PopOver>
      <p>Elsewhere</p>
    </>
  );
};

const advance = (ms: number) => {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
};
const card = () => screen.queryByText("Card body");
// A browser fires mouseenter/mouseleave on the popover element itself.
const cardPopover = () => {
  const popover = screen.getByText("Card body").closest("[popover]");
  if (!popover) throw new Error("no popover");
  return popover;
};

describe("PopOver hover card", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("shows once the pointer rests on the trigger, restarting on movement", () => {
    render(<HoverCard />);
    const chip = screen.getByText("Chip");
    fireEvent.mouseEnter(chip);
    advance(150);
    fireEvent.mouseMove(chip);
    advance(150);
    expect(card()).toBeNull();
    advance(50);
    expect(card()).not.toBeNull();
  });

  it("hides after leaving the trigger, unless the pointer moves onto the card", () => {
    render(<HoverCard />);
    const chip = screen.getByText("Chip");
    fireEvent.mouseEnter(chip);
    advance(200);
    fireEvent.mouseLeave(chip);
    advance(100);
    fireEvent.mouseEnter(cardPopover());
    advance(1000);
    expect(card()).not.toBeNull();

    fireEvent.mouseLeave(cardPopover());
    expect(card()).toBeNull();

    fireEvent.mouseEnter(chip);
    advance(200);
    fireEvent.mouseLeave(chip);
    advance(300);
    expect(card()).toBeNull();
  });

  it("hides on a press outside it, not on one inside", () => {
    render(<HoverCard />);
    fireEvent.mouseEnter(screen.getByText("Chip"));
    advance(200);
    fireEvent.mouseDown(screen.getByText("Card body"));
    expect(card()).not.toBeNull();
    fireEvent.mouseDown(screen.getByText("Elsewhere"));
    expect(card()).toBeNull();
  });
});
