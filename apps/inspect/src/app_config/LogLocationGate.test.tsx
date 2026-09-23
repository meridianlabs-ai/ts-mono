// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { AppConfigBootstrap } from "./appConfig";
import { LogLocationGate } from "./LogLocationGate";
import { LogLocationProposal } from "./logLocationTrust";

const bootstrap = vi.hoisted(
  (): { current: AppConfigBootstrap | undefined } => ({ current: undefined })
);
vi.mock("./appConfig", () => ({
  getBootstrap: () => bootstrap.current,
}));

const browserDirectBootstrap = (
  logLocationProposal?: LogLocationProposal
): AppConfigBootstrap => ({
  backend: {
    resolveLogRoot: () => Promise.resolve(undefined),
    createApi: () => {
      throw new Error("not under test");
    },
    capabilities: { downloadLogs: false, streamSamples: false },
    browserDirect: true,
  },
  singleFileMode: false,
  loader: "replicator",
  logLocationProposal,
});

afterEach(cleanup);

it("renders the app directly when nothing was proposed", () => {
  bootstrap.current = browserDirectBootstrap();
  render(
    <LogLocationGate>
      <div>app</div>
    </LogLocationGate>
  );
  expect(screen.getByText("app")).toBeInTheDocument();
  expect(screen.queryByTestId("log-location-gate")).not.toBeInTheDocument();
});

it("holds the app behind an approval that names the foreign origin", () => {
  bootstrap.current = browserDirectBootstrap({
    kind: "dir",
    location: "https://bucket.example/team/logs",
    origin: "https://bucket.example",
  });
  render(
    <LogLocationGate>
      <div>app</div>
    </LogLocationGate>
  );

  expect(screen.queryByText("app")).not.toBeInTheDocument();
  expect(
    screen.getByRole("heading", {
      name: "Open logs from https://bucket.example?",
    })
  ).toBeInTheDocument();
  expect(
    screen.getByText("https://bucket.example/team/logs")
  ).toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "Open" }));

  expect(screen.getByText("app")).toBeInTheDocument();
  expect(screen.queryByTestId("log-location-gate")).not.toBeInTheDocument();
});
