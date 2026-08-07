import { type ReactNode, type RefObject } from "react";

import { useVirtualListFindSource } from "@tsmono/react/find";
import type { VirtualListHandle } from "@tsmono/react/virtual";

import type { MessageRow } from "../rowsModel";

export interface UseChatFindSourceOptions {
  items: readonly MessageRow[];
  renderRow: (index: number, item: MessageRow) => ReactNode;
  listHandle: RefObject<VirtualListHandle | null>;
  scrollRef?: RefObject<HTMLDivElement | null>;
}

/** Registers the Messages tab's flat chat list as a find source (the generic
 *  virtual-list source with its defaults: index keys — stable here because
 *  live chats only append). Returns the probe node for the caller to render. */
export function useChatFindSource(
  options: UseChatFindSourceOptions
): ReactNode {
  return useVirtualListFindSource<MessageRow>(options);
}
