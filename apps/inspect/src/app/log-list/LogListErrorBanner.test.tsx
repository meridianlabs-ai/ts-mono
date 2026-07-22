import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import { LogListErrorBanner } from "./LogListErrorBanner";

// Vitest globals aren't enabled in this app, so RTL's automatic afterEach
// cleanup never fires. Run it explicitly.
afterEach(cleanup);

test("announces the message and retries on click", () => {
  const onRetry = vi.fn();
  render(
    <LogListErrorBanner message="Sync failed — stale." onRetry={onRetry} />
  );

  expect(screen.getByRole("alert")).toHaveTextContent("Sync failed — stale.");
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(onRetry).toHaveBeenCalledTimes(1);
});
