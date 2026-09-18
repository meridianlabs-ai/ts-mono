import { fetchRange, logFetchInit } from "@tsmono/util";

import { ProgressCallback } from "../api/types";

import { decompressData } from "./decompression";

export type { ProgressCallback };

export interface CentralDirectoryEntry {
  filename: string;
  compressionMethod: number;
  compressedSize: number;
  uncompressedSize: number;
  fileOffset: number;
  filenameLength: number;
}

/**
 * Represents an error thrown when a file exceeds the maximum allowed size.
 */
export class FileSizeLimitError extends Error {
  public readonly file: string;
  public readonly maxBytes: number;

  constructor(file: string, maxBytes: number) {
    super(
      `File "${file}" exceeds the maximum size (${maxBytes} bytes) and cannot be loaded.`
    );
    this.name = "FileSizeLimitError";
    this.file = file;
    this.maxBytes = maxBytes;

    Object.setPrototypeOf(this, FileSizeLimitError.prototype);
  }
}

// Keep the existing 2 GiB sample ceiling, applied to each materialized ZIP
// entry or directory. Large archives remain readable one entry at a time.
export const MAX_ZIP_READ_BYTES = 2048 * 1024 * 1024;
const PARALLEL_CHUNK_SIZE = 8 * 1024 * 1024;
const MAX_PARALLEL_CHUNKS = 10;

function validateRange(
  start: number,
  size: number,
  contentLength: number
): void {
  if (
    !Number.isSafeInteger(start) ||
    start < 0 ||
    !Number.isSafeInteger(size) ||
    size < 0 ||
    start > contentLength ||
    size > contentLength - start
  ) {
    throw new Error("ZIP byte range is outside the archive");
  }
}

function validateSize(
  size: number,
  file: string,
  maxBytes = MAX_ZIP_READ_BYTES
): void {
  if (!Number.isSafeInteger(size) || size < 0) {
    throw new Error(`Invalid ZIP size for ${file}`);
  }
  if (size > Math.min(maxBytes, MAX_ZIP_READ_BYTES)) {
    throw new FileSizeLimitError(file, Math.min(maxBytes, MAX_ZIP_READ_BYTES));
  }
}

