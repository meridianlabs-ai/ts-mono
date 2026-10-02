/**
 * Policy chains: a call can be decided by several independent chains of
 * approvers (or reviewers). Each approver records its own event tagged with
 * its chain, and a summary `policy` event records the combined decision with
 * every chain's outcome in its metadata. These helpers read that structure so
 * the tool panel can render it as a tree: verdict first, then each chain with
 * its approvers in order.
 */

import type { ApprovalEvent, ReviewEvent } from "@tsmono/inspect-common/types";

import type { EventNode } from "../types";

export interface ChainOutcome {
  decision: string;
  explanation: string | null;
}

export interface ChainGroup<E extends ApprovalEvent | ReviewEvent> {
  name: string;
  outcome: ChainOutcome;
  /** The chain's own events, in transcript order. Empty for a cancelled chain. */
  nodes: EventNode<E>[];
}

export interface ChainGroups<E extends ApprovalEvent | ReviewEvent> {
  /** The `policy` event carrying the combined decision. */
  summary: EventNode<E>;
  chains: ChainGroup<E>[];
}

const DEFAULT_CHAIN = "default";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const sourceOf = (event: ApprovalEvent | ReviewEvent): string =>
  "approver" in event ? event.approver : event.reviewer;

/** The per-chain outcomes a policy summary event carries in its metadata. */
export const chainOutcomes = (
  event: ApprovalEvent | ReviewEvent
): Record<string, ChainOutcome> | undefined => {
  if (sourceOf(event) !== "policy" || !isRecord(event.metadata))
    return undefined;
  const chains = event.metadata.chains;
  if (!isRecord(chains)) return undefined;
  const outcomes: Record<string, ChainOutcome> = {};
  for (const [name, outcome] of Object.entries(chains)) {
    if (isRecord(outcome) && "decision" in outcome) {
      outcomes[name] = {
        decision: String(outcome.decision),
        explanation:
          typeof outcome.explanation === "string" ? outcome.explanation : null,
      };
    }
  }
  return Object.keys(outcomes).length > 0 ? outcomes : undefined;
};

/**
 * Arrange a call's approval (or review) nodes as chains under their summary.
 * Returns undefined when no summary is present, i.e. a single chain decided
 * and the flat, chronological rendering is right.
 */
export function groupByChain<E extends ApprovalEvent | ReviewEvent>(
  nodes: EventNode<E>[]
): ChainGroups<E> | undefined {
  const summary = nodes.findLast(
    (node) => chainOutcomes(node.event) !== undefined
  );
  if (!summary) return undefined;
  const outcomes = chainOutcomes(summary.event)!;
  const chains: ChainGroup<E>[] = Object.entries(outcomes).map(
    ([name, outcome]) => ({ name, outcome, nodes: [] })
  );
  const byName = new Map(chains.map((chain) => [chain.name, chain]));
  for (const node of nodes) {
    if (node === summary) continue;
    const name = node.event.chain ?? DEFAULT_CHAIN;
    let chain = byName.get(name);
    if (!chain) {
      chain = { name, outcome: { decision: "", explanation: null }, nodes: [] };
      byName.set(name, chain);
      chains.push(chain);
    }
    chain.nodes.push(node);
  }
  return { summary, chains };
}
