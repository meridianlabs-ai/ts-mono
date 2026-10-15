import { OpenDatabase } from "../client/database";

let current: OpenDatabase | null = null;
let opening: Promise<OpenDatabase> | null = null;
// Bumped by `releaseDatabase`, so an open it abandoned can't install itself.
let released = 0;

/**
 * Open the app database once and share the handle; concurrent callers
 * coalesce onto the in-flight open, and a failed open clears it so the next
 * acquisition retries (activation relies on this — see `engineReady`).
 */
export async function acquireDatabase(): Promise<OpenDatabase> {
  if (current) {
    return current;
  }
  if (!opening) {
    const generation = released;
    opening = OpenDatabase.open().then(
      (db) => {
        if (generation !== released) {
          // Released while opening: this handle is not the shared one.
          db.close();
          throw new Error("Database released while opening");
        }
        current = db;
        opening = null;
        return db;
      },
      (error: unknown) => {
        if (generation === released) opening = null;
        throw error;
      }
    );
  }
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
 * fresh one. Test teardown only, like `OpenDatabase.close`: production holds
 * the handle for the life of the page.
 */
export const releaseDatabase = (): void => {
  released += 1;
  current?.close();
  current = null;
  opening = null;
};
