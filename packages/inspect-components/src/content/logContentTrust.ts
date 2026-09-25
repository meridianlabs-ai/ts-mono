import type { ContentTrust } from "@tsmono/react/components";
import { isRecord } from "@tsmono/util";

interface HeaderWithViewer {
  eval?: { viewer?: unknown } | null;
}

/**
 * The trust of a log's content, from its header's `eval.viewer.trust_content`.
 *
 * - No header yet (still loading): untrusted, so nothing renders richly
 *   before the log's setting is known.
 * - No viewer config, or `trust_content` absent / null / true: trusted
 *   (logs written before the setting existed expect rich rendering).
 * - Anything else — `false`, or a value a newer format might introduce —
 *   untrusted, so unrecognized settings fail safe.
 */
export const logContentTrust = (
  header: HeaderWithViewer | null | undefined
): ContentTrust => {
  if (!header) {
    return "untrusted";
  }
  const viewer = header.eval?.viewer;
  if (viewer === undefined || viewer === null) {
    return "trusted";
  }
  if (!isRecord(viewer)) {
    return "untrusted";
  }
  const trustContent = viewer.trust_content;
  return trustContent === undefined ||
    trustContent === null ||
    trustContent === true
    ? "trusted"
    : "untrusted";
};
