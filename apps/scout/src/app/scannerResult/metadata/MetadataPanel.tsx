import clsx from "clsx";
import { FC } from "react";

import { RecordTree } from "@tsmono/inspect-components/content";
import {
  Card,
  CardBody,
  CardHeader,
  NoContentsPanel,
} from "@tsmono/react/components";

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
            <CardHeader label="Metadata" type="modern" />
            <CardBody>
              <RecordTree
                id={`result-metadata-${resultData.identifier}`}
                record={resultData.metadata || {}}
              />
            </CardBody>
          </Card>
        )}
      </div>
    )
  );
};
