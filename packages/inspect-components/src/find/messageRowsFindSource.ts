import { findTermOccurrences } from "@tsmono/react/find";
import type { FindMatch, FindSource } from "@tsmono/react/find";

import { messageSearchText } from "../chat/messageSearchText";
import type { MessageRow } from "../chat/rowsModel";

import { createMaterializedFindSource } from "./materializedFindSource";

export const MESSAGES_FIND_SCOPE = "messages";

/**
 * The default messages source: messageSearchText over the resolved message
 * rows, in row order. Anchor = the row's head message id; occurrence runs
 * across the row's projected texts. Rows without a message id can't be
 * anchored (or revealed), so they're excluded from the projection.
 */
export function createMessageRowsFindSource(rows: MessageRow[]): FindSource {
  return createMaterializedFindSource({
    scopeId: MESSAGES_FIND_SCOPE,
    materialize: (term) => {
      const out: FindMatch[] = [];
      rows.forEach((row, ordinal) => {
        const id = row.resolved.message.id;
        if (!id) return;
        let occurrence = 0;
        for (const text of messageSearchText(row.resolved)) {
          const count = findTermOccurrences(text, term).length;
          for (let i = 0; i < count; i++) {
            out.push({ anchor: { kind: "message", id }, occurrence, ordinal });
            occurrence++;
          }
        }
      });
      return out;
    },
  });
}
