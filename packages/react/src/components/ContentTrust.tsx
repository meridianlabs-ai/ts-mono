import clsx from "clsx";
import { FC, ReactNode } from "react";

import { revealHiddenCharacters } from "@tsmono/util";

import styles from "./ContentTrust.module.css";
import {
  useContentPolicy,
  useHasAllContentPermissions,
} from "./ContentTrustContext";

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
 * How a caller-rendered container shows log-derived plain text, decided as
 * `ContentText` decides: as-is with every permission, otherwise with hidden
 * characters revealed and the container's bidi runs isolated.
 */
export const usePlainText = (): {
  trusted: boolean;
  present: (text: string) => string;
  className: string | undefined;
} =>
  useHasAllContentPermissions()
    ? { trusted: true, present: (text) => text, className: undefined }
    : {
        trusted: false,
        present: untrustedText,
        className: untrustedTextClassName,
      };

const UntrustedText: FC<{ text: string }> = ({ text }) => (
  <span className={styles.untrustedInlineText}>{untrustedText(text)}</span>
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
