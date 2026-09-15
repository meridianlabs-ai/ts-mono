import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { CopyJsonButton } from "./JsonTab";

const writeText = vi.fn<(text: string) => Promise<void>>();

beforeEach(() => {
  writeText.mockReset().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText },
    configurable: true,
  });
});

afterEach(cleanup);

it("copies the JSON it was given and shows transient feedback", async () => {
  vi.useFakeTimers();
  render(<CopyJsonButton json='{"eval": 1}' />);

  fireEvent.click(screen.getByRole("button", { name: /Copy JSON/ }));
  await act(async () => {
    await Promise.resolve();
  });

  expect(writeText).toHaveBeenCalledWith('{"eval": 1}');
  expect(screen.getByRole("button", { name: /Copied!/ })).toBeDisabled();

  act(() => {
    vi.advanceTimersByTime(1500);
  });
  expect(screen.getByRole("button", { name: /Copy JSON/ })).toBeEnabled();
  vi.useRealTimers();
});

it("stays usable when the clipboard write is refused", async () => {
  writeText.mockRejectedValue(new Error("denied"));
  vi.spyOn(console, "warn").mockImplementation(() => {});
  render(<CopyJsonButton json="{}" />);

  fireEvent.click(screen.getByRole("button", { name: /Copy JSON/ }));
  await act(async () => {
    await Promise.resolve();
  });

  expect(screen.getByRole("button", { name: /Copy JSON/ })).toBeEnabled();
});
