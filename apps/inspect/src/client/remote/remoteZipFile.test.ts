import { zipSync } from "fflate";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { logFetchInit } from "@tsmono/util";

import {
  fetchSize,
  openRemoteZipFile,
  openZipFileFromBuffer,
} from "./remoteZipFile";

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn((_url: string, init?: RequestInit) =>
      Promise.resolve(
        init?.method === "HEAD"
          ? new Response(null, { headers: { "Accept-Ranges": "bytes" } })
          : new Response(new Uint8Array(1), {
              status: 206,
              headers: { "Content-Range": "bytes 0-0/4096" },
            })
      )
    )
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

test("fetchSize probes with the hardened log fetch options", async () => {
  const size = await fetchSize("https://example.com/log.eval");

  expect(size).toBe(4096);
  const calls = vi.mocked(fetch).mock.calls;
  expect(calls).toHaveLength(2);
  for (const [, init] of calls) {
    expect(init).toMatchObject(logFetchInit);
  }
});

function archive() {
  const bytes = zipSync(
    { "header.json": new TextEncoder().encode("hello") },
    { level: 0 }
  );
  const view = new DataView(bytes.buffer);
  const eocd = bytes.length - 22;
  const directory = view.getUint32(eocd + 16, true);
  return { bytes, view, eocd, directory };
}

function source(bytes: Uint8Array) {
  return vi.fn((_url: string, start: number, end: number) => {
    if (start < 0 || end >= bytes.length) {
      return Promise.reject(new Error("Out-of-file request"));
    }
    return Promise.resolve(bytes.slice(start, end + 1));
  });
}

test("rejects an out-of-file central directory before fetching it", async () => {
  const { bytes, view, eocd } = archive();
  view.setUint32(eocd + 12, 1024 * 1024, true);
  const fetchBytes = source(bytes);
  await expect(
    openRemoteZipFile("log.eval", bytes.length, fetchBytes)
  ).rejects.toThrow();
  expect(fetchBytes).toHaveBeenCalledTimes(1);
});

test("rejects an out-of-file entry before fetching it", async () => {
  const { bytes, view, directory } = archive();
  view.setUint32(directory + 20, 1024 * 1024, true);
  const fetchBytes = source(bytes);
  await expect(async () => {
    const zip = await openRemoteZipFile("log.eval", bytes.length, fetchBytes);
    await zip.readFile("header.json");
  }).rejects.toThrow();
  expect(fetchBytes).toHaveBeenCalledTimes(2);
});

test("bounds read padding at EOF", async () => {
  const { bytes } = archive();
  const fetchBytes = source(bytes);
  const zip = await openRemoteZipFile("log.eval", bytes.length, fetchBytes);
  expect(new TextDecoder().decode(await zip.readFile("header.json"))).toBe(
    "hello"
  );
});

test("rejects a local size that disagrees with the central directory", async () => {
  const { bytes, view } = archive();
  view.setUint32(22, 0xffffffff, true);
  const zip = await openZipFileFromBuffer(bytes);
  await expect(zip.readFile("header.json")).rejects.toThrow();
});

test("enforces the uncompressed size limit for every entry", async () => {
  const { bytes, view, directory } = archive();
  view.setUint32(22, 0xfffffffe, true);
  view.setUint32(directory + 24, 0xfffffffe, true);
  const zip = await openZipFileFromBuffer(bytes);
  await expect(zip.readFile("header.json")).rejects.toThrow(/maximum size/);
});

function zip64Archive() {
  const original = archive();
  const bytes = new Uint8Array(original.bytes.length + 76);
  bytes.set(original.bytes.subarray(0, original.eocd));
  bytes.set(original.bytes.subarray(original.eocd), original.eocd + 76);
  const view = new DataView(bytes.buffer);
  const record = original.eocd;
  const locator = record + 56;
  const eocd = locator + 20;
  view.setUint32(record, 0x06064b50, true);
  view.setBigUint64(record + 4, 44n, true);
  view.setBigUint64(
    record + 40,
    BigInt(original.eocd - original.directory),
    true
  );
  view.setBigUint64(record + 48, BigInt(original.directory), true);
  view.setUint32(locator, 0x07064b50, true);
  view.setBigUint64(locator + 8, BigInt(record), true);
  view.setUint32(eocd + 12, 0xffffffff, true);
  view.setUint32(eocd + 16, 0xffffffff, true);
  return { bytes, view, record, locator };
}

test("reads a ZIP64 directory without fetching beyond its record", async () => {
  const { bytes } = zip64Archive();
  const zip = await openRemoteZipFile("log.eval", bytes.length, source(bytes));
  expect(new TextDecoder().decode(await zip.readFile("header.json"))).toBe(
    "hello"
  );
});

