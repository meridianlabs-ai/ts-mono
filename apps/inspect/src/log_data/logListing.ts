import { EvalLogStatus } from "../@types/extraInspect";
import { Log } from "../client/api/types";

/**
 * The retried-run mark: one row per log file with retried runs marked — a
 * cross-row derivation over a scan (the one fact a page's key-slice read
 * cannot re-derive). Every listing projection (`logsListingRead`) runs its
 * scans through this.
 */

const isActiveStatus = (status: EvalLogStatus | undefined) =>
  status === "started" || status === "success";

export type LogListingRow = Log & { retried?: boolean };

/**
 * Groups logs by (parent directory, task_id) so that logs sharing a task_id
 * across different folders (e.g. copied log directories under a shared parent)
 * are not treated as retries of each other. Within each group, logs whose
 * status is `started` or `success` rank above other statuses; ties are
 * broken by filename descending so the newest run wins. The winner is
 * marked `retried: false`; the rest are marked `retried: true`.
 *
 * The mark is *total*: a log without a task_id (older log format) can never
 * be grouped, so it gets `retried: false` rather than `undefined`. The
 * retried-hiding membership rule is the condition `retried = false`, and
 * the condition evaluator implements SQL null semantics (NULL fails every
 * comparison) — a partial column would silently drop task-id-less logs.
 */
export const computeLogsWithRetried = (logs: Log[]): LogListingRow[] => {
  const logsByGroup = logs.reduce((acc: Record<string, Log[]>, log) => {
    const taskId = log.task_id;
    if (taskId) {
      const slash = log.name.lastIndexOf("/");
      const parent = slash >= 0 ? log.name.substring(0, slash) : "";
      const key = `${parent}|${taskId}`;
      (acc[key] ??= []).push(log);
    }
    return acc;
  }, {});
  // For each group, select the best item: prefer logs whose status is
  // started or success (treated as equivalent — both mean "not failed"),
  // then break ties by filename descending so the newest run wins.
  // An older `started` log is treated as orphaned once a newer log exists.
  const bestByName: Record<string, LogListingRow> = {};
  for (const items of Object.values(logsByGroup)) {
    const best = [...items].sort((a, b) => {
      const aActive = isActiveStatus(a.status);
      const bActive = isActiveStatus(b.status);
      if (aActive !== bActive) return aActive ? -1 : 1;
      return b.name.localeCompare(a.name);
    })[0];
    if (best !== undefined) {
      bestByName[best.name] = { ...best, retried: false };
    }
  }

  // Rebuild logs maintaining order, marking duplicates as skippable
  return logs.map(
    (log) =>
      bestByName[log.name] ?? {
        ...log,
        // task_id is optional for backward compatibility; only new log files
        // can be retried (a task-id-less log is never grouped).
        retried: log.task_id ? true : false,
      }
  );
};
