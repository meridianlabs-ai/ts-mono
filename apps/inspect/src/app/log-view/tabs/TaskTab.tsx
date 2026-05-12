import clsx from "clsx";
import { FC, useCallback, useMemo, useState } from "react";

import {
  EarlyStoppingSummary,
  EvalSpec,
  EvalStats,
} from "@tsmono/inspect-common/types";
import { MetaDataGrid, RecordTree } from "@tsmono/inspect-components/content";
import { Card, CardBody, CardHeader } from "@tsmono/react/components";
import { formatNumber, ghCommitUrl, toTitleCase } from "@tsmono/util";

import { kLogViewTaskTabId } from "../../../constants";
import { useRefreshLog } from "../../../state/hooks";
import { useStore } from "../../../state/store";
import { formatDateTime, formatDuration } from "../../../utils/format";
import { ApplicationIcons } from "../../appearance/icons";
import { EditTagsDialog } from "../title-view/EditTagsDialog";

import styles from "./TaskTab.module.css";

// Individual hook for Info tab
export const useTaskTabConfig = (
  evalSpec: EvalSpec | undefined,
  evalStats?: EvalStats,
  earlyStopping?: EarlyStoppingSummary | null,
  tags?: string[]
) => {
  return useMemo(() => {
    return {
      id: kLogViewTaskTabId,
      label: "Task",
      scrollable: true,
      component: TaskTab,
      componentProps: {
        evalSpec,
        evalStats,
        earlyStopping,
        tags,
      },
    };
  }, [evalSpec, evalStats, earlyStopping, tags]);
};

interface TaskTabProps {
  evalSpec?: EvalSpec;
  evalStats?: EvalStats;
  earlyStopping?: EarlyStoppingSummary | null;
  tags?: string[];
}

export const TaskTab: FC<TaskTabProps> = ({
  evalSpec,
  evalStats,
  earlyStopping,
  tags,
}) => {
  const refreshLog = useRefreshLog();
  const selectedLogFile = useStore((state) => state.logs.selectedLogFile);
  const canEditTags = useStore((state) => Boolean(state.api?.edit_log));
  const [editing, setEditing] = useState(false);

  const handleSaved = useCallback(() => {
    refreshLog();
  }, [refreshLog]);

  const config: Record<string, unknown> = {};
  Object.entries(evalSpec?.config || {}).forEach((entry) => {
    const key = entry[0];
    const value = entry[1];
    config[key] = value;
  });

  const revision = evalSpec?.revision;
  const packages = evalSpec?.packages;

  const taskInformation: Record<string, unknown> = {
    ["Task ID"]: evalSpec?.task_id,
    ["Run ID"]: evalSpec?.run_id,
  };

  if (revision) {
    taskInformation[
      `${revision.type ? `${toTitleCase(revision.type)} ` : ""}Revision`
    ] = {
      _html: (
        <a href={ghCommitUrl(revision.origin, revision.commit)}>
          {revision.commit}
        </a>
      ),
    };
  }
  if (packages) {
    const names = Object.keys(packages).map((key) => {
      return `${key} ${packages[key]}`;
    });

    if (names.length === 1) {
      taskInformation["Inspect"] = names[0];
    } else {
      taskInformation["Inspect"] = names;
    }
  }
  // tags are rendered separately below so we can attach an Edit affordance.

  if (evalSpec?.sandbox) {
    if (Array.isArray(evalSpec?.sandbox)) {
      taskInformation["sandbox"] = evalSpec.sandbox[0];
      if (evalSpec.sandbox[1]) {
        taskInformation["sandbox_config"] = evalSpec.sandbox[1];
      }
    } else {
      taskInformation["sandbox"] = evalSpec?.sandbox.type;
      taskInformation["sandbox_config"] = evalSpec?.sandbox.config;
    }
  }

  const totalDuration = formatDuration(
    new Date(evalStats?.started_at || 0),
    new Date(evalStats?.completed_at || 0)
  );

  const task_args = evalSpec?.task_args || {};

  return (
    <div style={{ width: "100%" }}>
      <div
        style={{
          padding: "0.5em 1em 0 1em",
          width: "100%",
          display: "flex",
          flexDirection: "column",
          gap: "0.75rem",
        }}
      >
        <Card>
          <CardHeader label="Task Info" />
          <CardBody id={"task-card-config"}>
            <div className={clsx(styles.grid)}>
              <MetaDataGrid
                key={`plan-md-task`}
                className={"text-size-small"}
                entries={taskInformation}
              />

              <MetaDataGrid
                entries={{
                  ["Start"]: formatDateTime(
                    new Date(evalStats?.started_at || 0)
                  ),
                  ["End"]: formatDateTime(
                    new Date(evalStats?.completed_at || 0)
                  ),
                  ["Duration"]: totalDuration,
                }}
              />
            </div>
            <div className={styles.tagsRow}>
              <span className={clsx("text-size-small", styles.tagsLabel)}>
                tags
              </span>
              <span className={clsx("text-size-small", styles.tagsValue)}>
                {tags && tags.length > 0 ? (
                  tags.join(", ")
                ) : (
                  <span className={styles.tagsEmpty}>(none)</span>
                )}
              </span>
              {canEditTags && selectedLogFile && (
                <button
                  type="button"
                  className={clsx(
                    "btn",
                    "btn-link",
                    "text-size-smaller",
                    styles.editButton
                  )}
                  onClick={() => setEditing(true)}
                  title="Edit tags"
                >
                  <i className={ApplicationIcons.edit} /> Edit…
                </button>
              )}
            </div>
          </CardBody>
        </Card>

        {selectedLogFile && (
          <EditTagsDialog
            showing={editing}
            setShowing={setEditing}
            currentTags={tags || []}
            logFile={selectedLogFile}
            onSaved={handleSaved}
          />
        )}

        {earlyStopping && (
          <Card>
            <CardHeader
              label={`Early Stopping (${earlyStopping.manager} — ${formatNumber(earlyStopping.early_stops.length)} skipped)`}
            />
            <CardBody>
              <RecordTree
                id={`early-stopping-metadata`}
                record={earlyStopping.metadata}
              />
            </CardBody>
          </Card>
        )}

        {Object.keys(task_args).length > 0 && (
          <Card>
            <CardHeader label="Task Args" />
            <CardBody id={"task-card-config"}>
              <MetaDataGrid
                key={`plan-md-task-args`}
                className={"text-size-small"}
                entries={task_args as Record<string, unknown>}
              />
            </CardBody>
          </Card>
        )}
      </div>
    </div>
  );
};
