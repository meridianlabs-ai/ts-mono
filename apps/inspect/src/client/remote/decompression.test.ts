import { expect, test } from "vitest";

import { installNodeBlobWorker } from "../../test/nodeBlobWorker";

import { CompressionMethod, decompressData } from "./decompression";

installNodeBlobWorker();

test.each([300_000, 999_999, 1_000_000])(
  "bounds empty-block work independently of output and window sizes (%s)",
  async (count) => {
    const data = new Uint8Array(6 + count * 3);
    data.set([0x28, 0xb5, 0x2f, 0xfd, 0x20, 0]);
    data[data.length - 3] = 1;
    if (count === 1_000_000) {
      await expect(decompress(data, 0)).rejects.toThrow(/frame\/block count/);
    } else {
      expect(await decompress(data, 0)).toEqual(new Uint8Array());
    }
  }
);

test("bounds skippable-frame work without allocating decoder windows", async () => {
  const count = 1_000_001;
  const data = new Uint8Array(count * 8);
  const view = new DataView(data.buffer);
  for (let i = 0; i < count; i++) view.setUint32(i * 8, 0x184d2a50, true);
  await expect(decompress(data, 0)).rejects.toThrow(/frame\/block count/);
});

test.each([32 * 1024 * 1024, 32 * 1024 * 1024 + 1])(
  "enforces the single-segment window boundary (%s)",
  async (size) => {
    const data = new Uint8Array(12);
    const view = new DataView(data.buffer);
    view.setUint32(0, 0xfd2fb528, true);
    view.setUint8(4, 0xa0);
    view.setUint32(5, size, true);
    view.setUint8(9, 1);
    // An accepted window reaches the output-size check; the next byte must
    // fail validation before constructing a decoder with that window.
    await expect(decompress(data, size)).rejects.toThrow(
      size === 32 * 1024 * 1024 ? /does not match/ : /window size too large/
    );
  }
);

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

// zstd CLI output with and without a known input size, using a 128 KiB window.
test.each([
  "KLUv/QQ4bQAAKGhlbGxvAQCAg75oAdQtBKI=",
  "KLUv/WSIEm0AAChoZWxsbwEAgIO+aAHULQSi",
])("reads compressed zstd blocks (%#)", async (base64) => {
  const bytes = new Uint8Array(Buffer.from(base64, "base64"));
  expect(new TextDecoder().decode(await decompress(bytes, 5000))).toBe(
    "hello".repeat(1000)
  );
});

test("rejects excessive aggregate zstd history work before allocating any windows", async () => {
  const frame = new Uint8Array([0x28, 0xb5, 0x2f, 0xfd, 0, 120, 9, 0, 0, 65]);
  const count = 1100;
  const bytes = new Uint8Array(frame.length * count);
  for (let index = 0; index < count; index++)
    bytes.set(frame, index * frame.length);
  await expect(decompress(bytes, count)).rejects.toThrow(
    /history work exceeds/
  );
});

test.each([1, 128])(
  "many valid small frames retain compatibility with the old decoder (frame size %s)",
  async (size) => {
    const header = size * 8 + 3;
    const frame = new Uint8Array([
      0x28,
      0xb5,
      0x2f,
      0xfd,
      0x20,
      size,
      header & 255,
      header >> 8,
      0,
      65,
    ]);
    const count = 50_000;
    const data = new Uint8Array(frame.length * count);
    for (let i = 0; i < count; i++) data.set(frame, i * frame.length);
    const expected = new Uint8Array(count * size).fill(65);
    expect(
      Buffer.from(await decompress(data, count * size)).equals(expected)
    ).toBe(true);
  }
);

test.each([0, 1, 2, 3])(
  "accepts dictionary-id width flag %s with dictionary id zero",
  async (flag) => {
    const width = flag === 3 ? 4 : flag;
    const data = new Uint8Array(10 + width);
    data.set([0x28, 0xb5, 0x2f, 0xfd, 0x20 + flag]);
    data.set([1, 9, 0, 0, 65], 5 + width);
    expect(await decompress(data, 1)).toEqual(new Uint8Array([65]));
  }
);

test("accepts skippable frames around a checksummed data frame", async () => {
  const frame = new Uint8Array(
    Buffer.from("KLUv/WSIEm0AAChoZWxsbwEAgIO+aAHULQSi", "base64")
  );
  const skip = new Uint8Array([0x50, 0x2a, 0x4d, 0x18, 2, 0, 0, 0, 1, 2]);
  const data = new Uint8Array(skip.length * 2 + frame.length);
  data.set(skip);
  data.set(frame, skip.length);
  data.set(skip, skip.length + frame.length);
  expect(await decompress(data, 5000)).toEqual(
    new TextEncoder().encode("hello".repeat(1000))
  );
});

test.each([0, 1, 2, 3])(
  "accepts frame content size width flag %s",
  async (flag) => {
    const width = flag ? 2 ** flag : 1;
    const size = flag === 1 ? 300 : 100;
    const data = new Uint8Array(5 + width + 4);
    data.set([0x28, 0xb5, 0x2f, 0xfd, 0x20 + flag * 64]);
    const view = new DataView(data.buffer);
    if (width === 8) view.setBigUint64(5, BigInt(size), true);
    else if (width === 4) view.setUint32(5, size, true);
    else if (width === 2) view.setUint16(5, size - 256, true);
    else view.setUint8(5, size);
    const header = size * 8 + 3;
    view.setUint8(5 + width, header & 255);
    view.setUint16(6 + width, header >> 8, true);
    view.setUint8(8 + width, 65);
    expect(await decompress(data, size)).toEqual(new Uint8Array(size).fill(65));
  }
);
