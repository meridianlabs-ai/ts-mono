import { OpenDatabase } from "../client/database";

let current: OpenDatabase | null = null;
let opening: Promise<OpenDatabase> | null = null;

/**
 * Open the app database once and share the handle; concurrent callers
 * coalesce onto the in-flight open, and a failed open clears it so the next
 * acquisition retries (activation relies on this — see `engineReady`).
 */
export async function acquireDatabase(): Promise<OpenDatabase> {
  if (current) {
    return current;
  }
  opening ??= OpenDatabase.open().then(
    (db) => {
      current = db;
      opening = null;
      return db;
    },
    (error: unknown) => {
      opening = null;
      throw error;
    }
  );
  return opening;
}

/**
 * The shared open handle, or null when this session has none — before the
 * first successful open, and forever in single-file sessions (which never
 * open one; their reads miss and writes stay cache-only).
 */
export const currentDatabase = (): OpenDatabase | null => current;

/**
 * Close and forget the shared handle, so the next `acquireDatabase` opens a
 * fresh one. Waits for an open in flight, so that open can't install itself
 * after the release. Test teardown only: the app holds the handle for the
 * life of the page.
 */
export const releaseDatabase = async (): Promise<void> => {
  const db = current ?? (await opening?.catch(() => null));
  db?.close();
  current = null;
  opening = null;
};
