// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createTranscriptInfo } from "../../test/objectFactories";
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
    expect(screen.getByRole("status").textContent).toBe(
      "No transcripts directory configured."
    );
  });

  it("says the directory is empty when it has no transcripts", () => {
    renderEmptyGrid("/tmp/transcripts");
    expect(screen.getByRole("status").textContent).toBe(
      "No transcripts in this directory."
    );
  });

  it("says nothing matches when column filters exclude every transcript", () => {
    renderEmptyGrid("/tmp/transcripts", { filtered: true });
    expect(screen.getByRole("status").textContent).toBe(
      "No matching transcripts"
    );
  });

  it("says nothing matches when the project filter excludes every transcript", () => {
    renderEmptyGrid("/tmp/transcripts", { projectFiltered: true });
    expect(screen.getByRole("status").textContent).toBe(
      "No matching transcripts"
    );
  });
});

describe("TranscriptsGrid cells", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("gives each cell its full value as a tooltip", () => {
    // jsdom has no layout; give the virtualizer a viewport so rows render.
    vi.spyOn(Element.prototype, "clientHeight", "get").mockReturnValue(500);
    const { wrapper: Wrapper, store } = createTestWrapperWithStore();
    store.getState().setTranscriptsTableState((prev) => ({
      ...prev,
      visibleColumns: ["model", "metadata"],
    }));
    render(
      <Wrapper>
        <MemoryRouter>
          <TranscriptsGrid
            transcripts={[
              createTranscriptInfo({
                transcript_id: "t-1",
                model: "openai/gpt-4o",
                metadata: { epoch: 2 },
              }),
            ]}
            transcriptsDir="/tmp/transcripts"
            onScrollNearEnd={() => {}}
            hasMore={false}
            fetchThreshold={500}
          />
        </MemoryRouter>
      </Wrapper>
    );
    const titles = screen
      .getAllByRole("gridcell")
      .map((cell) => cell.getAttribute("title"));
    expect(titles).toEqual([
      "openai/gpt-4o",
      JSON.stringify({ epoch: 2 }, null, 2),
    ]);
  });
});

describe("TranscriptsGrid column order", () => {
  afterEach(cleanup);

  it("keeps a hidden column's place when the visible ones are reordered", async () => {
    const { wrapper: Wrapper, store } = createTestWrapperWithStore();
    store.getState().setTranscriptsTableState((prev) => ({
      ...prev,
      visibleColumns: ["task_id", "model"],
      columnOrder: ["task_id", "date", "model"],
    }));
    render(
      <Wrapper>
        <MemoryRouter>
          <TranscriptsGrid
            transcripts={[]}
            transcriptsDir="/tmp/transcripts"
            onScrollNearEnd={() => {}}
            hasMore={false}
            fetchThreshold={500}
          />
        </MemoryRouter>
      </Wrapper>
    );
    const header = (name: string) =>
      screen.getByRole("columnheader", { name: new RegExp(name) });
    const dataTransfer = { setData: () => {}, effectAllowed: "" };

    fireEvent.dragStart(
      within(header("Model")).getByRole("button", { name: /Model/ }),
      { dataTransfer }
    );
    // The grid marks the dragged column on the next tick.
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
    fireEvent.drop(header("Task ID"), { dataTransfer });

    expect(
      store.getState().transcriptsTableState.columnOrder.slice(0, 3)
    ).toEqual(["model", "task_id", "date"]);
  });
});
