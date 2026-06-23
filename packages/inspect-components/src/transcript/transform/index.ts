// Pure event-tree transforms — no React, no CSS, no peer deps.
// Exposed as a subpath so consumers that only need the span-tree
// logic don't have to satisfy the package's UI peerDependencies.

export { treeifyEvents } from "./treeify";
export {
  flatTree,
  findAncestorIds,
  findCollapsedAncestors,
  type TreeNodeVisitor,
} from "./flatten";
export { transformTree } from "./transform";
export { pairToolApprovals, type ToolApprovalPairing } from "./toolApprovals";
export { fixupEventStream, kSandboxSignalName } from "./fixups";
export * from "./utils";

export {
  EventNode,
  type EventType,
  type EventTypeValue,
  type EventNodeSpan,
  eventTypeValues,
} from "../types";
