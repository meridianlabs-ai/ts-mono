import clsx from "clsx";
import { FC } from "react";

import { MetaDataGrid, RecordTree } from "@tsmono/inspect-components/content";
import { ModelTokenTable } from "@tsmono/inspect-components/usage";
import {
  Card,
  CardBody,
  CardHeader,
  LabeledValue,
} from "@tsmono/react/components";
import { formatNumber } from "@tsmono/util";

import { ScanResultData } from "../../types";

import styles from "./InfoPanel.module.css";

interface InfoPanelProps {
  resultData?: ScanResultData;
}

export const InfoPanel: FC<InfoPanelProps> = ({ resultData }) => {
  return (
    resultData && (
      <div className={clsx(styles.container)}>
        <Card>
          <CardHeader label="Scanner Info" type="modern" />
          <CardBody>
            <ScannerInfoPanel resultData={resultData} />
          </CardBody>
        </Card>

        <Card>
          <CardHeader label="Transcript Info" type="modern" />
          <CardBody>
            <TranscriptInfoPanel resultData={resultData} />
          </CardBody>
        </Card>

        {resultData?.scanModelUsage &&
          Object.keys(resultData?.scanModelUsage).length > 0 && (
            <Card>
              <CardHeader label="Model Usage" type="modern" />
              <CardBody>
                <ModelTokenTable model_usage={resultData.scanModelUsage} />
              </CardBody>
            </Card>
          )}
        {resultData?.scanMetadata &&
          Object.keys(resultData.scanMetadata).length > 0 && (
            <Card>
              <CardHeader label="Metadata" type="modern" />
              <CardBody>
                <RecordTree
                  id={`scan-metadata-${resultData?.identifier}`}
                  record={resultData?.scanMetadata || {}}
                />
              </CardBody>
            </Card>
          )}
      </div>
    )
  );
};

export const ScannerInfoPanel: FC<InfoPanelProps> = ({ resultData }) => {
  return (
    <div className={clsx("text-size-small")}>
      <div className={clsx(styles.scanInfo)}>
        <LabeledValue label="Name">{resultData?.scannerName}</LabeledValue>
        {resultData?.scannerFile && resultData.scannerFile !== null && (
          <LabeledValue label="File">{resultData?.scannerFile}</LabeledValue>
        )}
        {(resultData?.scanTotalTokens || 0) > 0 && (
          <LabeledValue label="Tokens">
            {resultData?.scanTotalTokens
              ? formatNumber(resultData.scanTotalTokens)
              : ""}
          </LabeledValue>
        )}
      </div>
      {resultData?.scanTags && resultData.scanTags.length > 0 && (
        <LabeledValue label="Tags">
          {(resultData?.scanTags || []).join(", ")}
        </LabeledValue>
      )}
      {resultData?.scannerParams &&
        Object.keys(resultData.scannerParams).length > 0 && (
          <LabeledValue label="Params">
            <RecordTree
              id={`scanner-params-${resultData?.identifier}`}
              record={resultData?.scannerParams}
            />
          </LabeledValue>
        )}
    </div>
  );
};

export const TranscriptInfoPanel: FC<InfoPanelProps> = ({ resultData }) => {
  return (
    <div className={clsx("text-size-small")}>
      <MetaDataGrid
        entries={{
          "source id": resultData?.transcriptSourceId,
          source_uri: resultData?.transcriptSourceUri,
          date: resultData?.transcriptDate,
          model: resultData?.transcriptModel,
          agent: resultData?.transcriptAgent,
          "agent args": resultData?.transcriptAgentArgs,
          score: resultData?.transcriptScore,
          success: resultData?.transcriptSuccess,
          limit: resultData?.transcriptLimit,
          error: resultData?.transcriptError,
          message_count: resultData?.transcriptMessageCount,
          total_time: resultData?.transcriptTotalTime,
          total_tokens: resultData?.transcriptTotalTokens,
        }}
      />
    </div>
  );
};
