import { expect, test } from "vitest";

import { CompressionMethod, decompressData } from "./decompression";

function rawZstd(text: string, contentSize = true): Uint8Array {
  const payload = new TextEncoder().encode(text);
  const bytes = new Uint8Array(9 + payload.length);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0xfd2fb528, true);
  view.setUint8(4, contentSize ? 0x20 : 0);
  view.setUint8(5, contentSize ? payload.length : 0x38);
  const header = payload.length * 8 + 1;
  view.setUint8(6, header & 255);
  view.setUint16(7, header >> 8, true);
  bytes.set(payload, 9);
  return bytes;
}

function decompress(bytes: Uint8Array, size: number) {
  return decompressData(
    bytes,
    CompressionMethod.ZSTANDARD,
    size,
    "header.json"
  );
}

test.each([true, false])(
  "reads zstd frames with content-size flag %s",
  async (contentSize) => {
    expect(
      new TextDecoder().decode(
        await decompress(rawZstd("hello", contentSize), 5)
      )
    ).toBe("hello");
  }
);

test("rejects zstd output beyond or below the ZIP size without preallocating that size", async () => {
  await expect(decompress(rawZstd("hello", false), 1)).rejects.toThrow(
    /exceeds/
  );
  await expect(decompress(rawZstd("hello", false), 512 * 1024)).rejects.toThrow(
    /does not match/
  );
});

test("rejects oversized single-segment windows, including in later frames", async () => {
  const huge = new Uint8Array(12);
  const view = new DataView(huge.buffer);
  view.setUint32(0, 0xfd2fb528, true);
  view.setUint8(4, 0xa0);
  view.setUint32(5, 64 * 1024 * 1024, true);
  view.setUint8(9, 1);
  await expect(decompress(huge, 64 * 1024 * 1024)).rejects.toThrow(
    /window size too large/
  );
  const first = rawZstd("hello");
  const joined = new Uint8Array(first.length + huge.length);
  joined.set(first);
  joined.set(huge, first.length);
  await expect(decompress(joined, 64 * 1024 * 1024 + 5)).rejects.toThrow(
    /window size too large/
  );
});

test("reads concatenated zstd frames with a bounded cumulative size", async () => {
  const frame = rawZstd("hello");
  const joined = new Uint8Array(frame.length * 2);
  joined.set(frame);
  joined.set(frame, frame.length);
  expect(new TextDecoder().decode(await decompress(joined, 10))).toBe(
    "hellohello"
  );
  await expect(decompress(joined, 5)).rejects.toThrow(/exceeds/);
});

test("rejects oversized zstd blocks before the decoder allocates them", async () => {
  const bytes = rawZstd("hello", false);
  const view = new DataView(bytes.buffer);
  const header = (128 * 1024 + 1) * 8 + 3;
  view.setUint8(6, header & 255);
  view.setUint16(7, header >> 8, true);
  await expect(decompress(bytes, 128 * 1024 + 1)).rejects.toThrow(
    /Invalid zstd block/
  );
});
