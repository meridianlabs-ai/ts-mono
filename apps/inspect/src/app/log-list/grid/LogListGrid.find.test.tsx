import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { RefObject } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import type { LogsListingMatch } from "../../../log_data";

import type { LogListRow } from "./columns/types";
import { LogListGrid } from "./LogListGrid";

const holder = vi.hoisted(() => ({
  matches: [] as LogsListingMatch[],
  ensureOffsetLoaded: vi.fn(),
  openFind: undefined as (() => void) | undefined,
  patchGridState: vi.fn(),
}));

vi.mock("../../../state/hooks", () => ({
  useLogsListing: () => ({
    gridStateByScope: {},
    patchGridState: holder.patchGridState,
  }),
}));

vi.mock("@tsmono/react/hooks", () => ({
  useProperty: () => ["by-metric"],
}));

interface MockFindBandProps {
  inputRef: RefObject<HTMLInputElement | null>;
  value: string;
  onChange: () => void;
  onNext: () => void;
  matchCount?: number;
  matchIndex?: number;
  noResults?: boolean;
}

vi.mock("@tsmono/react/components", () => ({
  FindBandUI: ({
    inputRef,
    value,
    onChange,
    onNext,
    matchCount,
    matchIndex,
    noResults,
  }: MockFindBandProps) => (
    <div>
      <input
        aria-label="Find"
        ref={inputRef}
        value={value}
        onChange={onChange}
      />
      <button type="button" onClick={onNext}>
        Next
      </button>
      <span data-testid="match-state">
        {matchIndex}:{matchCount}
      </span>
      <span data-testid="no-results">{String(noResults)}</span>
    </div>
  ),
  useFindBandShortcut: (openFind: () => void) => {
    holder.openFind = openFind;
  },
}));

vi.mock("react-router-dom", () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock("./columns/hooks", () => ({
  useLogListColumns: () => ({
    columns: [
      {
        id: "name",
        header: "Name",
        accessorFn: (row: LogListRow) => row.name,
      },
    ],
    visibility: { name: true },
    getValue: (row: LogListRow, column: string) => row[column],
    getComparator: () => undefined,
    getFilterType: () => undefined,
    accessorsKey: "name:string",
  }),
}));

vi.mock("../listing/useLogsListingQuery", () => ({
  useLogsListingMatches: () => ({
    matches: holder.matches,
    settled: true,
    reset: vi.fn(),
  }),
}));

interface MockDataGridProps {
  selectedRowId?: string;
}

vi.mock("../../shared/data-grid/DataGrid", () => ({
  DataGrid: ({ selectedRowId }: MockDataGridProps) => (
    <div data-testid="selected-row">{selectedRowId}</div>
  ),
}));

afterEach(cleanup);

describe("LogListGrid Find pagination", () => {
  beforeEach(() => {
    holder.matches = [
      { id: "/logs/loaded.eval", offset: 0 },
      { id: "/logs/unloaded.eval", offset: 750 },
    ];
    holder.ensureOffsetLoaded.mockReset();
    holder.patchGridState.mockReset();
    holder.openFind = undefined;
  });

  const renderGrid = () => {
    const loadedRow: LogListRow = {
      id: "/logs/loaded.eval",
      name: "loaded.eval",
      type: "file",
    };
    return render(
      <LogListGrid
        rows={[loadedRow]}
        totalRowCount={2}
        sorting={[]}
        busy={false}
        listing={{
          logDir: "/logs",
          prefix: "/logs",
          universe: "logs::/logs",
          toRow: () => undefined,
        }}
        hasMoreRows
        fetchMoreRows={() => {}}
        ensureFileOffsetLoaded={holder.ensureOffsetLoaded}
        autoFetchPaused={false}
      />
    );
  };

  const openFind = () => {
    act(() => holder.openFind?.());
    fireEvent.change(screen.getByRole("textbox", { name: "Find" }), {
      target: { value: "needle" },
    });
  };

  test("loads a sole match outside the rendered page instead of reporting no results", async () => {
    holder.matches = [{ id: "/logs/unloaded.eval", offset: 750 }];
    renderGrid();
    openFind();

    await waitFor(() =>
      expect(holder.ensureOffsetLoaded).toHaveBeenCalledWith(750)
    );
    expect(screen.getByTestId("match-state")).toHaveTextContent("0:1");
    expect(screen.getByTestId("no-results")).toHaveTextContent("false");
    expect(screen.getByTestId("selected-row")).toHaveTextContent(
      "/logs/unloaded.eval"
    );
  });

  test("navigates the complete match list and loads an unloaded match's offset", async () => {
    renderGrid();

    openFind();

    await waitFor(() =>
      expect(holder.ensureOffsetLoaded).toHaveBeenCalledWith(0)
    );
    expect(screen.getByTestId("match-state")).toHaveTextContent("0:2");
    holder.ensureOffsetLoaded.mockClear();

    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    await waitFor(() =>
      expect(holder.ensureOffsetLoaded).toHaveBeenCalledWith(750)
    );
    expect(screen.getByTestId("match-state")).toHaveTextContent("1:2");
    expect(screen.getByTestId("selected-row")).toHaveTextContent(
      "/logs/unloaded.eval"
    );
  });
});
