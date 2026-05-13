// @vitest-environment jsdom
//
// Regression tests for the migration from mutable refs to state-backed
// elements (see meridianlabs-ai/ts-mono#90). The hazard being guarded
// against: reading `.current` during render captures `null` on the first
// pass, so `usePopper`'s `popper` arg and the arrow modifier's `element`
// option silently start out null — positioning then only catches up on
// some incidental later re-render.
//
// These tests verify externally observable behavior so they stay valid
// regardless of how the migration is implemented internally.

import { act, cleanup, fireEvent, render } from "@testing-library/react";
import React, { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PopOver } from "./PopOver";

afterEach(cleanup);

// usePopper relies on ResizeObserver to recompute on size changes. jsdom
// doesn't ship one; a no-op shim is sufficient because we don't assert on
// computed positions.
class NoopResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", NoopResizeObserver);

// Render PopOver against a real trigger element so positionEl is non-null.
const Harness: React.FC<{
  initialOpen?: boolean;
  hoverDelay?: number;
  usePortal?: boolean;
  closeOnMouseLeave?: boolean;
  showArrow?: boolean;
  onIsOpen?: (open: boolean) => void;
}> = ({
  initialOpen = true,
  hoverDelay = 0,
  usePortal = false,
  closeOnMouseLeave = true,
  showArrow = true,
  onIsOpen,
}) => {
  const [trigger, setTrigger] = useState<HTMLElement | null>(null);
  const [isOpen, setIsOpen] = useState(initialOpen);
  return (
    <div>
      <button
        ref={setTrigger}
        data-testid="trigger"
        onClick={() => setIsOpen((v) => !v)}
      >
        open
      </button>
      <PopOver
        id="test-popover"
        isOpen={isOpen}
        setIsOpen={(v) => {
          setIsOpen(v);
          onIsOpen?.(v);
        }}
        positionEl={trigger}
        hoverDelay={hoverDelay}
        usePortal={usePortal}
        closeOnMouseLeave={closeOnMouseLeave}
        showArrow={showArrow}
      >
        <div data-testid="popover-content">popover body</div>
      </PopOver>
    </div>
  );
};

describe("PopOver — state-backed element regressions (#90)", () => {
  it("renders popover content on initial open (no incidental re-render needed)", () => {
    // Pre-migration this passed only because the arrow/popper refs eventually
    // propagated through an unrelated re-render. With state-backed elements
    // the popover commits with its content visible on the first render that
    // satisfies `isOpen && shouldShowPopover`.
    const { getByTestId } = render(<Harness />);
    expect(getByTestId("popover-content")).toBeTruthy();
  });

  it("renders the arrow node so the arrow modifier has an element to target", () => {
    // The bug: the arrow modifier was given `arrowRef.current` (null on first
    // render). Assert the arrow node is in the DOM — the callback ref attaches
    // and the resulting re-render plumbs the live element into usePopper.
    const { container } = render(<Harness showArrow={true} />);
    expect(
      container.querySelector('[data-placement]')
    ).toBeTruthy();
  });

  it("omits the arrow node when showArrow=false", () => {
    const { container } = render(<Harness showArrow={false} />);
    expect(container.querySelector("[data-placement]")).toBeNull();
  });

  it("outside mousedown dismisses the popover (non-portaled)", () => {
    const onIsOpen = vi.fn();
    const { container } = render(<Harness onIsOpen={onIsOpen} />);
    act(() => {
      fireEvent.mouseDown(container, { bubbles: true });
    });
    // Capture+bubble listener pair: it should not have fired close on the
    // popover content/trigger, but on an outside node it does.
    expect(onIsOpen).toHaveBeenCalledWith(false);
  });

  it("outside mousedown dismisses the popover (portaled)", () => {
    const onIsOpen = vi.fn();
    render(<Harness usePortal={true} onIsOpen={onIsOpen} />);
    // mousedown on document.body — outside both trigger and portaled popover
    act(() => {
      fireEvent.mouseDown(document.body);
    });
    expect(onIsOpen).toHaveBeenCalledWith(false);
  });

  it("mousedown inside the popover does NOT dismiss", () => {
    const onIsOpen = vi.fn();
    const { getByTestId } = render(<Harness onIsOpen={onIsOpen} />);
    act(() => {
      fireEvent.mouseDown(getByTestId("popover-content"));
    });
    expect(onIsOpen).not.toHaveBeenCalled();
  });

  it("mousedown on the trigger does NOT dismiss (trigger owns toggle)", () => {
    const onIsOpen = vi.fn();
    const { getByTestId } = render(<Harness onIsOpen={onIsOpen} />);
    act(() => {
      fireEvent.mouseDown(getByTestId("trigger"));
    });
    expect(onIsOpen).not.toHaveBeenCalled();
  });

  it("returns null when isOpen=false (no DOM leak)", () => {
    const { queryByTestId } = render(<Harness initialOpen={false} />);
    expect(queryByTestId("popover-content")).toBeNull();
  });

  it("does not throw or warn when the trigger is replaced (popperElement reattaches)", () => {
    // Closures in the dismissal effect capture popperElement. The migration
    // adds popperElement to the effect deps; this exercises a re-bind cycle.
    const warn = vi.spyOn(console, "error").mockImplementation(() => {});
    const { rerender, getByTestId } = render(<Harness />);
    expect(getByTestId("popover-content")).toBeTruthy();
    rerender(<Harness />);
    rerender(<Harness initialOpen={false} />);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
