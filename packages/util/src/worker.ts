export interface WorkerLauncher {
  start: () => Worker;
  release: () => void;
}

/**
 * How to start dedicated workers from a bundled worker script URL (a
 * `?worker&url` import).
 *
 * A same-origin script starts directly, which a `worker-src 'self'` policy
 * allows. The Worker constructor rejects a cross-origin script, and VS Code
 * webviews serve assets from a CDN origin, so there the script is fetched
 * and started from a Blob URL, which that host's own policy permits. Neither
 * path evaluates code.
 *
 * Workers start as modules because the dev server serves worker entries as
 * ES modules; the build's self-contained IIFE output runs either way.
 */
export const workerLauncher = async (
  scriptUrl: string
): Promise<WorkerLauncher> => {
  const url = new URL(scriptUrl, location.href);
  if (url.origin === location.origin) {
    return {
      start: () => new Worker(url, { type: "module" }),
      release: () => {},
    };
  }
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `Failed to load worker script ${url.href}: ${response.status}`
    );
  }
  const blobUrl = URL.createObjectURL(
    new Blob([await response.text()], { type: "text/javascript" })
  );
  return {
    start: () => new Worker(blobUrl, { type: "module" }),
    release: () => URL.revokeObjectURL(blobUrl),
  };
};