test.each([2n ** 52n, 2n ** 63n])(
  "rejects huge ZIP64 directory sizes (%s) before chunking",
  async (size) => {
    const { bytes, view, record } = zip64Archive();
    view.setBigUint64(record + 40, size, true);
    const fetchBytes = source(bytes);
    await expect(
      openRemoteZipFile("log.eval", bytes.length, fetchBytes)
    ).rejects.toThrow();
    expect(fetchBytes).toHaveBeenCalledTimes(3);
  }
);

test("rejects unsafe ZIP64 locator offsets before fetching", async () => {
  const { bytes, view, locator } = zip64Archive();
  view.setBigUint64(locator + 8, 2n ** 63n, true);
  const fetchBytes = source(bytes);
  await expect(
    openRemoteZipFile("log.eval", bytes.length, fetchBytes)
  ).rejects.toThrow(/safe integer/);
  expect(fetchBytes).toHaveBeenCalledTimes(2);
});

test("accepts a data descriptor with zero local sizes", async () => {
  const { bytes, view, directory } = archive();
  view.setUint16(6, 8, true);
  view.setUint16(directory + 8, 8, true);
  view.setUint32(18, 0, true);
  view.setUint32(22, 0, true);
  const zip = await openZipFileFromBuffer(bytes);
  expect(new TextDecoder().decode(await zip.readFile("header.json"))).toBe(
    "hello"
  );
});

test("supports empty directories and byte views into larger buffers", async () => {
  const empty = await openZipFileFromBuffer(zipSync({}));
  expect(empty.centralDirectory.size).toBe(0);
  const { bytes } = archive();
  const padded = new Uint8Array(bytes.length + 30);
  padded.set(bytes, 15);
  const zip = await openZipFileFromBuffer(
    padded.subarray(15, 15 + bytes.length)
  );
  expect(new TextDecoder().decode(await zip.readFile("header.json"))).toBe(
    "hello"
  );
});

test("rejects a short range response", async () => {
  const { bytes } = archive();
  await expect(
    openRemoteZipFile("log.eval", bytes.length, () =>
      Promise.resolve(new Uint8Array(1))
    )
  ).rejects.toThrow(/range response length/);
});

test("applies caller limits to the uncompressed entry", async () => {
  const bytes = zipSync({ "header.json": new Uint8Array(2000) });
  const zip = await openZipFileFromBuffer(bytes);
  await expect(zip.readFile("header.json", 1000)).rejects.toThrow(
    /maximum size/
  );
});

test("reads deflate entries and rejects underreported or overreported output", async () => {
  const expected = new TextEncoder().encode("hello".repeat(1000));
  const bytes = zipSync({ "header.json": expected });
  const zip = await openZipFileFromBuffer(bytes);
  expect(await zip.readFile("header.json")).toEqual(expected);
  const view = new DataView(bytes.buffer);
  const directory = view.getUint32(bytes.length - 6, true);
  for (const size of [1, 1024 * 1024 * 1024]) {
    view.setUint32(22, size, true);
    view.setUint32(directory + 24, size, true);
    const malformed = await openZipFileFromBuffer(bytes);
    await expect(malformed.readFile("header.json")).rejects.toThrow(
      /size does not match/
    );
  }
});

// Python zipfile force_zip64 output, with and without a non-seekable writer.
test.each([
  "UEsDBC0AAAAAAAAAIViGphA2//////////8LABQAaGVhZGVyLmpzb24BABAABQAAAAAAAAAFAAAAAAAAAGhlbGxvUEsBAi0DLQAAAAAAAAAhWIamEDYFAAAABQAAAAsAAAAAAAAAAAAAAIABAAAAAGhlYWRlci5qc29uUEsFBgAAAAABAAEAOQAAAEIAAAAAAA==",
  "UEsDBC0ACAAAAAAAIVgAAAAA//////////8LABQAaGVhZGVyLmpzb24BABAAAAAAAAAAAAAAAAAAAAAAAGhlbGxvUEsHCIamEDYFAAAAAAAAAAUAAAAAAAAAUEsBAi0DLQAIAAAAAAAhWIamEDYFAAAABQAAAAsAAAAAAAAAAAAAAIABAAAAAGhlYWRlci5qc29uUEsFBgAAAAABAAEAOQAAAFoAAAAAAA==",
])("reads ZIP64 local headers and data descriptors (%#)", async (base64) => {
  const bytes = new Uint8Array(Buffer.from(base64, "base64"));
  const zip = await openZipFileFromBuffer(bytes);
  expect(new TextDecoder().decode(await zip.readFile("header.json"))).toBe(
    "hello"
  );
});
