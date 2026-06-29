// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TurnHeader } from "./TurnHeader";

afterEach(cleanup);

const baseProps = {
  turnNumber: 3,
  totalTurns: 8,
  onPrev: () => {},
  onNext: () => {},
  hasPrev: true,
  hasNext: true,
};

describe("TurnHeader go-to-turn", () => {
  it("Ctrl+G opens the turn-number editor (prefilled) and Enter jumps", () => {
    const onGoToTurn = vi.fn();
    render(<TurnHeader {...baseProps} onGoToTurn={onGoToTurn} />);

    expect(screen.queryByRole("textbox")).toBeNull();
    fireEvent.keyDown(document, { key: "g", ctrlKey: true });

    const input = screen.getByRole<HTMLInputElement>("textbox");
    expect(input.value).toBe("3"); // prefilled with the current turn
    fireEvent.change(input, { target: { value: "5" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onGoToTurn).toHaveBeenCalledWith(5);
  });

  it("Cmd+G works the same on macOS", () => {
    const onGoToTurn = vi.fn();
    render(<TurnHeader {...baseProps} onGoToTurn={onGoToTurn} />);
    fireEvent.keyDown(document, { key: "g", metaKey: true });
    expect(screen.getByRole("textbox")).toBeTruthy();
  });

  it("clicking the number opens the same editor (mouse path unchanged)", () => {
    render(<TurnHeader {...baseProps} onGoToTurn={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "3" }));
    expect(screen.getByRole("textbox")).toBeTruthy();
  });

  it("ignores Ctrl+G while the user is typing in another field", () => {
    render(
      <>
        <input data-testid="other" />
        <TurnHeader {...baseProps} onGoToTurn={() => {}} />
      </>
    );
    const other = screen.getByTestId("other");
    other.focus();
    fireEvent.keyDown(other, { key: "g", ctrlKey: true });
    // editor did not open: the only textbox is the unrelated input
    expect(screen.getAllByRole("textbox")).toHaveLength(1);
  });
});
