export type PreparedSearchTerms = {
  simple: string;
  unquoted?: string;
  jsonEscaped?: string;
};

/**
 * Normalize a user-entered search term into the lower-cased variants the
 * extended-find subsystem matches against. Quoted/JSON-ish source text
 * appears with different escape conventions in different sources, so the
 * counter checks all variants.
 */
export function prepareSearchTerm(term: string): PreparedSearchTerms {
  const lower = term.toLowerCase();
  if (!term.includes('"') && !term.includes(":")) return { simple: lower };
  return {
    simple: lower,
    unquoted: lower.replace(/"/g, ""),
    jsonEscaped: lower.replace(/"/g, '\\"'),
  };
}

/** The non-empty variants of `prepareSearchTerm`, for data-side matching. */
export function searchVariants(term: string): string[] {
  const { simple, unquoted, jsonEscaped } = prepareSearchTerm(term);
  return [simple, unquoted, jsonEscaped].filter(
    (variant): variant is string => !!variant
  );
}

/**
 * Find every occurrence of any `variants` substring in `lowered`, deduped by
 * range so a JSON-quoted form `"foo"` matched by both `simple` and `unquoted`
 * counts as one occurrence (the longer variant wins).
 */
export function findVariantPositions(
  lowered: string,
  variants: string[]
): number[] {
  const hits: { pos: number; len: number }[] = [];
  for (const v of variants) {
    if (!v) continue;
    let from = 0;
    let p: number;
    while ((p = lowered.indexOf(v, from)) !== -1) {
      hits.push({ pos: p, len: v.length });
      from = p + v.length;
    }
  }
  hits.sort((a, b) => a.pos - b.pos || b.len - a.len);
  const out: number[] = [];
  let endOfLast = -1;
  for (const h of hits) {
    if (h.pos >= endOfLast) {
      out.push(h.pos);
      endOfLast = h.pos + h.len;
    }
  }
  return out;
}
