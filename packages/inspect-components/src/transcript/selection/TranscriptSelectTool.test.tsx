// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TranscriptSelectTool } from "./TranscriptSelectTool";

afterEach(cleanup);

describe("TranscriptSelectTool", () => {
  it("renders a plain Select toggle when the mode is off", () => {
    const onToggle = vi.fn();
    render(
      <TranscriptSelectTool
        active={false}
        count={0}
        onToggle={onToggle}
        onClear={() => {}}
      />
    );
    const button = screen.getByRole("button", { name: "Select" });
    expect(button.getAttribute("aria-pressed")).toBe("false");
    expect(
      screen.queryByRole("button", { name: "Clear selection and exit" })
    ).toBeNull();
    fireEvent.click(button);
    expect(onToggle).toHaveBeenCalledOnce();
  });

  it("latches without a count while nothing is selected", () => {
    render(
      <TranscriptSelectTool
        active={true}
        count={0}
        onToggle={() => {}}
        onClear={() => {}}
      />
    );
    const button = screen.getByRole("button", { name: "Select" });
    expect(button.getAttribute("aria-pressed")).toBe("true");
    expect(button.title).toContain("Click events to select");
    expect(
      screen.queryByRole("button", { name: "Clear selection and exit" })
    ).toBeNull();
  });

  it("splits into a count and a clear segment once events are selected", () => {
    const onToggle = vi.fn();
    const onClear = vi.fn();
    render(
      <TranscriptSelectTool
        active={true}
        count={3}
        onToggle={onToggle}
        onClear={onClear}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Select · 3" }));
    expect(onToggle).toHaveBeenCalledOnce();
    fireEvent.click(
      screen.getByRole("button", { name: "Clear selection and exit" })
    );
    expect(onClear).toHaveBeenCalledOnce();
  });
});
