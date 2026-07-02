import type { SortingState } from "@tanstack/react-table";
import { FC, memo, RefObject, useCallback, useEffect, useMemo } from "react";

import { EarlyStoppingSummary } from "@tsmono/inspect-common/types";
import { formatNoDecimal } from "@tsmono/util";

import { MessageBand } from "../../../components/MessageBand";
import {
  useDocumentTitleAction,
  useSelectedLogDetails,
} from "../../../state/hooks";
import { useStore } from "../../../state/store";
import { useSampleNavigationActions } from "../../routing/sampleNavigation";
import { ExtendedColumnDef } from "../../shared/data-grid/columnTypes";
import { isCurrentSample } from "../../shared/sample";
import { SamplesGrid } from "../../shared/samples-grid/SamplesGrid";
import { SampleRow } from "../../shared/samples-grid/types";

import { SampleFooter } from "./SampleFooter";
import styles from "./SampleList.module.css";

interface SampleListProps {
  items: SampleRow[];
  columns: ExtendedColumnDef<SampleRow>[];
  columnVisibility?: Record<string, boolean>;
  /** Initial row sort (eval-author default from `task_samples_view.sort`). */
  defaultSorting?: SortingState;
  earlyStopping?: EarlyStoppingSummary | null;
  totalItemCount: number;
  running: boolean;
  /** Row layout. `true` = list-style multi-line rows; `false` = compact. */
  multiline?: boolean;
  /** Forwarded to the grid's scroll container so the title bar collapses on
   *  scroll (title-view collapse-on-scroll listens via `useScrollDirection`). */
  scrollRef?: RefObject<HTMLDivElement | null>;
}

const makeSampleRowId = (id: string | number, epoch: number) =>
  `${id}-${epoch}`.replace(/\s+/g, "_");

export const SampleList: FC<SampleListProps> = memo((props) => {
  const {
    items,
    columns,
    columnVisibility,
    defaultSorting,
    earlyStopping,
    totalItemCount,
    running,
    multiline,
    scrollRef,
  } = props;

  const sampleNavigation = useSampleNavigationActions();
  const selectedSampleHandle = useStore(
    (state) => state.log.selectedSampleHandle
  );

  const selectedLogDetails = useSelectedLogDetails();
  const evalSpec = selectedLogDetails?.eval;
  const { setDocumentTitle } = useDocumentTitleAction();
  useEffect(() => {
    setDocumentTitle({ evalSpec });
  }, [setDocumentTitle, evalSpec]);

  const handleRowOpen = useCallback(
    (row: SampleRow) => {
      // Re-clicking the open sample would re-run selectSample + navigate and
      // trigger a redundant reload of the same sample — skip it.
      if (isCurrentSample(selectedSampleHandle, row.sampleId, row.epoch)) {
        return;
      }
      sampleNavigation.showSample(row.sampleId, row.epoch);
    },
    [sampleNavigation, selectedSampleHandle]
  );

  const getRowId = useCallback(
    (row: SampleRow) => makeSampleRowId(row.sampleId, row.epoch),
    []
  );

  const selectedRowId = selectedSampleHandle
    ? makeSampleRowId(selectedSampleHandle.id, selectedSampleHandle.epoch)
    : undefined;

  const sampleCount = items.length;

  const warnings = useMemo(() => {
    let errorCount = 0;
    let limitCount = 0;
    for (const item of items) {
      if (item.error || item.data?.error) {
        errorCount += 1;
      }
      if (item.limit || item.data?.limit) {
        limitCount += 1;
      }
    }
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
      {warnings.map((warning) => (
        <MessageBand
          id={`sample-warning-message-${warning.type}-${warning.msg}`}
          message={warning.msg}
          type={warning.type as "info" | "warning" | "error"}
          key={`sample-warning-message-${warning.type}-${warning.msg}`}
        />
      ))}
      <SamplesGrid
        rowData={items}
        columnDefs={columns}
        columnVisibility={columnVisibility}
        defaultSorting={defaultSorting}
        multiline={multiline}
        getRowId={getRowId}
        selectedRowId={selectedRowId}
        scrollRef={scrollRef}
        onRowOpen={handleRowOpen}
      />
      <SampleFooter
        sampleCount={sampleCount}
        totalSampleCount={totalItemCount}
        running={running}
      />
    </div>
  );
});

SampleList.displayName = "SampleList";
