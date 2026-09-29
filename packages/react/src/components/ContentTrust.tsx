import clsx from "clsx";
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

// The most trust any content below may have (e.g. a viewer-wide setting).
const ContentTrustCeilingContext = createContext<ContentTrust>("trusted");

export const ContentTrustProvider: FC<{
  value: ContentTrust;
  children: ReactNode;
}> = ({ value, children }) => (
  <ContentTrustContext.Provider value={value}>
    {children}
  </ContentTrustContext.Provider>
);

/**
 * Caps the trust of everything below it, whatever the nearer
 * `ContentTrustProvider`s say. A nested ceiling can only lower it further.
 */
export const ContentTrustCeilingProvider: FC<{
  value: ContentTrust;
  children: ReactNode;
}> = ({ value, children }) => {
  const parent = useContext(ContentTrustCeilingContext);
  return (
    <ContentTrustCeilingContext.Provider
      value={combineContentTrust([parent, value])}
    >
      {children}
    </ContentTrustCeilingContext.Provider>
  );
};

export const useContentTrust = (): ContentTrust =>
  combineContentTrust([
    useContext(ContentTrustCeilingContext),
    useContext(ContentTrustContext),
  ]);

export const useIsContentTrusted = (): boolean =>
  useContentTrust() === "trusted";

/** The text form untrusted content is shown in, hidden characters revealed. */
export const untrustedText = (text: string): string =>
  revealHiddenCharacters(text);

/**
 * Class for the element that holds `untrustedText` output: isolates its bidi
 * runs so they can't reorder surrounding UI text. Apply to the container
 * (a `pre`, `div` or `span`) that renders untrusted text directly.
 */
export const untrustedTextClassName: string = styles.untrustedText;

/**
 * Matches elements marked as holding untrusted content, which DOM-level
 * enhancers (syntax highlighting) must leave alone.
 */
export const kUntrustedContentSelector = '[data-content-trust="untrusted"]';

const UntrustedText: FC<{ text: string }> = ({ text }) => (
  <span className={untrustedTextClassName}>{untrustedText(text)}</span>
);

/**
 * Log-derived text rendered as plain text: as-is when trusted, with hidden
 * characters revealed and bidi runs isolated when not.
 */
export const ContentText: FC<{ text: string }> = ({ text }) =>
  useIsContentTrusted() ? text : <UntrustedText text={text} />;

/**
 * A `code` element whose only child is log-derived text, as `ContentText`
 * would render it. Prism replaces a highlighted element's children, so the
 * text must be the element's own content (React then updates it by resetting
 * `textContent`) rather than a nested text node React would try to patch or
 * remove after Prism has discarded it. Remounts when trust changes, so
 * untrusted content never inherits a trusted highlight.
 */
export const ContentCode: FC<{
  text: string;
  id?: string;
  className?: string;
}> = ({ text, id, className }) =>
  useIsContentTrusted() ? (
    <code key="trusted" id={id} className={className}>
      {text}
    </code>
  ) : (
    <code
      key="untrusted"
      id={id}
      className={clsx(className, untrustedTextClassName)}
      data-content-trust="untrusted"
    >
      {untrustedText(text)}
    </code>
  );

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
    {detail ? (
      <>
        {" ("}
        <UntrustedText text={detail} />)
      </>
    ) : null}
    ]
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
