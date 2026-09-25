import type { MessagesFindQuery } from "@tsmono/inspect-components/chat";
import type { FindAnchor, FindPage } from "@tsmono/react/find";

import type { SampleHandle } from "../types";

// A guess: a million-hit scan was 39 pages; 128 holds a few paused terms
// before the oldest drops.
export const FIND_PAGE_CACHE_LIMIT = 128;

/** Sealed find-messages pages, keyed by the POST body identity. Live pages
 *  (`complete: false`) are never stored. */
export class FindPageCache {
  private readonly entries = new Map<string, FindPage>();

  constructor(readonly capacity: number = FIND_PAGE_CACHE_LIMIT) {}

  get(key: string): FindPage | undefined {
    const page = this.entries.get(key);
    if (page === undefined) return undefined;
    this.entries.delete(key);
    this.entries.set(key, page);
    return cloneFindPage(page);
  }

  set(key: string, page: FindPage): void {
    if (!page.complete) return;
    this.entries.delete(key);
    this.entries.set(key, cloneFindPage(page));
    if (this.entries.size > this.capacity) {
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) this.entries.delete(oldest);
    }
  }

  /** A live page means this sample is still being written: drop sealed
   *  entries so a later poll cannot reuse them. */
  dropSample(sample: SampleHandle): void {
    for (const key of [...this.entries.keys()]) {
      const parsed: unknown = JSON.parse(key);
      if (
        Array.isArray(parsed) &&
        parsed[0] === sample.logFile &&
        parsed[1] === sample.id &&
        parsed[2] === sample.epoch
      ) {
        this.entries.delete(key);
      }
    }
  }

  get size(): number {
    return this.entries.size;
  }

  clear(): void {
    this.entries.clear();
  }
}

export const defaultFindPageCache = new FindPageCache();

export function findPageCacheKey(
  sample: SampleHandle,
  query: MessagesFindQuery,
  after: FindAnchor | undefined
): string {
  return JSON.stringify([
    sample.logFile,
    sample.id,
    sample.epoch,
    query.text,
    after?.id ?? null,
    [...query.projection.unlabeledRoles].sort(),
    query.projection.toolCallStyle,
    query.projection.displayMode,
  ]);
}

function cloneFindPage(page: FindPage): FindPage {
  return {
    rows: page.rows.map((row) => ({
      ...row,
      anchor: { ...row.anchor },
      texts: [...row.texts],
    })),
    atEnd: page.atEnd,
    complete: page.complete,
  };
}
