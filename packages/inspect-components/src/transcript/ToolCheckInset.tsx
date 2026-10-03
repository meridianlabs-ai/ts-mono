import clsx from "clsx";
import { FC, ReactNode } from "react";

import type { ToolCall } from "@tsmono/inspect-common/types";
import { resolveToolInput, ToolInput } from "@tsmono/inspect-components/chat";
import { MarkdownDiv } from "@tsmono/react/components";

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
  scores?: string[];
  flagged?: boolean;
  /** How many checks failed. */
  failed?: number;
  checks?: number;
  open?: boolean;
  onToggle?: () => void;
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
  scores,
  flagged,
  failed,
  checks,
  open,
  onToggle,
}) => (
  <div className={styles.summary}>
    <i className={clsx(icon, styles.icon, iconClassName)} />
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
    {reason ? (
      <MarkdownDiv
        markdown={reason}
        className={clsx(
          styles.reason,
          checks !== undefined && checks > 1 && styles.clamped,
          reasonClassName
        )}
      />
    ) : null}
    {flagged || failed || (checks !== undefined && checks > 1) ? (
      <span className={styles.trailing}>
        {flagged ? (
          <span className={styles.chip}>
            <i className="bi bi-flag-fill" />
            flagged
          </span>
        ) : null}
        {failed ? (
          <span className={styles.chip}>
            <i className="bi bi-exclamation-triangle" />
            {`${failed} failed`}
          </span>
        ) : null}
        {checks !== undefined && checks > 1 ? (
          <button
            type="button"
            className={styles.pill}
            aria-expanded={!!open}
            onClick={onToggle}
          >
            {`${checks} checks`}
            <i
              className={clsx(
                open ? "bi bi-chevron-down" : "bi bi-chevron-right",
                styles.pillChevron
              )}
            />
          </button>
        ) : null}
      </span>
    ) : null}
  </div>
);

/** The call that ran in place of the original, syntax highlighted. */
export const ReplacementCall: FC<{ call: ToolCall }> = ({ call }) => {
  const { input, contentType, functionCall } = resolveToolInput(
    call.function,
    call.arguments
  );
  return (
    <div className={styles.code}>
      {input !== undefined && input !== null && input !== "" ? (
        <ToolInput contentType={contentType} contents={input} />
      ) : (
        functionCall
      )}
    </div>
  );
};

interface RanInsteadProps {
  call: ToolCall;
  /** Whether the replacement ran; one a later check blocked is only what the modify proposed. */
  ran?: boolean;
}

/** The replacement a modify decision ran instead of the original call. */
export const RanInstead: FC<RanInsteadProps> = ({ call, ran = true }) => (
  <div className={styles.ranInstead}>
    <span className={clsx(styles.label, styles.modifyText)}>
      {ran ? "ran instead" : "modified to"}
    </span>
    <ReplacementCall call={call} />
  </div>
);

interface NotRunWellProps {
  /** What the model received as the tool result; unset when it received nothing. */
  message?: string;
}

/** Stands in for the result region of a call that never ran. */
export const NotRunWell: FC<NotRunWellProps> = ({ message }) => (
  <div className={styles.notRun}>
    <i className="bi bi-slash-circle" />
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
