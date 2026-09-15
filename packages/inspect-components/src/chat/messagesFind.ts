import type { FindAnchor, FindPage } from "@tsmono/react/find";

import type { DisplayMode } from "../content/DisplayModeContext";

import type { ChatViewToolCallStyle } from "./types";

/** The view configuration the Messages rows render with; a source searches
 *  the text of the same rows under it. */
export interface MessagesFindProjection {
  unlabeledRoles: string[];
  toolCallStyle: ChatViewToolCallStyle;
  /** Raw mode shows markdown source (link URLs and all), so the source must
   *  search it unstripped. */
  displayMode: DisplayMode;
}

export interface MessagesFindQuery {
  text: string;
  projection: MessagesFindProjection;
}

/** Backend find over the whole conversation the list shows. Hosts without a
 *  backend leave it undefined and the list registers no find surface. */
export interface FindMessages {
  /** Names the conversation searched (one sample); a different scope starts
   *  find afresh instead of relocating by anchor. */
  scopeId: string;
  /** The matching rows strictly after `after` (from the top when undefined),
   *  anchored by `messageRowAnchorIds`. */
  find: (
    query: MessagesFindQuery,
    after: FindAnchor | undefined,
    signal: AbortSignal
  ) => Promise<FindPage>;
}
