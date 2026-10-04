import { ColumnTable } from "arquero";
import clsx from "clsx";
import { FC } from "react";
import { useSearchParams } from "react-router";

import { ErrorPanel, NoContentsPanel } from "@tsmono/react/components";

import { useLoggingNavigate } from "../../../../debugging/navigationDebugging";
import { scanResultRoute } from "../../../../router/url";
import { useScanRoute } from "../../../../router/useScanRoute";
import { useStore } from "../../../../state/store";
import { Status } from "../../../../types/api-types";
import { DataframeView } from "../../../components/DataframeView";
import type { DataframeData } from "../../../components/useDataframeData";
import { kSegmentDataframe, kSegmentList } from "../../ScanPanelBody";
import { ScannerResultsList } from "../list/ScannerResultsList";

import styles from "./ScannerResultsBody.module.css";

export const ScannerResultsBody: FC<{
  selectedScan: Status;
  scannerId: string;
  dataframe: DataframeData;
  selectedScanner: {
    columnTable: ColumnTable | undefined;
    isLoading: boolean;
    error: string | undefined;
  };
}> = ({
  scannerId,
  dataframe,
  selectedScan,
  selectedScanner: { columnTable, error, isLoading: isLoadingData },
}) => {
  const selectedResultsView =
    useStore((state) => state.selectedResultsView) || kSegmentList;

  const hasScanner = (columnTable?.numRows() || 0) > 0;
  const dataframeWrapText = useStore((state) => state.dataframeWrapText);

  // Navigation setup
  const navigate = useLoggingNavigate("ScannerResultsBody");
  const [searchParams] = useSearchParams();
  const { scansDir, scanPath } = useScanRoute();

  return (
    <div className={clsx(styles.scrollContainer)}>
      {hasScanner && (
        <div style={{ height: "100%", width: "100%" }}>
          {selectedResultsView === kSegmentList && (
            <ScannerResultsList
              columnTable={columnTable}
              id={`scan-list-${scannerId}`}
              selectedScan={selectedScan}
            />
          )}
          {selectedResultsView === kSegmentDataframe && (
            <DataframeView
              dataframe={dataframe}
              wrapText={dataframeWrapText}
              onRowDoubleClicked={(row) => {
                // Navigate to the result detail view
                const identifier = row.identifier;
                if (typeof identifier === "string" && identifier && scansDir) {
                  const route = scanResultRoute(
                    scansDir,
                    scanPath,
                    identifier,
                    searchParams
                  );

                  navigate(route);
                }
              }}
            />
          )}
        </div>
      )}
      {!hasScanner && !isLoadingData && !error && (
        <NoContentsPanel text="No scanner data available." />
      )}
      {error && (
        <ErrorPanel
          title="Error Loading Dataframe"
          error={{ message: error }}
        />
      )}
    </div>
  );
};
