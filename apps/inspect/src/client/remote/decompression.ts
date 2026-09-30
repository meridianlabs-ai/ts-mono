import { AsyncInflate } from "fflate";

import { decompressZstd } from "./zstd-worker";

/** Supported ZIP compression methods */
export const CompressionMethod = {
  STORED: 0,
  DEFLATE: 8,
  ZSTANDARD: 93,
} as const;

export type CompressionMethodType =
  (typeof CompressionMethod)[keyof typeof CompressionMethod];

/**
 * Error thrown when an unsupported compression method is encountered.
 */
export class UnsupportedCompressionError extends Error {
  public readonly method: number;
  public readonly filename: string;

  constructor(method: number, filename: string) {
    super(`Unsupported compression method ${method} for file "${filename}"`);
    this.name = "UnsupportedCompressionError";
    this.method = method;
    this.filename = filename;

    Object.setPrototypeOf(this, UnsupportedCompressionError.prototype);
  }
}

/**
 * Decompresses data based on the compression method.
 * Handles STORED (0), DEFLATE (8), and ZSTANDARD (93).
 *
 * @param data - The compressed data
 * @param compressionMethod - ZIP compression method code
 * @param uncompressedSize - Expected uncompressed size, also the streaming output limit
 * @param filename - Filename for error messages
 * @returns Decompressed data
 */
export async function decompressData(
  data: Uint8Array,
  compressionMethod: number,
  uncompressedSize: number,
  filename: string
): Promise<Uint8Array> {
  switch (compressionMethod) {
    case CompressionMethod.STORED:
      return data;

    case CompressionMethod.DEFLATE:
      return decompressDeflate(data, uncompressedSize);

    case CompressionMethod.ZSTANDARD:
      return decompressZstd(data, uncompressedSize);

    default:
      throw new UnsupportedCompressionError(compressionMethod, filename);
  }
}

// Feed small chunks only after their output arrives. fflate's one-shot size
// hint allocates attacker-declared bytes up front and silently truncates excess.
async function decompressDeflate(
  data: Uint8Array,
  size: number
): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = [];
    let loaded = 0;
    let position = 0;
    const stream = new AsyncInflate((error, chunk, final) => {
      if (error) {
        stream.terminate();
        reject(error);
        return;
      }
      loaded += chunk.length;
      if (loaded > size || (final && loaded !== size)) {
        stream.terminate();
        reject(
          new Error("Decompressed ZIP entry size does not match its directory")
        );
        return;
      }
      chunks.push(chunk);
      if (final) {
        stream.terminate();
        const output = new Uint8Array(loaded);
        let offset = 0;
        for (const part of chunks) {
          output.set(part, offset);
          offset += part.length;
        }
        resolve(output);
      } else {
        push();
      }
    });
    function push() {
      const end = Math.min(position + 8 * 1024, data.length);
      try {
        stream.push(data.slice(position, end), end === data.length);
        position = end;
      } catch (error) {
        stream.terminate();
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    }
    push();
  });
}
