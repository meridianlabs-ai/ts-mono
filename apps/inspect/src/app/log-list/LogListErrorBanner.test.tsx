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

test("surfaces the failure detail beside the headline", () => {
  // The headline says which data may be stale; the detail carries the
  // actual failure text (the cold-state ErrorPanel shows message+stack,
  // and the warm banner must not swallow it entirely).
  render(
    <LogListErrorBanner
      message="Couldn't refresh the log listing — showing the last loaded rows."
      detail="InvalidStateError: database is closing"
      onRetry={() => {}}
    />
  );

  expect(screen.getByRole("alert")).toHaveTextContent(
    "InvalidStateError: database is closing"
  );
});
