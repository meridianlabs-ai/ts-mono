/** Text at or below this length renders as a single node. */
export const kChunkThreshold = 100_000;

/** Target length of each chunk of a longer text. */
export const kChunkSize = 50_000;

// How far back from a chunk's target end to look for a soft break when the
// chunk contains no newline (e.g. minified JSON on one line).
const kSoftBreakWindow = 2_000;

export interface TextChunk {
  text: string;
  /** Number of lines the chunk starts (newlines, plus a trailing partial line). */
  lines: number;
}

/**
 * Splits text into chunks of about `size` characters whose concatenation is
 * exactly the input. Chunks end just after a newline when there is one, so a
 * chunk boundary falls between lines; a chunk without any newline ends after
 * the last whitespace or comma near its target end, or at the target itself.
 */
export const splitTextChunks = (
  text: string,
  size: number = kChunkSize
): TextChunk[] => {
  const chunks: TextChunk[] = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + size, text.length);
    if (end < text.length) {
      const newline = text.lastIndexOf("\n", end - 1);
      if (newline >= start) {
        end = newline + 1;
      } else {
        end = softBreak(text, Math.max(start, end - kSoftBreakWindow), end);
      }
    }
    const chunk = text.slice(start, end);
    chunks.push({ text: chunk, lines: countLines(chunk) });
    start = end;
  }
  return chunks;
};

const softBreak = (text: string, from: number, to: number): number => {
  for (let i = to - 1; i > from; i--) {
    const code = text.charCodeAt(i);
    // space, tab, comma
    if (code === 0x20 || code === 0x09 || code === 0x2c) {
      return i + 1;
    }
  }
  return to;
};

const countLines = (text: string): number => {
  let lines = 0;
  let index = text.indexOf("\n");
  while (index !== -1) {
    lines++;
    index = text.indexOf("\n", index + 1);
  }
  return text.endsWith("\n") ? lines : lines + 1;
};
