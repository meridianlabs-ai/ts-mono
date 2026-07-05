import { useMemo } from "react";

import { LogHandle } from "@tsmono/inspect-common/types";

import { EvalLogStatus } from "../@types/extraInspect";

import { useLogHandles, useLogPreviews } from "./logsContent";

/**
 * The listing read: the directory's logs with retried runs marked — the
 * handles ⋈ previews join, derived entirely from this subsystem's
 * collections. Lives here (not in state/) so the paged-listing migration can
 * swap its internals (whole-dir join → paged Dexie query) without touching
 * consumers.
 */

const isActiveStatus = (status: EvalLogStatus | undefined) =>
  status === "started" || status === "success";

export type LogHandleWithRetried = LogHandle & { retried?: boolean };

type LogPreviewStatusMap = Record<
  string,
  { status?: EvalLogStatus } | undefined
>;

/**
 * Pure dedup logic for {@link useLogHandlesWithRetried}.
 *
 * Groups logs by (parent directory, task_id) so that logs sharing a task_id
 * across different folders (e.g. copied log directories under a shared parent)
 * are not treated as retries of each other. Within each group, logs whose
 * status is `started` or `success` rank above other statuses; ties are
 * broken by filename descending so the newest run wins. The winner is
 * marked `retried: false`; the rest are marked `retried: true`.
 */
export const computeLogsWithRetried = (
  logs: LogHandle[],
  logPreviews: LogPreviewStatusMap
): LogHandleWithRetried[] => {
  const logsByGroup = logs.reduce(
    (acc: Record<string, LogHandleWithRetried[]>, log) => {
      const taskId = log.task_id;
      if (taskId) {
        const slash = log.name.lastIndexOf("/");
        const parent = slash >= 0 ? log.name.substring(0, slash) : "";
        const key = `${parent}|${taskId}`;
        if (!(key in acc)) acc[key] = [];
        // @ts-expect-error pre-existing noUncheckedIndexedAccess violation (TODO: narrow when touched)
        acc[key].push(log);
      }
      return acc;
    },
    {}
  );
  // For each group, select the best item: prefer logs whose status is
  // started or success (treated as equivalent — both mean "not failed"),
  // then break ties by filename descending so the newest run wins.
  // An older `started` log is treated as orphaned once a newer log exists.
  const bestByName: Record<string, LogHandleWithRetried> = {};
  for (const items of Object.values(logsByGroup)) {
    items.sort((a, b) => {
      const aActive = isActiveStatus(logPreviews[a.name]?.status);
      const bActive = isActiveStatus(logPreviews[b.name]?.status);
      if (aActive !== bActive) return aActive ? -1 : 1;
      return b.name.localeCompare(a.name);
    });
    // @ts-expect-error pre-existing noUncheckedIndexedAccess violation (TODO: narrow when touched)
    const { name } = items[0];
    // @ts-expect-error pre-existing noUncheckedIndexedAccess violation (TODO: narrow when touched)
    bestByName[name] = { ...items[0], retried: false }; // eslint-disable-line @typescript-eslint/no-unsafe-member-access -- TODO: pre-existing noUncheckedIndexedAccess fallout
  }

  // Rebuild logs maintaining order, marking duplicates as skippable
  return logs.map(
    (log) =>
      bestByName[log.name] ?? {
        ...log,
        // task_id is optional for backward compatibility, only new logs files can be skippable
        retried: log.task_id ? true : undefined,
      }
  );
};

export const useLogHandlesWithRetried = (
  logDir: string
): LogHandleWithRetried[] => {
  const logs = useLogHandles(logDir);
  const logPreviews = useLogPreviews(logDir);

  return useMemo(
    () => computeLogsWithRetried(logs, logPreviews),
    [logs, logPreviews]
  );
};
