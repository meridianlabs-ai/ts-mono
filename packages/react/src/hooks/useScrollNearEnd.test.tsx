// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useScrollNearEnd } from "./useScrollNearEnd";

afterEach(cleanup);

interface Geometry {
  scrollHeight: number;
  clientHeight: number;
  scrollTop: number;
}

/** jsdom has no layout: give the scroll element fixed geometry. */
const setGeometry = (el: HTMLElement, geometry: Geometry) => {
  for (const [key, value] of Object.entries(geometry)) {
    Object.defineProperty(el, key, { value, configurable: true });
  }
};

const Scroller = ({
  enabled,
  contentKey,
  onNearEnd,
  geometry,
}: {
  enabled: boolean;
  contentKey: number;
  onNearEnd: (distance: number) => void;
  geometry: Geometry;
}) => {
  const ref = useRef<HTMLDivElement>(null);
  useScrollNearEnd(ref, { enabled, threshold: 100, contentKey, onNearEnd });
  return (
    <div
      data-testid="scroller"
      ref={(el) => {
        ref.current = el;
        if (el) setGeometry(el, geometry);
      }}
    />
  );
};

const far = { scrollHeight: 1000, clientHeight: 200, scrollTop: 0 };
const near = { scrollHeight: 1000, clientHeight: 200, scrollTop: 750 };

describe("useScrollNearEnd", () => {
  it("reports the distance left when a scroll lands within the threshold", () => {
    const onNearEnd = vi.fn();
    const { getByTestId } = render(
      <Scroller enabled contentKey={0} onNearEnd={onNearEnd} geometry={far} />
    );
    expect(onNearEnd).not.toHaveBeenCalled();
    const el = getByTestId("scroller");
    setGeometry(el, near);
    fireEvent.scroll(el);
    expect(onNearEnd).toHaveBeenCalledWith(50);
  });

  it("stays quiet when disabled", () => {
    const onNearEnd = vi.fn();
    const { getByTestId } = render(
      <Scroller
        enabled={false}
        contentKey={0}
        onNearEnd={onNearEnd}
        geometry={near}
      />
    );
    fireEvent.scroll(getByTestId("scroller"));
    expect(onNearEnd).not.toHaveBeenCalled();
  });

  it("checks again when the content changes without a scroll", () => {
    const onNearEnd = vi.fn();
    const props = { enabled: true, onNearEnd, geometry: near };
    const { rerender } = render(<Scroller {...props} contentKey={0} />);
    // Already near the end on mount, e.g. a first page shorter than the view.
    expect(onNearEnd).toHaveBeenCalledTimes(1);
    rerender(<Scroller {...props} contentKey={0} />);
    expect(onNearEnd).toHaveBeenCalledTimes(1);
    rerender(<Scroller {...props} contentKey={1} />);
    expect(onNearEnd).toHaveBeenCalledTimes(2);
  });
});
