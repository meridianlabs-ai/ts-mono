import { LogHandle } from "@tsmono/inspect-common";

import { ClientAPI } from "../client/api/types";

import { ListingUpdate } from "./fetchEngine";

/** The engine surface a listing sync drives: the local listing to diff
 *  against, and application of the diff result. */
export interface ListingTarget {
  listing(): LogHandle[];
  epoch(): number;
  applyListing(update: ListingUpdate): Promise<LogHandle[]>;
  requeueMissing(): Promise<void>;
}

/**
 * Directory discovery: list the log dir, diff it against the engine's known
 * listing (new / changed / deleted), and produce the result into the engine —
 * which owns all fetching, persistence, and prioritization. Stateless: the
 * caller owns serialization (`syncLogs`) and scheduling (react-query). Dir
 * mode only; never runs in single-file sessions.
 */
export const syncListing = async (
  api: ClientAPI,
  engine: ListingTarget
): Promise<LogHandle[]> => {
  const localFiles = engine.listing();
  const epoch = engine.epoch();
  const mtime = Math.max(0, ...localFiles.map((file) => file.mtime || 0));

  // A local listing with no mtime data is just a static list — no
  // incremental sync is possible, only a wholesale compare of names.
  const staticList = localFiles.length > 0 && mtime === 0;
  if (staticList) {
    const serverLogs = await api.get_logs(0, 0);
    const localNames = new Set(localFiles.map((file) => file.name));
    const changed =
      serverLogs.files.length !== localFiles.length ||
      serverLogs.files.some((file) => !localNames.has(file.name));

    if (changed) {
      // Invalidate everything and activate the new list.
      return engine.applyListing({
        listing: serverLogs.files,
        invalidated: localFiles.map((file) => file.name),
        deleted: [],
        persistListing: false,
        epoch,
      });
    }
    // Unchanged: re-activate the current listing (backfilling any gaps).
    return engine.applyListing({
      listing: localFiles,
      invalidated: [],
      deleted: [],
      persistListing: false,
      epoch,
    });
  }

  // Fetch the updated list of logs from the server
  const response = await api.get_logs(mtime, localFiles.length);
  const updatedLogs = response.files;
  if (response.response_type === "incremental" && updatedLogs.length === 0) {
    // No listing churn to apply, but `applyListing` was also the only thing
    // re-arming interrupted/failed backfill — keep that alive on no-change
    // ticks or a reload mid-backfill never finishes fetching.
    await engine.requeueMissing();
    return localFiles;
  }

  const localByName = new Map(localFiles.map((file) => [file.name, file]));
  const updatedByName = new Map(updatedLogs.map((file) => [file.name, file]));

  // Incremental payloads are patches, so retain every unmentioned handle.
  // Brand-new files go to the head: the server lists newest-first (mtime
  // desc) and an incremental payload only holds files newer than every
  // local mtime, so this matches the order a full response would produce —
  // cache-only scopes render raw listing order, and a tail append would pin
  // fresh logs to the bottom while DB-mode reads sort them on top.
  const listing =
    response.response_type === "full"
      ? updatedLogs
      : [
          ...updatedLogs.filter((file) => !localByName.has(file.name)),
          ...localFiles.map((file) => updatedByName.get(file.name) ?? file),
        ];

  const deleted =
    response.response_type === "full"
      ? localFiles
          .filter((current) => !updatedByName.has(current.name))
          .map((file) => file.name)
      : [];

  // Files that are new, or whose remote mtime is newer than the local copy
  // (or whose mtimes are missing, in which case assume changed).
  const invalidated = updatedLogs
    .filter((remoteLog) => {
      const localCopy = localByName.get(remoteLog.name);
      if (!localCopy) {
        return true;
      }
      if (remoteLog.mtime && localCopy.mtime) {
        return remoteLog.mtime > localCopy.mtime;
      }
      return true;
    })
    .map((file) => file.name);

  return engine.applyListing({
    listing,
    invalidated,
    deleted,
    persistListing: true,
    epoch,
  });
};
