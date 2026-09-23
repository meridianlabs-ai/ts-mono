// @vitest-environment jsdom
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

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

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
});

it("stays usable when the clipboard write is refused", async () => {
  writeText.mockRejectedValue(new Error("denied"));
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  render(<CopyJsonButton json="{}" />);

  fireEvent.click(screen.getByRole("button", { name: /Copy JSON/ }));
  await act(async () => {
    await Promise.resolve();
  });

  expect(error).toHaveBeenCalled();
  expect(screen.getByRole("button", { name: /Copy JSON/ })).toBeEnabled();
});

it("warns instead of throwing when there is no clipboard (insecure context)", async () => {
  Object.defineProperty(navigator, "clipboard", {
    value: undefined,
    configurable: true,
  });
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  render(<CopyJsonButton json="{}" />);

  expect(() =>
    fireEvent.click(screen.getByRole("button", { name: /Copy JSON/ }))
  ).not.toThrow();
  await act(async () => {
    await Promise.resolve();
  });

  expect(error).toHaveBeenCalled();
  expect(screen.getByRole("button", { name: /Copy JSON/ })).toBeEnabled();
});
