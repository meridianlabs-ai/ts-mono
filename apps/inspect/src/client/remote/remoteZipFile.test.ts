import { zipSync } from "fflate";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { logFetchInit } from "@tsmono/util";

import { fetchSize, openRemoteZipFile, openZipFileFromBuffer } from "./remoteZipFile";

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
  const bytes = zipSync({ "header.json": new TextEncoder().encode("hello") }, { level: 0 });
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
  await expect(openRemoteZipFile("log.eval", bytes.length, fetchBytes)).rejects.toThrow();
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
  expect(new TextDecoder().decode(await zip.readFile("header.json"))).toBe("hello");
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
