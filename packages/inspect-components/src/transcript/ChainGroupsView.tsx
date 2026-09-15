import clsx from "clsx";
import { ReactNode } from "react";

import type { ApprovalEvent, ReviewEvent } from "@tsmono/inspect-common/types";

import styles from "./ChainGroupsView.module.css";
import type { ChainGroups } from "./transform/chainOutcomes";
import type { EventNode } from "./types";

interface ChainGroupsViewProps<E extends ApprovalEvent | ReviewEvent> {
  groups: ChainGroups<E>;
  /** Renders the summary row (the combined decision). */
  renderSummary: (node: EventNode<E>) => ReactNode;
  /** Renders one approver's or reviewer's row; `position` is 1-based within its chain. */
  renderNode: (node: EventNode<E>, position: number) => ReactNode;
}

const alarming = (decision: string) =>
  decision === "reject" || decision === "terminate";

/**
 * A call decided by several policy chains: the combined verdict first, then
 * each chain as an indented block with its own decision and, numbered in the
 * order they were asked, the approvers (or reviewers) that produced it.
 */
export const ChainGroupsView = <E extends ApprovalEvent | ReviewEvent>({
  groups,
  renderSummary,
  renderNode,
}: ChainGroupsViewProps<E>) => (
  <div>
    {renderSummary(groups.summary)}
    {groups.chains.map((chain) => (
      <div key={chain.name} className={styles.chain}>
        <div className={clsx("text-style-secondary", styles.heading)}>
          chain &quot;{chain.name}&quot;:{" "}
          <span
            className={
              alarming(chain.outcome.decision) ? styles.alarming : undefined
            }
          >
            {chain.outcome.decision || "no decision"}
          </span>
          {chain.outcome.explanation && chain.nodes.length === 0 ? (
            <span className={styles.explanation}>
              {chain.outcome.explanation}
            </span>
          ) : null}
        </div>
        {chain.nodes.map((node, index) => (
          <div key={node.id} className={styles.step}>
            <span className={clsx("text-style-secondary", styles.position)}>
              {index + 1}.
            </span>
            <div className={styles.row}>{renderNode(node, index + 1)}</div>
          </div>
        ))}
      </div>
    ))}
  </div>
);
