// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it } from "vitest";

import { createTestWrapperWithStore } from "../../test/test-utils";

import { TranscriptsGrid } from "./TranscriptsGrid";

const renderEmptyGrid = (
  transcriptsDir: string,
  {
    filtered = false,
    projectFiltered = false,
  }: { filtered?: boolean; projectFiltered?: boolean } = {}
) => {
  const { wrapper: Wrapper, store } = createTestWrapperWithStore();
  if (filtered) {
    store.getState().setTranscriptsTableState((prev) => ({
      ...prev,
      columnFilters: {
        model: {
          columnId: "model",
          filterType: "string",
          spec: { operator: "=", value: "gpt-4" },
        },
      },
    }));
  }
  render(
    <Wrapper>
      <MemoryRouter>
        <TranscriptsGrid
          transcripts={[]}
          transcriptsDir={transcriptsDir}
          projectFiltered={projectFiltered}
          onScrollNearEnd={() => {}}
          hasMore={false}
          fetchThreshold={500}
        />
      </MemoryRouter>
    </Wrapper>
  );
};

describe("TranscriptsGrid empty state", () => {
  afterEach(cleanup);

  it("says no directory is configured when there is none", () => {
    renderEmptyGrid("");
    expect(
      screen.getByText("No transcripts directory configured.")
    ).toBeTruthy();
  });

  it("says the directory is empty when it has no transcripts", () => {
    renderEmptyGrid("/tmp/transcripts");
    expect(screen.getByText("No transcripts in this directory.")).toBeTruthy();
  });

  it("says nothing matches when column filters exclude every transcript", () => {
    renderEmptyGrid("/tmp/transcripts", { filtered: true });
    expect(screen.getByText("No matching transcripts")).toBeTruthy();
  });

  it("says nothing matches when the project filter excludes every transcript", () => {
    renderEmptyGrid("/tmp/transcripts", { projectFiltered: true });
    expect(screen.getByText("No matching transcripts")).toBeTruthy();
  });
});
