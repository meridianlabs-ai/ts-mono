import clsx from "clsx";
import { FC } from "react";

import { ErrorPanel, NoContentsPanel } from "@tsmono/react/components";
import { AsyncData } from "@tsmono/util";

import { ScanResultDetail } from "../../../api/api";
import { ScanResultData } from "../../types";

import { ResultBody } from "./ResultBody";
import styles from "./ResultPanel.module.css";
import { ResultSidebar } from "./ResultSidebar";

interface ResultPanelProps {
  resultData: ScanResultData;
  detail: AsyncData<ScanResultDetail>;
}

export const ResultPanel: FC<ResultPanelProps> = ({ resultData, detail }) => (
  <div className={clsx(styles.container, "text-size-base")}>
    <ResultSidebar inputData={detail.data?.input} resultData={resultData} />
    {detail.error ? (
      <ErrorPanel
        title="Error Loading Input"
        error={{ message: detail.error.message }}
      />
    ) : !resultData.uuid ? (
      <NoContentsPanel text="No input for this result" />
    ) : detail.loading ? (
      <NoContentsPanel text="Loading input" busy />
    ) : (
      <ResultBody
        resultData={resultData}
        inputData={detail.data.input}
        inputStorage={detail.data.inputStorage}
        inputError={detail.data.inputError}
      />
    )}
  </div>
);