function dataView(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function zip64Number(view: DataView, offset: number): number {
  const value = Number(view.getBigUint64(offset, true));
  if (!Number.isSafeInteger(value)) {
    throw new Error("ZIP64 value exceeds the safe integer range");
  }
  return value;
}

/** Opens a remote ZIP archive and reads individual entries with bounded allocations. */
export const openRemoteZipFile = async (
  url: string,
  contentLength?: number,
  fetchBytes: (
    url: string,
    start: number,
    end: number
  ) => Promise<Uint8Array> = fetchRange
): Promise<{
  centralDirectory: Map<string, CentralDirectoryEntry>;
  readFile: (
    file: string,
    maxBytes?: number,
    onProgress?: ProgressCallback
  ) => Promise<Uint8Array>;
}> => {
  const length = contentLength ?? (await fetchSize(url));
  if (!Number.isSafeInteger(length) || length < 22) {
    throw new Error("Invalid ZIP archive length");
  }

  const read = async (
    start: number,
    size: number,
    onProgress?: ProgressCallback
  ): Promise<Uint8Array> => {
    validateRange(start, size, length);
    validateSize(size, url);
    if (size === 0) return new Uint8Array();
    const fetchChunk = async (offset: number, count: number) => {
      const result = await fetchBytes(url, offset, offset + count - 1);
      if (result.length !== count) {
        throw new Error(
          "Unexpected ZIP range response length; HTTP range support is required"
        );
      }
      return result;
    };
    if (size <= PARALLEL_CHUNK_SIZE) return fetchChunk(start, size);

    // Derive at most 256 chunk indices from the validated read size; do not
    // build a metadata-sized work list before the first asynchronous read.
    const combined = new Uint8Array(size);
    const chunkCount = Math.ceil(size / PARALLEL_CHUNK_SIZE);
    let nextChunk = 0;
    let bytesLoaded = 0;
    onProgress?.(0, size);
    const worker = async () => {
      while (nextChunk < chunkCount) {
        const offset = nextChunk++ * PARALLEL_CHUNK_SIZE;
        const chunk = await fetchChunk(
          start + offset,
          Math.min(PARALLEL_CHUNK_SIZE, size - offset)
        );
        combined.set(chunk, offset);
        bytesLoaded += chunk.length;
        onProgress?.(bytesLoaded, size);
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(chunkCount, MAX_PARALLEL_CHUNKS) }, worker)
    );
    return combined;
  };

  const eocd = dataView(await read(length - 22, 22));
  if (eocd.getUint32(0, true) !== 0x06054b50) {
    throw new Error("End of central directory record not found");
  }
  let centralDirOffset = eocd.getUint32(16, true);
  let centralDirSize = eocd.getUint32(12, true);
  if (centralDirOffset === 0xffffffff || centralDirSize === 0xffffffff) {
    const locator = dataView(await read(length - 42, 20));
    if (locator.getUint32(0, true) !== 0x07064b50) {
      throw new Error("ZIP64 End of central directory locator not found");
    }
    const zip64 = dataView(await read(zip64Number(locator, 8), 56));
    if (zip64.getUint32(0, true) !== 0x06064b50) {
      throw new Error("ZIP64 End of central directory record not found");
    }
    centralDirSize = zip64Number(zip64, 40);
    centralDirOffset = zip64Number(zip64, 48);
  }
  const centralDirectory = parseCentralDirectory(
    await read(centralDirOffset, centralDirSize)
  );
  for (const entry of centralDirectory.values()) {
    validateRange(
      entry.fileOffset,
      30 + entry.filenameLength + entry.compressedSize,
      length
    );
  }

  return {
    centralDirectory,
    readFile: async (file, maxBytes, onProgress): Promise<Uint8Array> => {
      const entry = centralDirectory.get(file);
      if (!entry) throw new Error(`File not found: ${file}`);
      validateSize(entry.uncompressedSize, file, maxBytes);
      const minimumSize = 30 + entry.filenameLength + entry.compressedSize;
      validateSize(minimumSize, file, maxBytes);
      // Padding avoids a separate local-header request for typical archives,
      // but may extend past EOF for small archives and must be clamped.
      const estimatedSize = Math.min(
        minimumSize + 256,
        length - entry.fileOffset,
        MAX_ZIP_READ_BYTES
      );
      let fileData = await read(entry.fileOffset, estimatedSize, onProgress);
      const view = dataView(fileData);
      const actualTotal =
        30 +
        view.getUint16(26, true) +
        view.getUint16(28, true) +
        entry.compressedSize;
      validateRange(entry.fileOffset, actualTotal, length);
      validateSize(actualTotal, file, maxBytes);
      if (actualTotal > fileData.length) {
        fileData = await read(entry.fileOffset, actualTotal);
      }
      const payload = parseZipFileEntry(file, fileData, entry);
      return decompressData(
        payload,
        entry.compressionMethod,
        entry.uncompressedSize,
        file
      );
    },
  };
};

/** Opens an in-memory ZIP archive using the same metadata validation as remote reads. */
export const openZipFileFromBuffer = (bytes: Uint8Array) =>
  openRemoteZipFile("in-memory ZIP", bytes.length, (_url, start, end) =>
    // Copy: a worker may transfer this buffer, which must not detach the archive.
    Promise.resolve(bytes.slice(start, end + 1))
  );

export const fetchSize = async (url: string): Promise<number> => {
  // Make a HEAD request to find whether the server supports range requests
  const acceptResponse = await fetch(url, { ...logFetchInit, method: "HEAD" });
  const acceptsRanges = acceptResponse.headers.get("Accept-Ranges");
  if (acceptsRanges === "bytes") {
    // attempt a range request to get the content length
    // Range requests are preferred since they bypass compression.
    // HEAD requests may return compressed content-length which doesn't
    // match the actual file size needed for downstream operations.
    const getResponse = await fetch(`${url}`, {
      ...logFetchInit,
      method: "GET",
      headers: { Range: "bytes=0-0" },
    });

    const contentRange = getResponse.headers.get("Content-Range");
    if (contentRange !== null) {
      const rangeMatch = contentRange.match(/bytes (\d+)-(\d+)\/(\d+)/);
      if (rangeMatch !== null) {
        await getResponse.arrayBuffer();
        return Number(rangeMatch[3]);
      }
    }
    // Consume the response body (even if unused) to avoid resource leaks
    await getResponse.arrayBuffer();
  }

  //  use the HEAD request to get Content-Length
  const contentLength = acceptResponse.headers.get("Content-Length");
  if (contentLength !== null) {
    return Number(contentLength);
  }

  throw new Error(`Could not determine content length for ${url}`);
};

