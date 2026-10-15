import { Inflate } from "fflate";

const kChunkSize = 8 * 1024;

/**
 * Inflates a DEFLATE ZIP entry, enforcing its directory size as output
 * arrives.
 *
 * Input goes in small chunks, so an entry that inflates past its declared
 * size fails after one chunk's output instead of after the whole stream.
 * fflate's one-shot size hint would allocate the attacker-declared size up
 * front and silently truncate excess.
 */
export function inflateBounded(data: Uint8Array, size: number): Uint8Array {
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  const stream = new Inflate((chunk, final) => {
    loaded += chunk.length;
    if (loaded > size || (final && loaded !== size)) {
      throw new Error(
        "Decompressed ZIP entry size does not match its directory"
      );
    }
    chunks.push(chunk);
  });
  let position = 0;
  do {
    const end = Math.min(position + kChunkSize, data.length);
    stream.push(data.slice(position, end), end === data.length);
    position = end;
  } while (position < data.length);
  const output = new Uint8Array(loaded);
  let offset = 0;
  for (const part of chunks) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}
