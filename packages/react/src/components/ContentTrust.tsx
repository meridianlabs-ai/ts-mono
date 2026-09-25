import { createContext, FC, ReactNode, useContext } from "react";

import { revealHiddenCharacters } from "@tsmono/util";

import styles from "./ContentTrust.module.css";

/**
 * Whether content may be rendered richly (markdown, math, syntax
 * highlighting, ANSI colors, media, links). Untrusted content is shown as
 * inert plain text.
 */
export type ContentTrust = "trusted" | "untrusted";

// Untrusted by default: content outside any provider (a new view, a missing
// wrapper, a log whose trust isn't known yet) must fail safe.
const ContentTrustContext = createContext<ContentTrust>("untrusted");

export const ContentTrustProvider: FC<{
  value: ContentTrust;
  children: ReactNode;
}> = ({ value, children }) => (
  <ContentTrustContext.Provider value={value}>
    {children}
  </ContentTrustContext.Provider>
);

export const useContentTrust = (): ContentTrust =>
  useContext(ContentTrustContext);

export const useIsContentTrusted = (): boolean =>
  useContentTrust() === "trusted";

/** The text form untrusted content is shown in, hidden characters revealed. */
export const untrustedText = (text: string): string =>
  revealHiddenCharacters(text);

/**
 * Renders `children` (media, an embedded player, a link) only when content is
 * trusted; otherwise a placeholder naming what was withheld.
 */
export const RequireTrustedContent: FC<{
  kind: string;
  detail?: string;
  children: ReactNode;
}> = ({ kind, detail, children }) =>
  useIsContentTrusted() ? (
    children
  ) : (
    <UntrustedContentPlaceholder kind={kind} detail={detail} />
  );

/** Stands in for media or an embedded player whose content isn't trusted. */
export const UntrustedContentPlaceholder: FC<{
  kind: string;
  detail?: string;
}> = ({ kind, detail }) => (
  <span className={styles.placeholder} data-untrusted-placeholder={kind}>
    [{kind} not shown: log content is untrusted
    {detail ? ` (${untrustedText(detail)})` : ""}]
  </span>
);

/**
 * Trust of content assembled from several sources: trusted only when every
 * source is trusted (and there is at least one).
 */
export const combineContentTrust = (
  trusts: readonly ContentTrust[]
): ContentTrust =>
  trusts.length > 0 && trusts.every((trust) => trust === "trusted")
    ? "trusted"
    : "untrusted";
