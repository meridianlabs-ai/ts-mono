import clsx from "clsx";
import { FC } from "react";

import { MarkdownReference, NoContentsPanel } from "@tsmono/react/components";
import { ScannerResultDetailView } from "@tsmono/scout-components/scanner-result-detail";

import { ScannerInput } from "../../../types/api-types";
import { ScanResultData } from "../../types";
import { useMarkdownRefs } from "../../utils/refs";

import styles from "./ResultSidebar.module.css";

interface ResultSidebarProps {
  inputData?: ScannerInput;
  resultData?: ScanResultData;
}

export const ResultSidebar: FC<ResultSidebarProps> = ({
  inputData,
  resultData,
}) => {
  const refs: MarkdownReference[] = useMarkdownRefs(resultData, inputData);

  if (!resultData) {
    return <NoContentsPanel text="No result to display." />;
  }

  return (
    <div className={clsx(styles.sidebar)}>
      <ScannerResultDetailView
        data={{
          identifier: resultData.identifier,
          label: resultData.label,
          value: resultData.value,
          valueType: resultData.valueType,
          answer: resultData.answer,
          explanation: resultData.explanation,
          metadata: resultData.metadata,
          validationResult: resultData.validationResult,
          validationTarget: resultData.validationTarget,
        }}
        references={refs}
        interactive
        options={{ previewRefsOnHover: false }}
      />
    </div>
  );
};
