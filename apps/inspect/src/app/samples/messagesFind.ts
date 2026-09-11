import type { FindMessages } from "@tsmono/inspect-components/chat";

import type { ClientAPI } from "../../client/api/types";
import type { SampleHandle } from "../types";

import {
  defaultFindPageCache,
  findPageCacheKey,
  type FindPageCache,
} from "./findPageCache";

/** The Messages tab's find source over `api.find_messages`, or undefined when
 *  the backend has none (the tab then registers no find surface). Sealed
 *  pages are LRU-cached so a backspace to a term already scanned does not
 *  POST again; live samples are not stored. */
export const messagesFindSource = (
  api: Pick<ClientAPI, "find_messages">,
  sample: SampleHandle,
  cache: FindPageCache = defaultFindPageCache
): FindMessages | undefined => {
  const find = api.find_messages;
  if (!find) return undefined;
  const scopeId = `messages:${sample.logFile}#${sample.id}#${sample.epoch}`;
  return {
    scopeId,
    find: async (query, after, signal) => {
      const key = findPageCacheKey(sample, query, after);
      const hit = cache.get(key);
      if (hit) return hit;
      const response = await find(
        sample.logFile,
        {
          sample_id: sample.id,
          epoch: sample.epoch,
          text: query.text,
          after: after?.id,
          projection: {
            unlabeled_roles: query.projection.unlabeledRoles,
            tool_call_style: query.projection.toolCallStyle,
            display_mode: query.projection.displayMode,
          },
        },
        signal
      );
      const page = {
        rows: response.rows.map((row) => ({
          anchor: { id: row.anchor },
          index: row.index,
          count: row.count,
          texts: row.texts,
        })),
        atEnd: response.at_end,
        complete: response.complete,
      };
      if (!page.complete) cache.dropSample(sample);
      else cache.set(key, page);
      return page;
    },
  };
};
