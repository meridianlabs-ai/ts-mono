import clsx from "clsx";
import { FC } from "react";

import { LabeledValue } from "@tsmono/react/components";

import { Card, CardBody } from "../../../components/Card";
import { RecordTree } from "../../../components/content/RecordTree";
import { NoContentsPanel } from "../../../components/NoContentsPanel";
import { ScanResultData } from "../../types";

import styles from "./Metadata.module.css";

interface MetadataPanelProps {
  resultData?: ScanResultData;
}

export const MetadataPanel: FC<MetadataPanelProps> = ({ resultData }) => {
  const hasMetadata =
    resultData && Object.keys(resultData?.metadata).length > 0;
  return (
    resultData && (
      <div className={clsx(styles.container, "text-size-base")}>
        {!hasMetadata && <NoContentsPanel text={"No metadata available"} />}
        {hasMetadata && (
          <Card>
            <CardBody>
              <LabeledValue label="Metadata">
                <RecordTree
                  id={`result-metadata-${resultData.identifier}`}
                  record={resultData.metadata || {}}
                />
              </LabeledValue>
            </CardBody>
          </Card>
        )}
      </div>
    )
  );
};
