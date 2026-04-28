import type { ColDef, GridApi, GridState } from "ag-grid-community";
import { AgGridReact } from "ag-grid-react";
import { FC, RefObject, useCallback, useEffect, useMemo } from "react";

import { useClientEvents } from "../../../state/clientEvents";
import { useStore } from "../../../state/store";
import { useSamplesGridNavigation } from "../../routing/sampleNavigation";
import {
  SamplesGrid as SharedSamplesGrid,
  type SamplesGridViewMode,
} from "../../shared/samples-grid/SamplesGrid";
import { DisplayedSample } from "../../types";

import { SampleRow } from "./types";

interface SamplesGridProps {
  items: SampleRow[];
  samplesPath?: string;
  gridRef?: RefObject<AgGridReact<SampleRow> | null>;
  columns: ColDef<SampleRow>[];
}

const sampleRowId = (logFile: string, sampleId: string | number, epoch: number) =>
  `${logFile}-${sampleId}-${epoch}`.replace(/\s+/g, "_");

const gridDisplayedSamples = (api: GridApi<SampleRow>): DisplayedSample[] => {
  const out: DisplayedSample[] = [];
  const count = api.getDisplayedRowCount();
  for (let i = 0; i < count; i++) {
    const node = api.getDisplayedRowAtIndex(i);
    if (node?.data) {
      out.push({
        logFile: node.data.logFile,
        sampleId: node.data.sampleId,
        epoch: node.data.epoch,
      });
    }
  }
  return out;
};

const kViewMode: SamplesGridViewMode = "grid";

export const SamplesGrid: FC<SamplesGridProps> = ({
  items,
  samplesPath,
  gridRef,
  columns,
}) => {
  const gridState = useStore((state) => state.logs.samplesListState.gridState);
  const setGridState = useStore((state) => state.logsActions.setGridState);
  const { navigateToSampleDetail } = useSamplesGridNavigation();
  const setFilteredSampleCount = useStore(
    (state) => state.logActions.setFilteredSampleCount
  );
  const setDisplayedSamples = useStore(
    (state) => state.logsActions.setDisplayedSamples
  );
  const clearDisplayedSamples = useStore(
    (state) => state.logsActions.clearDisplayedSamples
  );
  const clearSelectedSample = useStore(
    (state) => state.sampleActions.clearSelectedSample
  );
  const previousSamplesPath = useStore(
    (state) => state.logs.samplesListState.previousSamplesPath
  );
  const setPreviousSamplesPath = useStore(
    (state) => state.logsActions.setPreviousSamplesPath
  );

  const loading = useStore((state) => state.app.status.loading);
  const syncing = useStore((state) => state.app.status.syncing);
  const selectedLogFile = useStore((state) => state.logs.selectedLogFile);
  const selectedSampleHandle = useStore(
    (state) => state.log.selectedSampleHandle
  );

  // Polling for updated log files.
  const { startPolling, stopPolling } = useClientEvents();
  useEffect(() => {
    startPolling([]);
    return () => {
      stopPolling();
    };
  }, [startPolling, stopPolling]);

  // Drop the persisted filter when samplesPath changes; surviving columns
  // /sort settings are still useful, but filters scoped to the prior
  // directory aren't.
  const initialState = useMemo<GridState | undefined>(() => {
    if (
      previousSamplesPath !== undefined &&
      previousSamplesPath !== samplesPath
    ) {
      clearDisplayedSamples();
      const result = { ...gridState };
      delete result?.filter;
      return result;
    }
    return gridState;
  }, [previousSamplesPath, samplesPath, clearDisplayedSamples, gridState]);

  useEffect(() => {
    if (samplesPath !== previousSamplesPath) {
      setPreviousSamplesPath(samplesPath);
    }
  }, [samplesPath, previousSamplesPath, setPreviousSamplesPath]);

  const handleRowOpen = useCallback(
    (row: SampleRow, opts: { newWindow: boolean }) => {
      navigateToSampleDetail(row.logFile, row.sampleId, row.epoch, opts.newWindow);
    },
    [navigateToSampleDetail]
  );

  const handleStateUpdated = useCallback(
    (state: GridState) => {
      setGridState(state);
    },
    [setGridState]
  );

  const updateDisplayedFromApi = useCallback(
    (api: GridApi<SampleRow>) => {
      const displayed = gridDisplayedSamples(api);
      setFilteredSampleCount(displayed.length);
      setDisplayedSamples(displayed);
    },
    [setFilteredSampleCount, setDisplayedSamples]
  );

  const handleFirstDataRendered = useCallback(
    (api: GridApi<SampleRow>) => {
      updateDisplayedFromApi(api);
      clearSelectedSample();
    },
    [updateDisplayedFromApi, clearSelectedSample]
  );

  const getRowId = useCallback(
    (params: { data: SampleRow }) =>
      sampleRowId(params.data.logFile, params.data.sampleId, params.data.epoch),
    []
  );

  const selectedRowId =
    selectedSampleHandle && selectedLogFile
      ? sampleRowId(
          selectedLogFile,
          selectedSampleHandle.id,
          selectedSampleHandle.epoch
        )
      : undefined;

  const isEmptyAndLoading = items.length === 0 && (loading > 0 || syncing);

  return (
    <SharedSamplesGrid<SampleRow>
      rowData={items}
      columnDefs={columns}
      defaultColDef={{
        sortable: true,
        filter: true,
        resizable: true,
      }}
      viewMode={kViewMode}
      gridRef={gridRef}
      getRowId={getRowId}
      selectedRowId={selectedRowId}
      onRowOpen={handleRowOpen}
      initialState={initialState}
      onStateUpdated={handleStateUpdated}
      onFilterChanged={updateDisplayedFromApi}
      onFirstDataRendered={handleFirstDataRendered}
      autoSizeStrategy={{ type: "fitGridWidth" }}
      refitOnSizeChange
      loading={isEmptyAndLoading}
    />
  );
};
