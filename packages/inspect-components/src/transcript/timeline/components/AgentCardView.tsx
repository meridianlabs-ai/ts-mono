import clsx from "clsx";
import { FC, MouseEvent, useCallback, useMemo } from "react";

import { ExpandablePanel, MarkdownDiv } from "@tsmono/react/components";
import { formatDurationShort } from "@tsmono/util";

import { useTimelineSelect } from "../../TimelineSelectContext";
import {
  getSpanToolResult,
  getUtilityAgentLabel,
  type TimelineSpan,
} from "../core";
import { formatTokenCount } from "../swimlaneLayout";

import styles from "./AgentCardView.module.css";
import { useTimelineIcons } from "./TimelineIconsContext";

interface AgentCardViewProps {
  span: TimelineSpan;
  className?: string;
}

export const AgentCardView: FC<AgentCardViewProps> = ({ span, className }) => {
  const icons = useTimelineIcons();
  const select = useTimelineSelect();

  const handleClick = useCallback(() => {
    select?.(span.id);
  }, [select, span.id]);

  const stopPropagation = useCallback((e: MouseEvent) => {
    e.stopPropagation();
  }, []);

  const resultOutput = useMemo(() => getSpanToolResult(span), [span]);

  const isUtility = span.utility;
  const isBranch = span.spanType === "branch";
  const title = isUtility
    ? getUtilityAgentLabel(span)
    : span.name.toLowerCase();
  const tokens = formatTokenCount(span.totalTokens());
  const duration = formatDurationShort(span.startTime(), span.endTime());

  const iconClass = isBranch ? icons.fork : icons.agent;
  const label = isBranch ? "branch" : isUtility ? "utility" : "sub-agent";

  const cardClass = clsx(
    styles.card,
    isUtility && styles.utilityCard,
    isBranch && styles.branchCard,
    className
  );

  const content = (
    <>
      <div className={clsx(styles.header, "text-size-small")}>
        <i
          className={clsx(iconClass, styles.icon, "text-style-secondary")}
          aria-hidden="true"
        />
        <div
          className={clsx(
            styles.title,
            "text-style-secondary",
            "text-style-label"
          )}
        >
          {label}: {title}
        </div>
        <div />
        <div className={clsx(styles.meta, "text-style-secondary")}>
          {tokens} &middot; {duration}
        </div>
        {!isBranch && (
          <i
            className={clsx(
              icons.chevron.right,
              styles.disclosure,
              "text-style-secondary"
            )}
            aria-hidden="true"
          />
        )}
      </div>
      {!isUtility && span.description && (
        <div className={clsx(styles.description, "text-size-small")}>
          {span.description}
        </div>
      )}
      {resultOutput && (
        <div
          className={styles.resultPanel}
          role="presentation"
          onClick={stopPropagation}
        >
          <ExpandablePanel
            id={`agent-result-${span.id}`}
            collapse={true}
            lines={15}
          >
            <MarkdownDiv markdown={resultOutput} />
          </ExpandablePanel>
        </div>
      )}
    </>
  );

  // Branch cards are inert; every other card navigates to its sub-agent.
  if (isBranch) {
    return <div className={cardClass}>{content}</div>;
  }

  return (
    <div
      className={cardClass}
      role="button"
      tabIndex={0}
      onClick={handleClick}
      onKeyDown={(e) => {
        // Only the card itself: Enter/Space bubbling up from the result
        // panel's controls must keep its own default action.
        if (e.target !== e.currentTarget) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          handleClick();
        }
      }}
    >
      {content}
    </div>
  );
};
