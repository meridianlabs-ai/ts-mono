import clsx from "clsx";
import { FC, ReactNode, useCallback, useState } from "react";

import type { ToolCall } from "@tsmono/inspect-common/types";
import { resolveToolInput, ToolInput } from "@tsmono/inspect-components/chat";
import {
  MarkdownDivWithReferences,
  type MarkdownReference,
} from "@tsmono/react/components";
import { useResizeObserver } from "@tsmono/react/hooks";
import { isRecord } from "@tsmono/util";

import styles from "./ToolCheckInset.module.css";

export type CheckTone = "neutral" | "reject" | "modify";
export type CheckRegion = "input" | "output";

interface CheckInsetProps {
  region: CheckRegion;
  tone: CheckTone;
  children?: ReactNode;
}

/** The panel that holds one stage's checks inside a tool block region. */
export const CheckInset: FC<CheckInsetProps> = ({ region, tone, children }) => (
  <div
    className={clsx(
      styles.inset,
      region === "output" && styles.output,
      tone === "reject" && styles.reject,
      tone === "modify" && styles.modify
    )}
  >
    {children}
  </div>
);

interface CheckToggle {
  label: string;
  open: boolean;
  onToggle: () => void;
}

interface CheckSummaryProps {
  icon: string;
  iconClassName?: string;
  verdict: string;
  verdictClassName?: string;
  /** Who made the decision; monospace unless `whoSuffix` is all there is. */
  who?: string;
  whoSuffix?: string;
  reason?: string;
  reasonClassName?: string;
  /** Links the cites in the reason. */
  references?: MarkdownReference[];
  /** The error of a failed check, shown preformatted in place of a reason. */
  error?: string;
  scores?: string[];
  flagged?: boolean;
  /** How many checks failed. */
  failed?: number;
  /** Expands the detail beneath the summary. */
  toggle?: CheckToggle;
  /** Clamps a long reason to two lines while the detail holding it in full is closed. */
  clampReason?: boolean;
}

/** One row naming the result that took effect for a stage. */
export const CheckSummary: FC<CheckSummaryProps> = ({
  icon,
  iconClassName,
  verdict,
  verdictClassName,
  who,
  whoSuffix,
  reason,
  reasonClassName,
  references,
  error,
  scores,
  flagged,
  failed,
  toggle,
  clampReason,
}) => {
  const [reasonOpen, setReasonOpen] = useState(false);
  const [overflows, setOverflows] = useState(false);
  const clamped = !!clampReason && !reasonOpen;
  // Measured only while clamped, so "less" stays once the reason is open.
  const measureReason = useCallback(
    (entry: ResizeObserverEntry) => {
      const text = entry.target.firstElementChild;
      if (!clamped || !(text instanceof HTMLElement)) return;
      setOverflows(text.scrollHeight - text.clientHeight > 1);
    },
    [clamped]
  );
  const reasonRef = useResizeObserver(measureReason);
  const clampable = !!clampReason && overflows;
  return (
    <div className={styles.summary}>
      <i
        className={clsx(icon, styles.icon, iconClassName)}
        aria-hidden="true"
      />
      <span className={clsx(styles.verdict, verdictClassName)}>{verdict}</span>
      {who ? (
        <span className={styles.who}>
          by <span className={styles.mono}>{who}</span>
          {whoSuffix}
        </span>
      ) : null}
      {scores?.map((score, i) => (
        <span key={i} className={styles.scores}>
          {score}
        </span>
      ))}
      {error ? (
        <pre className={clsx(styles.reason, styles.error)}>{error}</pre>
      ) : reason ? (
        <div ref={reasonRef} className={styles.reasonWrap}>
          <MarkdownDivWithReferences
            markdown={reason}
            references={references}
            className={clsx(
              styles.reason,
              clamped && styles.clamped,
              reasonClassName
            )}
          />
          {clampable ? (
            <button
              type="button"
              className={styles.more}
              aria-expanded={reasonOpen}
              onClick={() => setReasonOpen(!reasonOpen)}
            >
              {reasonOpen ? "less" : "more"}
            </button>
          ) : null}
        </div>
      ) : null}
      {flagged || failed || toggle ? (
        <span className={styles.trailing}>
          {flagged ? (
            <span className={styles.chip}>
              <i className="bi bi-flag-fill" aria-hidden="true" />
              flagged
            </span>
          ) : null}
          {failed ? (
            <span className={styles.chip}>
              <i className="bi bi-exclamation-triangle" aria-hidden="true" />
              {`${failed} failed`}
            </span>
          ) : null}
          {toggle ? (
            <button
              type="button"
              className={styles.pill}
              aria-expanded={toggle.open}
              onClick={toggle.onToggle}
            >
              {toggle.label}
              <i
                className={clsx(
                  toggle.open ? "bi bi-chevron-down" : "bi bi-chevron-right",
                  styles.pillChevron
                )}
                aria-hidden="true"
              />
            </button>
          ) : null}
        </span>
      ) : null}
    </div>
  );
};

/** Whether two tool call argument values are equal, key order aside. */
export const sameArguments = (a: unknown, b: unknown): boolean => {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((value, i) => sameArguments(value, b[i]))
    );
  }
  if (!isRecord(a) || !isRecord(b)) return false;
  const keys = Object.keys(a);
  return (
    keys.length === Object.keys(b).length &&
    keys.every((key) => Object.hasOwn(b, key) && sameArguments(a[key], b[key]))
  );
};

interface ReplacedCallProps {
  call: ToolCall;
  /** Names the struck call: the model's proposal unless an earlier check replaced it. */
  label?: "proposed" | "replaced";
}

/** A call as the check was given it, struck through: the call that ran is the tool's input. */
export const ReplacedCall: FC<ReplacedCallProps> = ({
  call,
  label = "proposed",
}) => {
  const { input, contentType, functionCall } = resolveToolInput(
    call.function,
    call.arguments
  );
  return (
    <div className={styles.replaced}>
      <span className={clsx(styles.label, styles.modifyText)}>{label}</span>
      <div className={clsx(styles.code, styles.struck)}>
        {input !== undefined && input !== null && input !== "" ? (
          <ToolInput contentType={contentType} contents={input} />
        ) : (
          functionCall
        )}
      </div>
    </div>
  );
};

interface NotRunWellProps {
  /** What the model received as the tool result; unset when it received nothing. */
  message?: string;
}

/** Stands in for the result region of a call that never ran. */
export const NotRunWell: FC<NotRunWellProps> = ({ message }) => (
  <div className={styles.notRun}>
    <i className="bi bi-slash-circle" aria-hidden="true" />
    <div className={styles.notRunBody}>
      {message !== undefined ? (
        <>
          <span>Did not run. The model received this as the tool result:</span>
          <div className={styles.message}>
            <span className={styles.label}>error</span>
            <span className={styles.messageText}>{message}</span>
          </div>
        </>
      ) : (
        <span>Did not run. The sample was terminated.</span>
      )}
    </div>
  </div>
);

/** Verdict colours and shared type styles for the check views. */
export const checkClasses = {
  approveIcon: styles.approveIcon,
  approveText: styles.approveText,
  rejectIcon: styles.rejectIcon,
  rejectText: styles.rejectText,
  rejectReason: styles.rejectReason,
  modifyIcon: styles.modifyIcon,
  modifyText: styles.modifyText,
  label: styles.label,
  mono: styles.mono,
};
