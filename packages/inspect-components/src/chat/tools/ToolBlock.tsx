import clsx from "clsx";
import { FC, ReactNode, useEffect, useRef, useState } from "react";

import { registerFindExpandable } from "@tsmono/react/find";

import styles from "./ToolBlock.module.css";

interface ToolBlockProps {
  id?: string;
  /** Bootstrap icon class for the tool kind (terminal = client, globe = server). */
  icon: string;
  /** Tool name, rendered in monospace with the tool accent color. */
  title: string;
  /** Single-line args summary; ellipsized, never wraps. */
  summary?: string;
  /** Optional neutral pill after the title (e.g. "server"). */
  pill?: string;
  /** Flush rows (server calls inside the assistant turn) carry no container
   * border of their own — the turn container frames them. */
  flush?: boolean;
  className?: string | string[];
  children?: ReactNode;
}

/**
 * The shared tool-call block grammar: a tinted header row (tool icon · mono
 * tool name · optional pill · args summary) with the tool's input/output
 * zones stacked beneath it.
 */
export const ToolBlock: FC<ToolBlockProps> = ({
  id,
  icon,
  title,
  summary,
  pill,
  flush,
  className,
  children,
}) => {
  return (
    <div
      id={id}
      className={clsx(
        styles.block,
        flush ? undefined : styles.standalone,
        className
      )}
    >
      <div className={styles.header}>
        <i className={clsx("bi", icon, styles.icon)} />
        <span className={styles.title}>{title}</span>
        {summary ? <SummaryStrip>{summary}</SummaryStrip> : null}
        {pill ? <span className={styles.pill}>{pill}</span> : null}
      </div>
      {children}
    </div>
  );
};

/** The one-line ellipsized args summary. For tools without a dedicated input
 * zone the full args text lives ONLY on this line, so find-in-page reveals a
 * horizontally clipped match by wrapping the strip itself: the strip registers
 * as an expand boundary and the FindController expands/reverts it (an overlay —
 * never persisted). */
const SummaryStrip: FC<{ children: string }> = ({ children }) => {
  const [findExpanded, setFindExpanded] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    return registerFindExpandable(element, {
      // DOM truth: nowrap + ellipsis clips iff the line overflows (1px
      // tolerance for sub-pixel rounding); once wrapped, nothing overflows.
      isClipped: () => element.scrollWidth > element.clientWidth + 1,
      expand: () => setFindExpanded(true),
      collapse: () => setFindExpanded(false),
    });
  }, []);
  return (
    <span
      ref={ref}
      className={clsx(styles.summary, findExpanded && styles.summaryExpanded)}
    >
      {children}
    </span>
  );
};

/** Input zone (e.g. code) — code fill, hairline top. */
export const ToolBlockInput: FC<{
  className?: string | string[];
  children?: ReactNode;
}> = ({ className, children }) => {
  return <div className={clsx(styles.inputZone, className)}>{children}</div>;
};

/** Output well — faint fill, hairline top; content is whatever the tool
 * returned, rendered by the caller. */
export const ToolBlockOutput: FC<{
  className?: string | string[];
  children?: ReactNode;
}> = ({ className, children }) => {
  return <div className={clsx(styles.outputWell, className)}>{children}</div>;
};
