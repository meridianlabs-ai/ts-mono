// Code points that render as nothing (or reorder what follows) and so let
// text read differently on screen than it is: C0/C1 controls (tab and newline
// are handled separately), zero-width and joiner characters, bidi
// embeddings/overrides/isolates, invisible fillers, and the tag /
// variation-selector-supplement blocks used to smuggle hidden text.
// U+FE00–FE0F are left alone: emoji presentation depends on them.
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

const TAB = 0x09;
const LINE_FEED = 0x0a;
const CARRIAGE_RETURN = 0x0d;

const isHidden = (codePoint: number, next: number | undefined): boolean => {
  if (codePoint === TAB || codePoint === LINE_FEED) {
    return false;
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
  while (index < text.length) {
    const codePoint = text.codePointAt(index) ?? 0;
    const width = codePoint > 0xffff ? 2 : 1;
    if (isHidden(codePoint, text.codePointAt(index + width))) {
      out += `${text.slice(emitted, index)}⟨U+${codePoint
        .toString(16)
        .toUpperCase()
        .padStart(4, "0")}⟩`;
      emitted = index + width;
    }
    index += width;
  }
  return emitted === 0 ? text : out + text.slice(emitted);
};