export { fetchRange };

function zip64Values(
  view: DataView,
  start: number,
  size: number,
  values: number[]
): number[] {
  if (!values.includes(0xffffffff)) return values;
  const end = start + size;
  validateRange(start, size, view.byteLength);
  for (let offset = start; offset < end;) {
    validateRange(offset, 4, end);
    const tag = view.getUint16(offset, true);
    const fieldSize = view.getUint16(offset + 2, true);
    offset += 4;
    validateRange(offset, fieldSize, end);
    if (tag === 1) {
      let cursor = offset;
      return values.map((value) => {
        if (value !== 0xffffffff) return value;
        validateRange(cursor, 8, offset + fieldSize);
        const result = zip64Number(view, cursor);
        cursor += 8;
        return result;
      });
    }
    offset += fieldSize;
  }
  throw new Error("Missing ZIP64 size or offset");
}

function parseZipFileEntry(
  file: string,
  rawData: Uint8Array,
  entry: CentralDirectoryEntry
): Uint8Array {
  const view = dataView(rawData);
  if (view.getUint32(0, true) !== 0x04034b50) {
    throw new Error(`Invalid ZIP entry signature for ${file}`);
  }
  const bitFlag = view.getUint16(6, true);
  const compressionMethod = view.getUint16(8, true);
  const filenameLength = view.getUint16(26, true);
  const extraFieldLength = view.getUint16(28, true);
  const dataOffset = 30 + filenameLength + extraFieldLength;
  validateRange(dataOffset, entry.compressedSize, rawData.length);
  if (
    compressionMethod !== entry.compressionMethod ||
    filenameLength !== entry.filenameLength
  ) {
    throw new Error(`Inconsistent ZIP entry header for ${file}`);
  }
  // With a data descriptor (bit 3), local sizes may be zero/placeholders.
  // The central directory is authoritative and already bounded in readFile.
  if ((bitFlag & 8) === 0) {
    const [uncompressedSize, compressedSize] = zip64Values(
      view,
      30 + filenameLength,
      extraFieldLength,
      [view.getUint32(22, true), view.getUint32(18, true)]
    );
    if (
      uncompressedSize !== entry.uncompressedSize ||
      compressedSize !== entry.compressedSize
    ) {
      throw new Error(`Inconsistent ZIP entry sizes for ${file}`);
    }
  }
  if (
    compressionMethod === 0 &&
    entry.compressedSize !== entry.uncompressedSize
  ) {
    throw new Error(`Inconsistent stored ZIP entry sizes for ${file}`);
  }
  return rawData.subarray(dataOffset, dataOffset + entry.compressedSize);
}

function parseCentralDirectory(
  buffer: Uint8Array
): Map<string, CentralDirectoryEntry> {
  const view = dataView(buffer);
  const entries = new Map<string, CentralDirectoryEntry>();
  for (let offset = 0; offset < buffer.length;) {
    validateRange(offset, 46, buffer.length);
    if (view.getUint32(offset, true) !== 0x02014b50) {
      throw new Error("Invalid ZIP central directory entry");
    }
    const filenameLength = view.getUint16(offset + 28, true);
    const extraFieldLength = view.getUint16(offset + 30, true);
    const fileCommentLength = view.getUint16(offset + 32, true);
    const entrySize =
      46 + filenameLength + extraFieldLength + fileCommentLength;
    validateRange(offset, entrySize, buffer.length);
    const filename = new TextDecoder().decode(
      buffer.subarray(offset + 46, offset + 46 + filenameLength)
    );
    const [uncompressedSize, compressedSize, fileOffset] = zip64Values(
      view,
      offset + 46 + filenameLength,
      extraFieldLength,
      [
        view.getUint32(offset + 24, true),
        view.getUint32(offset + 20, true),
        view.getUint32(offset + 42, true),
      ]
    );
    if (
      uncompressedSize === undefined ||
      compressedSize === undefined ||
      fileOffset === undefined
    ) {
      throw new Error("Missing ZIP entry sizes");
    }
    entries.set(filename, {
      filename,
      compressionMethod: view.getUint16(offset + 10, true),
      compressedSize,
      uncompressedSize,
      fileOffset,
      filenameLength,
    });
    offset += entrySize;
  }
  return entries;
}
