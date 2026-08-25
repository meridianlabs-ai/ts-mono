// Variant matching for the DEFAULT in-memory find engine and the per-row
// highlighter. The variants compensate for JSON-stringified projections
// (quoted/escaped source text); they are deliberately NOT part of the find
// contract and die in phase 3 when the projection moves to rendered-form
// text (design/pluggable-find.md, D11).

export interface PreparedFindTerm {
  simple: string;
  unquoted?: string;
  jsonEscaped?: string;
}

/**
 * Normalize a user-entered search term into the lower-cased variants the
 * default engine matches against. Quoted/JSON-ish source text appears with
 * different escape conventions in different sources, so all variants count.
 */
export function prepareFindTerm(term: string): PreparedFindTerm {
  const lower = term.toLowerCase();
  if (!term.includes('"') && !term.includes(":")) return { simple: lower };
  return {
    simple: lower,
    unquoted: lower.replace(/"/g, ""),
    jsonEscaped: lower.replace(/"/g, '\\"'),
  };
}

export interface TermOccurrence {
  start: number;
  end: number;
}

/**
 * Every occurrence of any variant of `term` in `text` (case-insensitive),
 * deduped by range so a JSON-quoted form `"foo"` matched by both `simple`
 * and `unquoted` counts once (the longer variant wins). The default source
 * and the highlighter both scan through here, so counts and highlights agree.
 */
export function findTermOccurrences(
  text: string,
  term: string
): TermOccurrence[] {
  if (!term) return [];
  const prepared = prepareFindTerm(term);
  const variants = [
    prepared.simple,
    ...(prepared.unquoted ? [prepared.unquoted] : []),
    ...(prepared.jsonEscaped ? [prepared.jsonEscaped] : []),
  ];
  const lowered = text.toLowerCase();
  const hits: TermOccurrence[] = [];
  for (const v of variants) {
    if (!v) continue;
    let from = 0;
    let p: number;
    while ((p = lowered.indexOf(v, from)) !== -1) {
      hits.push({ start: p, end: p + v.length });
      from = p + v.length;
    }
  }
  hits.sort((a, b) => a.start - b.start || b.end - a.end);
  const out: TermOccurrence[] = [];
  let endOfLast = -1;
  for (const h of hits) {
    if (h.start >= endOfLast) {
      out.push(h);
      endOfLast = h.end;
    }
  }
  return out;
}
