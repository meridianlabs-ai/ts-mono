import clsx from "clsx";
import { FC } from "react";

import { ScannerInput } from "../../../types/api-types";
import { ScanResultData } from "../../types";

import { ResultBody } from "./ResultBody";
import styles from "./ResultPanel.module.css";
import { ResultSidebar } from "./ResultSidebar";

interface ResultPanelProps {
  resultData: ScanResultData;
  inputData: ScannerInput | undefined;
}

export const ResultPanel: FC<ResultPanelProps> = ({
  resultData,
  inputData,
}) => (
  <div className={clsx(styles.container, "text-size-base")}>
    <ResultSidebar inputData={inputData} resultData={resultData} />
    {inputData ? (
      <ResultBody resultData={resultData} inputData={inputData} />
    ) : (
      <div>No Input Available</div>
    )}
  </div>
);
