import { isUri, join } from "@tsmono/util";

import { UrlLogSource } from "./urlLogSource";

/**
 * A log location named by the page URL (`?log_dir=` / `?log_file=`) that the
 * browser itself would fetch from somewhere other than the page's own origin.
 * Receiving a link is not authority to contact an arbitrary host, so config
 * resolution waits on the user approving it (#615). Same-origin locations need
 * no approval: they reach nothing the page's own scripts couldn't already.
 * Embedded config and the VS Code host set the location; they never propose.
 */
export interface LogLocationProposal {
  kind: "dir" | "file";
  /** The location exactly as the link named it. */
  location: string;
  /** The origin that would be contacted, or the whole location when it has
   *  no origin to speak of (`data:`, an unparseable value). */
  origin: string;
}

export const proposeLogLocation = (
  source: UrlLogSource,
  page: URL = new URL(document.baseURI)
): LogLocationProposal | undefined => {
  if (source.kind === "none") return undefined;
  const location = source.kind === "dir" ? source.logDir : source.logFile;
  let resolved: URL;
  try {
    resolved = new URL(location, page);
  } catch {
    return { kind: source.kind, location, origin: location };
  }
  if (resolved.protocol === page.protocol && resolved.host === page.host) {
    return undefined;
  }
  return {
    kind: source.kind,
    location,
    origin: resolved.origin === "null" ? resolved.href : resolved.origin,
  };
};

const isUnderDir = (file: string, dir: string): boolean => {
  try {
    const base = document.baseURI;
    const dirHref = new URL(dir.endsWith("/") ? dir : `${dir}/`, base).href;
    return new URL(file, base).href.startsWith(dirHref);
  } catch {
    return false;
  }
};

/**
 * Absolutize a route-supplied log name against the resolved log dir. When the
 * browser fetches directly, a route can't widen the scope: the result must sit
 * inside that dir. Listing entries always do; a foreign location only arrives
 * through a crafted `#/logs/<url>` link, whose `?log_file=` form is the one
 * that gets the approval gate. Proxied backends keep the name as given: the
 * server or host applies its own policy to it.
 */
export const scopeRouteLogFile = (
  logFile: string,
  logDir: string,
  browserDirect: boolean
): string => {
  const resolved = isUri(logFile) ? logFile : join(logFile, logDir);
  if (browserDirect && !isUnderDir(resolved, logDir)) {
    throw new Error(
      `Refusing to load a log outside the configured log directory: ${logFile}`
    );
  }
  return resolved;
};
