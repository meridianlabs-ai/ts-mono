import { decompressDeflate, decompressZstd } from "./decompression-worker";

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
