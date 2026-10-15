// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

// The gate reads the session's bootstrap, resolved once from the page URL;
// each test opens the viewer at its own URL with a fresh module graph.
const renderGateAt = async (search: string) => {
  window.history.replaceState({}, "", `/${search}`);
  vi.resetModules();
  const { LogLocationGate } = await import("./LogLocationGate");
  render(
    <LogLocationGate>
      <div>app</div>
    </LogLocationGate>
  );
};

afterEach(() => {
  cleanup();
  window.history.replaceState({}, "", "/");
});

it("renders the app directly when nothing was proposed", async () => {
  await renderGateAt("?log_dir=logs");
  expect(screen.getByText("app")).toBeInTheDocument();
  expect(screen.queryByTestId("log-location-gate")).not.toBeInTheDocument();
});

it("refuses a location on another origin instead of rendering the app", async () => {
  await renderGateAt(
    `?log_dir=${encodeURIComponent("https://bucket.example/team/logs")}`
  );

  expect(screen.queryByText("app")).not.toBeInTheDocument();
  expect(
    screen.getByRole("heading", {
      name: "Can't open logs from https://bucket.example",
    })
  ).toBeInTheDocument();
  expect(
    screen.getByText("https://bucket.example/team/logs")
  ).toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Open" })
  ).not.toBeInTheDocument();
});
