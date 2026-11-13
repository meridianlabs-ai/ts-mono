// Find compares text and terms in one normal form, so a list item's count
// from its data equals the matches its rendered DOM shows.

// CSS's collapsible whitespace, in runs other than a lone space (which
// normalizes to itself).
const WHITESPACE_RUN = / [ \t\n\r\f]+|[\t\n\r\f][ \t\n\r\f]*/g;
const NON_ASCII_CODE_POINT = /[\u{80}-\u{10ffff}]/gu;

const folds = new Map<string, string>();

/**
 * One code point's case fold, of the same length so offsets into folded text
 * are offsets into the original. Lowercasing the uppercase folds variants
 * together (ς and σ, ſ and s) as a case-insensitive RegExp does, and also
 * folds Turkish ı and İ to i. A code point whose uppercase is longer (ß, SS)
 * keeps its lowercase.
 */
const foldCodePoint = (char: string): string => {
  let folded = folds.get(char);
  if (folded === undefined) {
    const upper = char.toUpperCase();
    const lower = (upper.length === char.length ? upper : char).toLowerCase();
    // İ is the one code point whose lowercase is longer: i and a combining dot.
    folded = lower.length === char.length ? lower : "i";
    folds.set(char, folded);
  }
  return folded;
};

// Folding a lowercased code point gives the same result as folding the
// original, so the native lowercase does the ASCII work. Replacing İ first
// keeps the lowercase the same length.
const foldCase = (text: string): string =>
  /[^\0-\x7f]/.test(text)
    ? text
        .replaceAll("İ", "i")
        .toLowerCase()
        .replace(NON_ASCII_CODE_POINT, foldCodePoint)
    : text.toLowerCase();

// The viewer shows a line break in text as one (markdown renders it as
// `<br>`, preformatted text keeps it), and a match can't cross a `<br>` on the
// page. So a run with a line break stays one, which no term from the
// single-line find input contains.
const collapseRun = (run: string): string => (/[\n\r]/.test(run) ? "\n" : " ");

/**
 * Text as Find compares it: case folded, with each run of whitespace read as
 * one space, or as one line break if it has one, however the page renders
 * it. Pass `offsets` to get each character's index in `text`.
 */
export function normalizeFindText(text: string, offsets?: number[]): string {
  if (offsets) {
    let from = 0;
    for (const run of text.matchAll(WHITESPACE_RUN)) {
      for (let i = from; i <= run.index; i++) offsets.push(i);
      from = run.index + run[0].length;
    }
    for (let i = from; i < text.length; i++) offsets.push(i);
  }
  return foldCase(text).replace(WHITESPACE_RUN, collapseRun);
}

/**
 * The normalized forms of `term` Find looks for. Quoted or escaped text
 * appears differently in JSON (stringified tool arguments) than as typed, so
 * a term with quotes, backslashes or colons also matches unquoted and
 * JSON-escaped.
 */
export function searchVariants(term: string): string[] {
  const simple = normalizeFindText(term);
  if (!/["\\:]/.test(term)) return simple ? [simple] : [];
  return [
    simple,
    simple.replace(/"/g, ""),
    JSON.stringify(simple).slice(1, -1),
  ].filter((variant) => variant.length > 0);
}

export interface FindHit {
  start: number;
  end: number;
}

/**
 * Every occurrence of any of `variants` in normalized `text`, without
 * overlap. Where variants overlap (a JSON-quoted `"foo"` matched by both
 * `"foo"` and `foo`), the earliest, then longest, wins.
 */
export function findVariantHits(text: string, variants: string[]): FindHit[] {
  const hits: FindHit[] = [];
  for (const variant of variants) {
    let from = 0;
    let start: number;
    while ((start = text.indexOf(variant, from)) !== -1) {
      from = start + variant.length;
      hits.push({ start, end: from });
    }
  }
  if (variants.length > 1) {
    hits.sort((a, b) => a.start - b.start || b.end - a.end);
  }
  const out: FindHit[] = [];
  let endOfLast = -1;
  for (const hit of hits) {
    if (hit.start >= endOfLast) {
      out.push(hit);
      endOfLast = hit.end;
    }
  }
  return out;
}
