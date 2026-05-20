import clsx from "clsx";
import { FC, RefObject, useCallback, useState } from "react";

import { EvalPlan, EvalScore, EvalSpec } from "@tsmono/inspect-common/types";
import { RecordTree } from "@tsmono/inspect-components/content";
import { Card, CardBody, CardHeader } from "@tsmono/react/components";

import { useRefreshLog } from "../../state/hooks";
import { useStore } from "../../state/store";
import { EditButton } from "../log-view/title-view/EditButton";
import { EditMetadataDialog } from "../log-view/title-view/EditMetadataDialog";

import { PlanDetailView } from "./PlanDetailView";
import styles from "./PlanCard.module.css";

interface PlanCardProps {
  evalSpec?: EvalSpec;
  evalPlan?: EvalPlan;
  scores?: EvalScore[];
  metadata?: Record<string, unknown>;
  scrollRef: RefObject<HTMLDivElement | null>;
}

/**
 * Renders the plan card
 */
export const PlanCard: FC<PlanCardProps> = ({
  evalSpec,
  evalPlan,
  scores,
  metadata: metadataProp,
  scrollRef,
}) => {
  const metadata = metadataProp || {};
  const hasMetadata = Object.keys(metadata).length > 0;

  const canEditMetadata = useStore((state) => Boolean(state.api?.edit_log));
  const selectedLogFile = useStore((state) => state.logs.selectedLogFile);
  const logStatus = useStore(
    (state) => state.log.selectedLogDetails?.status
  );
  const refreshLog = useRefreshLog();
  const [editingMetadata, setEditingMetadata] = useState(false);
  const onMetadataSaved = useCallback(() => refreshLog(), [refreshLog]);

  // Edit gated on the server with 409 while the recorder is running;
  // mirror that here so the affordance isn't even offered.
  const isInProgress = logStatus === "started";
  const canEdit = canEditMetadata && !!selectedLogFile && !isInProgress;
  const showMetadataCard = hasMetadata || canEdit;

  return (
    <>
      <Card>
        <CardHeader label="Summary" />
        <CardBody id={"task-plan-card-body"}>
          <PlanDetailView
            evaluation={evalSpec}
            plan={evalPlan}
            scores={scores}
          />
        </CardBody>
      </Card>

      {showMetadataCard && (
        <Card>
          <CardHeader label="Metadata">
            {canEdit && (
              <span className={styles.headerActions}>
                <EditButton
                  onClick={() => setEditingMetadata(true)}
                  title="Edit metadata"
                />
              </span>
            )}
          </CardHeader>
          <CardBody id={"task-metadata"}>
            {hasMetadata ? (
              <RecordTree
                id={"plan-md-metadata"}
                record={metadata}
                scrollRef={scrollRef}
              />
            ) : (
              <div
                className={clsx(
                  "text-size-smaller",
                  styles.emptyMetadata
                )}
              >
                No metadata — click Edit to add a key.
              </div>
            )}
          </CardBody>
        </Card>
      )}

      {selectedLogFile && (
        <EditMetadataDialog
          showing={editingMetadata}
          setShowing={setEditingMetadata}
          currentMetadata={metadata}
          logFile={selectedLogFile}
          onSaved={onMetadataSaved}
        />
      )}
    </>
  );
};
