import type {
  FindCursor,
  FindMatch,
  FindSource,
  FindStreamItem,
} from "@tsmono/react/find";

// Stream granularity: keeps a giant materialized list from landing in the
// coordinator as one state update.
const CHUNK_SIZE = 500;

export interface MaterializedFindSourceOptions {
  scopeId: string;
  /** The FULL ordered match list for a term — chronological scope order
   *  (D6). Called per query; implementations should memoize per term. */
  materialize: (term: string) => FindMatch[];
}

function indexOfCursor(all: FindMatch[], cursor: FindCursor): number {
  return all.findIndex(
    (m) =>
      m.anchor.kind === cursor.anchor.kind &&
      m.anchor.id === cursor.anchor.id &&
      m.occurrence === cursor.occurrence
  );
}

/**
 * The default in-memory FindSource: materializes the full match list per
 * term (its business — the contract stays cursor/window based, D7) and
 * serves cursor-paged streams over it. Totals are exact (relation "eq")
 * even when a limit caps the streamed page.
 */
export function createMaterializedFindSource(
  options: MaterializedFindSourceOptions
): FindSource {
  let cache: { term: string; matches: FindMatch[] } | null = null;
  const materialize = (term: string): FindMatch[] => {
    if (cache && cache.term === term) return cache.matches;
    const matches = options.materialize(term);
    cache = { term, matches };
    return matches;
  };
  return {
    scopeId: options.scopeId,
    capabilities: { complete: true },
    // eslint-disable-next-line @typescript-eslint/require-await -- the AsyncIterable contract is satisfied synchronously by an in-memory source
    async *find(query, opts, signal): AsyncIterable<FindStreamItem> {
      const all = materialize(query.text);
      const backward = opts.direction === "backward";
      const step = backward ? -1 : 1;
      const limit = opts.limit ?? Number.POSITIVE_INFINITY;
      let index: number;
      if (opts.cursor) {
        const at = indexOfCursor(all, opts.cursor);
        // A vanished cursor (data changed under the query) restarts from the
        // near edge; the coordinator re-surveys on data change anyway.
        index = at === -1 ? (backward ? all.length - 1 : 0) : at + step;
      } else {
        index = backward ? all.length - 1 : 0;
      }
      let emitted = 0;
      let chunk: FindMatch[] = [];
      while (index >= 0 && index < all.length && emitted < limit) {
        if (signal.aborted) return;
        chunk.push(all[index]!);
        emitted++;
        index += step;
        if (chunk.length >= CHUNK_SIZE) {
          yield { kind: "matches", matches: chunk };
          chunk = [];
        }
      }
      if (chunk.length > 0) yield { kind: "matches", matches: chunk };
      if (signal.aborted) return;
      yield {
        kind: "end",
        complete: true,
        total: { value: all.length, relation: "eq" },
      };
    },
  };
}
