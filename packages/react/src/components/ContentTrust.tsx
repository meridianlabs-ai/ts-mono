import clsx from "clsx";
import { createContext, FC, ReactNode, useContext } from "react";

import { revealHiddenCharacters } from "@tsmono/util";

import {
  ContentRenderingPolicy,
  intersectContentPolicies,
  isRichContentPolicy,
  plainContentPolicy,
  richContentPolicy,
} from "./contentRenderingPolicy";
import styles from "./ContentTrust.module.css";

/**
 * Coarse trust from application or log configuration, mapped to rendering
 * permissions by the source and ceiling providers.
 */
export type ContentTrust = "trusted" | "untrusted";

// Untrusted by default: content outside any provider (a new view, a missing
// wrapper, a log whose trust isn't known yet) must fail safe.
const ContentPolicyContext = createContext(plainContentPolicy);

// The most trust any content below may have (e.g. a viewer-wide setting).
const ContentPolicyCeilingContext = createContext(richContentPolicy);

export const ContentPolicyProvider: FC<{
  value: ContentRenderingPolicy;
  children: ReactNode;
}> = ({ value, children }) => (
  <ContentPolicyContext.Provider value={value}>
    {children}
  </ContentPolicyContext.Provider>
);

export const ContentPolicyCeilingProvider: FC<{
  value: ContentRenderingPolicy;
  children: ReactNode;
}> = ({ value, children }) => {
  const parent = useContext(ContentPolicyCeilingContext);
  return (
    <ContentPolicyCeilingContext.Provider
      value={intersectContentPolicies(parent, value)}
    >
      {children}
    </ContentPolicyCeilingContext.Provider>
  );
};

export const useContentPolicy = (): ContentRenderingPolicy =>
  intersectContentPolicies(
    useContext(ContentPolicyCeilingContext),
    useContext(ContentPolicyContext)
  );

export const ContentTrustProvider: FC<{
  value: ContentTrust;
  children: ReactNode;
}> = ({ value, children }) => (
  <ContentPolicyProvider
    value={value === "trusted" ? richContentPolicy : plainContentPolicy}
  >
    {children}
  </ContentPolicyProvider>
);

/**
 * Caps the trust of everything below it, whatever the nearer
 * `ContentTrustProvider`s say. A nested ceiling can only lower it further.
 */
export const ContentTrustCeilingProvider: FC<{
  value: ContentTrust;
  children: ReactNode;
}> = ({ value, children }) => (
  <ContentPolicyCeilingProvider
    value={value === "trusted" ? richContentPolicy : plainContentPolicy}
  >
    {children}
  </ContentPolicyCeilingProvider>
);

/** Arbitrary render callbacks require every rendering permission. */
export const useHasAllContentPermissions = (): boolean =>
  isRichContentPolicy(useContentPolicy());

/** The text form untrusted content is shown in, hidden characters revealed. */
export const untrustedText = (text: string): string =>
  revealHiddenCharacters(text);

/**
 * Class for the element that holds `untrustedText` output: isolates its bidi
 * runs so they can't reorder surrounding UI text. Apply to the container
 * (a `pre`, `div` or `span`) that renders untrusted text directly.
 */
export const untrustedTextClassName: string = styles.untrustedText;

const UntrustedText: FC<{ text: string }> = ({ text }) => (
  <span className={untrustedTextClassName}>{untrustedText(text)}</span>
);

/**
 * Log-derived text rendered as plain text: as-is when trusted, with hidden
 * characters revealed and bidi runs isolated when not.
 */
export const ContentText: FC<{ text: string }> = ({ text }) =>
  useHasAllContentPermissions() ? text : <UntrustedText text={text} />;

/**
 * A `code` element whose only child is log-derived text, as `ContentText`
 * would render it. Prism replaces a highlighted element's children, so the
 * text must be the element's own content (React then updates it by resetting
 * `textContent`) rather than a nested text node React would try to patch or
 * remove after Prism has discarded it. Remounts when trust changes, so a
 * trusted highlight never carries over to untrusted text.
 */
export const ContentCode: FC<{
  text: string;
  id?: string;
  className?: string;
}> = ({ text, id, className }) =>
  useContentPolicy().syntaxHighlighting ? (
    <code key="trusted" id={id} className={className}>
      {text}
    </code>
  ) : (
    <code
      key="untrusted"
      id={id}
      className={clsx(className, untrustedTextClassName)}
    >
      {untrustedText(text)}
    </code>
  );

/**
 * Renders media children when media is permitted; otherwise a placeholder.
 */
export const RequireMedia: FC<{
  kind: string;
  detail?: string;
  children: ReactNode;
}> = ({ kind, detail, children }) =>
  useContentPolicy().media ? (
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
