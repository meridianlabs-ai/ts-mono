// Code points that render as nothing (or reorder what follows) and so let
// text read differently on screen than it is: C0/C1 controls (tab and newline
// are handled separately), zero-width and joiner characters, bidi
// embeddings/overrides/isolates, invisible fillers, and the tag /
// variation-selector-supplement blocks used to smuggle hidden text.
// U+FE00–FE0F are left alone: emoji presentation depends on them. ZWNJ and
// ZWJ are kept where they do visible work (see isPurposefulJoiner).
const HIDDEN_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x0000, 0x001f],
  [0x007f, 0x009f],
  [0x00ad, 0x00ad],
  [0x034f, 0x034f],
  [0x061c, 0x061c],
  [0x115f, 0x1160],
  [0x17b4, 0x17b5],
  [0x180b, 0x180f],
  [0x200b, 0x200f],
  [0x2028, 0x202e],
  [0x2060, 0x206f],
  [0x3164, 0x3164],
  [0xfeff, 0xfeff],
  [0xffa0, 0xffa0],
  [0xfff9, 0xfffb],
  [0x1d173, 0x1d17a],
  [0xe0000, 0xe007f],
  [0xe0100, 0xe01ef],
];

const ZWNJ = 0x200c;
const ZWJ = 0x200d;
const VARIATION_SELECTOR_16 = 0xfe0f;
const kEmoji = /^[\p{Extended_Pictographic}\p{Emoji_Modifier}]$/u;
// Scripts whose shaping or conjuncts use ZWNJ/ZWJ (Persian word parts,
// Indic half forms, ...). Between letters of other scripts a joiner is
// invisible and only hides content.
const kJoiningScript =
  /^[\p{Script=Arabic}\p{Script=Syriac}\p{Script=Nko}\p{Script=Mongolian}\p{Script=Devanagari}\p{Script=Bengali}\p{Script=Gurmukhi}\p{Script=Gujarati}\p{Script=Oriya}\p{Script=Tamil}\p{Script=Telugu}\p{Script=Kannada}\p{Script=Malayalam}\p{Script=Sinhala}\p{Script=Myanmar}\p{Script=Khmer}]$/u;

const isEmoji = (codePoint: number): boolean =>
  kEmoji.test(String.fromCodePoint(codePoint));

const isJoiningScript = (codePoint: number): boolean =>
  kJoiningScript.test(String.fromCodePoint(codePoint));

/** A joiner inside an emoji ZWJ sequence or between letters of a joining
 *  script renders (it shapes what's around it), so it hides nothing. */
const isPurposefulJoiner = (
  codePoint: number,
  prev: number | undefined,
  next: number | undefined
): boolean => {
  if (prev === undefined || next === undefined) return false;
  if (
    codePoint === ZWJ &&
    (isEmoji(prev) || prev === VARIATION_SELECTOR_16) &&
    isEmoji(next)
  ) {
    return true;
  }
  return isJoiningScript(prev) && isJoiningScript(next);
};

const TAB = 0x09;
const LINE_FEED = 0x0a;
const CARRIAGE_RETURN = 0x0d;

const isHidden = (
  codePoint: number,
  prev: number | undefined,
  next: number | undefined
): boolean => {
  if (codePoint === TAB || codePoint === LINE_FEED) {
    return false;
  }
  if (codePoint === ZWNJ || codePoint === ZWJ) {
    return !isPurposefulJoiner(codePoint, prev, next);
  }
  if (codePoint === CARRIAGE_RETURN) {
    // Half of a CRLF is an ordinary line break; a lone CR can overprint.
    return next !== LINE_FEED;
  }
  return HIDDEN_RANGES.some(([lo, hi]) => codePoint >= lo && codePoint <= hi);
};

/**
 * Replaces each hidden character with a visible `⟨U+XXXX⟩` marker, so text
 * shown for inspection can't hide content or disguise itself (e.g. a bidi
 * override making `gnp.exe` display as `exe.png`).
 */
export const revealHiddenCharacters = (text: string): string => {
  let out = "";
  let emitted = 0;
  let index = 0;
  let prev: number | undefined;
  while (index < text.length) {
    const codePoint = text.codePointAt(index) ?? 0;
    const width = codePoint > 0xffff ? 2 : 1;
    if (isHidden(codePoint, prev, text.codePointAt(index + width))) {
      out += `${text.slice(emitted, index)}⟨U+${codePoint
        .toString(16)
        .toUpperCase()
        .padStart(4, "0")}⟩`;
      emitted = index + width;
    }
    prev = codePoint;
    index += width;
  }
  return emitted === 0 ? text : out + text.slice(emitted);
};
