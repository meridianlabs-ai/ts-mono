// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { FC } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useFindBandShortcut } from "./useFindBandShortcut";

const Harness: FC<{
  onOpen: () => void;
  onClose?: () => void;
  enabled?: boolean;
}> = ({ onOpen, onClose, enabled }) => {
  useFindBandShortcut(onOpen, { onClose, enabled });
  return null;
};

describe("useFindBandShortcut", () => {
  afterEach(cleanup);

  it.each([
    { key: "f", metaKey: true },
    { key: "f", ctrlKey: true },
    { key: "F", metaKey: true }, // CapsLock
  ])("opens on Ctrl/Cmd+F ($key)", ({ key, metaKey, ctrlKey }) => {
    const onOpen = vi.fn();
    render(<Harness onOpen={onOpen} />);

    const bubbled = fireEvent.keyDown(document.body, {
      key,
      metaKey,
      ctrlKey,
    });

    expect(onOpen).toHaveBeenCalledOnce();
    // preventDefault called → browser find blocked
    expect(bubbled).toBe(false);
  });

  it("closes on Escape when onClose is provided", () => {
    const onOpen = vi.fn();
    const onClose = vi.fn();
    render(<Harness onOpen={onOpen} onClose={onClose} />);

    fireEvent.keyDown(document.body, { key: "Escape" });

    expect(onClose).toHaveBeenCalledOnce();
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("ignores Escape without onClose", () => {
    const onOpen = vi.fn();
    render(<Harness onOpen={onOpen} />);

    expect(() =>
      fireEvent.keyDown(document.body, { key: "Escape" })
    ).not.toThrow();
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("does nothing when disabled", () => {
    const onOpen = vi.fn();
    const onClose = vi.fn();
    render(<Harness onOpen={onOpen} onClose={onClose} enabled={false} />);

    fireEvent.keyDown(document.body, { key: "f", metaKey: true });
    fireEvent.keyDown(document.body, { key: "Escape" });

    expect(onOpen).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("ignores plain f without a modifier", () => {
    const onOpen = vi.fn();
    render(<Harness onOpen={onOpen} />);

    fireEvent.keyDown(document.body, { key: "f" });

    expect(onOpen).not.toHaveBeenCalled();
  });
});
