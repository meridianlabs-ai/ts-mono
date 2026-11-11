// @vitest-environment jsdom
import { act, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { AnchoredPopover } from "./AnchoredPopover";

const Harness = ({
  onClose = () => {},
  initiallyOpen = true,
}: {
  onClose?: () => void;
  initiallyOpen?: boolean;
}) => {
  const [open, setOpen] = useState(initiallyOpen);
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  return (
    <>
      <button ref={setAnchor} onClick={() => setOpen((v) => !v)}>
        Trigger
      </button>
      <AnchoredPopover
        open={open}
        anchor={anchor}
        onClose={() => {
          onClose();
          setOpen(false);
        }}
        role="dialog"
        aria-label="Panel"
      >
        <button>Inside</button>
      </AnchoredPopover>
    </>
  );
};

const toggleEvent = (newState: "open" | "closed") =>
  Object.assign(new Event("toggle"), { newState, oldState: "open" });

describe("AnchoredPopover", () => {
  it("renders its content only while open", () => {
    render(<Harness initiallyOpen={false} />);
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Trigger" }));
    expect(screen.getByRole("button", { name: "Inside" })).toBeDefined();
  });

  it("anchors to the trigger by a CSS anchor name, and releases it on close", () => {
    render(<Harness initiallyOpen={false} />);
    const trigger = screen.getByRole("button", { name: "Trigger" });
    trigger.style.setProperty("anchor-name", "--existing");
    fireEvent.click(trigger);
    const name = trigger.style
      .getPropertyValue("anchor-name")
      .split(", ")
      .find((n) => n !== "--existing");
    expect(name).toMatch(/^--popover-anchor-/);
    expect(
      screen.getByRole("dialog").style.getPropertyValue("position-anchor")
    ).toBe(name);
    fireEvent.click(trigger);
    expect(trigger.style.getPropertyValue("anchor-name")).toBe("--existing");
  });

  it("reports a browser-initiated close (light dismiss, Escape)", () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    act(() => {
      screen.getByRole("dialog").dispatchEvent(toggleEvent("closed"));
    });
    expect(onClose).toHaveBeenCalledOnce();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("returns focus to the trigger when it closes with focus inside", () => {
    render(<Harness />);
    screen.getByRole("button", { name: "Inside" }).focus();
    fireEvent.click(screen.getByRole("button", { name: "Trigger" }));
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Trigger" })
    );
  });
});
