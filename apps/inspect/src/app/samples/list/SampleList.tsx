import type {
  ColDef,
  GetRowIdParams,
  GridApi,
  GridState,
} from "ag-grid-community";
import { AgGridReact } from "ag-grid-react";
import { FC, memo, RefObject, useCallback, useEffect, useMemo } from "react";

import { EarlyStoppingSummary } from "@tsmono/inspect-common/types";
import { formatNoDecimal } from "@tsmono/util";

import { MessageBand } from "../../../components/MessageBand";
import { useDocumentTitle } from "../../../state/hooks";
import { useStore } from "../../../state/store";
import { useSampleNavigation } from "../../routing/sampleNavigation";
import { SamplesGrid } from "../../shared/samples-grid/SamplesGrid";
import { SampleRow } from "../../shared/samples-grid/types";

import { SampleFooter } from "./SampleFooter";
import styles from "./SampleList.module.css";

interface SampleListProps {
  items: SampleRow[];
  columns: ColDef<SampleRow>[];
  columnVisibility?: Record<string, boolean>;
  earlyStopping?: EarlyStoppingSummary | null;
  totalItemCount: number;
  running: boolean;
  className?: string | string[];
  listHandle: RefObject<AgGridReact<SampleRow> | null>;
  /** Optional ref that receives the AgGrid `.ag-body-viewport` DOM element
   *  once the grid is ready, so callers can hook scroll listeners on the
   *  actual scrolling viewport. */
  scrollRef?: RefObject<HTMLDivElement | null>;
  gridState?: GridState;
  onGridStateChange?: (state: GridState) => void;
  onFilterChanged?: (api: GridApi<SampleRow>) => void;
}

const makeSampleRowId = (id: string | number, epoch: number) =>
  `${id}-${epoch}`.replace(/\s+/g, "_");

export const SampleList: FC<SampleListProps> = memo((props) => {
  const {
    items,
    columns,
    columnVisibility,
    earlyStopping,
    totalItemCount,
    running,
    className,
    listHandle,
    scrollRef,
    gridState,
    onGridStateChange,
    onFilterChanged,
  } = props;

  const selectedLogFile = useStore((state) => state.logs.selectedLogFile);
  useEffect(() => {
    listHandle.current?.api?.ensureIndexVisible(0, "top");
  }, [listHandle, selectedLogFile]);

  const sampleNavigation = useSampleNavigation();
  const selectedSampleHandle = useStore(
    (state) => state.log.selectedSampleHandle
  );

  const selectedLogDetails = useStore((state) => state.log.selectedLogDetails);
  const evalSpec = selectedLogDetails?.eval;
  const { setDocumentTitle } = useDocumentTitle();
  useEffect(() => {
    setDocumentTitle({ evalSpec });
  }, [setDocumentTitle, evalSpec]);

  const handleRowOpen = useCallback(
    (row: SampleRow, opts: { newWindow: boolean }) => {
      if (opts.newWindow) {
        const url = sampleNavigation.getSampleUrl(row.sampleId, row.epoch);
        if (url) window.open(url, "_blank");
      } else {
        sampleNavigation.showSample(row.sampleId, row.epoch);
      }
    },
    [sampleNavigation]
  );

  const getRowId = useCallback(
    (params: GetRowIdParams<SampleRow>) =>
      makeSampleRowId(params.data.sampleId, params.data.epoch),
    []
  );

  const selectedRowId = selectedSampleHandle
    ? makeSampleRowId(selectedSampleHandle.id, selectedSampleHandle.epoch)
    : undefined;

  const handleStateUpdated = useCallback(
    (state: GridState) => {
      onGridStateChange?.(state);
    },
    [onGridStateChange]
  );

  const handleFilterChanged = useCallback(
    (api: GridApi<SampleRow>) => {
      onFilterChanged?.(api);
    },
    [onFilterChanged]
  );

  const sampleCount = items.length;

  const warnings = useMemo(() => {
    const errorCount = items.reduce(
      (prev, item) => (item.error || item.data?.error ? prev + 1 : prev),
      0
    );
    const limitCount = items.reduce(
      (prev, item) => (item.limit || item.data?.limit ? prev + 1 : prev),
      0
    );
    const percentError = sampleCount > 0 ? (errorCount / sampleCount) * 100 : 0;
    const percentLimit = sampleCount > 0 ? (limitCount / sampleCount) * 100 : 0;

    const result: { type: string; msg: string }[] = [];
    if (errorCount > 0) {
      result.push({
        type: "info",
        msg: `INFO: ${errorCount} of ${sampleCount} samples (${formatNoDecimal(percentError)}%) had errors and were not scored.`,
      });
    }
    if (limitCount > 0) {
      result.push({
        type: "info",
        msg: `INFO: ${limitCount} of ${sampleCount} samples (${formatNoDecimal(percentLimit)}%) completed due to exceeding a limit.`,
      });
    }
    if (earlyStopping?.early_stops && earlyStopping?.early_stops?.length > 0) {
      result.push({
        type: "info",
        msg: `Skipped ${earlyStopping.early_stops.length} samples due to early stopping (${earlyStopping.manager}). `,
      });
    }
    return result;
  }, [items, sampleCount, earlyStopping]);

  return (
    <div className={styles.mainLayout}>
      {warnings.map((warning, index) => (
        <MessageBand
          id={`sample-warning-message-${index}`}
          message={warning.msg}
          type={warning.type as "info" | "warning" | "error"}
          key={`sample-warning-message-${index}`}
        />
      ))}
      <SamplesGrid<SampleRow>
        rowData={items}
        columnDefs={columns}
        columnVisibility={columnVisibility}
        defaultColDef={{
          sortable: true,
          filter: true,
          resizable: true,
          headerTooltipValueGetter: (params) => params.colDef?.headerName,
        }}
        viewMode="list"
        gridRef={listHandle}
        getRowId={getRowId}
        selectedRowId={selectedRowId}
        onRowOpen={handleRowOpen}
        followOutput={running}
        scrollRef={scrollRef}
        initialState={gridState}
        onStateUpdated={onGridStateChange ? handleStateUpdated : undefined}
        onFilterChanged={handleFilterChanged}
        className={typeof className === "string" ? className : undefined}
      />
      <SampleFooter
        sampleCount={sampleCount}
        totalSampleCount={totalItemCount}
        running={running}
      />
    </div>
  );
});
