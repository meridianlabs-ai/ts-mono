import clsx from "clsx";
import { FC } from "react";

import { LoadingBar } from "@tsmono/react/components";

import { useStore } from "../../../state/store";
import { Status } from "../../../types/api-types";
import { Footer } from "../../components/Footer";
import { useDataframeData } from "../../components/useDataframeData";
import { useSelectedScanDataframe } from "../../hooks/useSelectedScanDataframe";
import { useSelectedScanner } from "../../hooks/useSelectedScanner";

import { ScannerResultsBody } from "./results/ScannerResultsBody";
import styles from "./ScannerPanel.module.css";
import { ScannerSidebar } from "./ScannerSidebar";

export const ScannerPanel: FC<{ selectedScan: Status }> = ({
  selectedScan,
}) => {
  const visibleItemsCount = useStore(
    (state) => state.visibleScannerResultsCount
  );
  const selectedScanner = useSelectedScanner();

  const {
    data: columnTable,
    loading: isLoading,
    error,
  } = useSelectedScanDataframe();
  const isDataframe = useStore(
    (state) => state.selectedResultsView === "dataframe"
  );
  const dataframe = useDataframeData(isDataframe ? columnTable : undefined);
  const selectedScannerInfo = {
    columnTable,
    isLoading,
    error: error?.message,
  };

  return (
    <div className={clsx(styles.root)}>
      <LoadingBar loading={isLoading} />
      <div className={clsx(styles.container)}>
        <ScannerSidebar selectedScan={selectedScan} />
        <ScannerResultsBody
          // TODO: This is slightly bogus. It really needs to be a scannerid since
          // nothing prevents two scanners from having the same name.
          scannerId={selectedScanner.data ?? "unknown"}
          selectedScan={selectedScan}
          dataframe={dataframe}
          selectedScanner={selectedScannerInfo}
        />
      </div>
      <Footer
        id={"scanner-panel-footer"}
        itemCount={isDataframe ? dataframe.rows.length : visibleItemsCount}
        paginated={false}
        labels={{
          singular: "result",
          plural: "results",
        }}
      />
    </div>
  );
};
