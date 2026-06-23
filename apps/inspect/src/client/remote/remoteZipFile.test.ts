import { describe, expect, test } from "vitest";

import { openRemoteZipFile } from "./remoteZipFile";

/**
 * Build a minimal valid ZIP buffer (STORED entries, no compression) so
 * we can drive openRemoteZipFile with a recording fetchBytes mock and
 * assert on the network-call pattern rather than on entry contents.
 */
function buildZip(entries: { name: string; data: Uint8Array }[]): Uint8Array {
  const enc = new TextEncoder();
  const localHeaders: Uint8Array[] = [];
  const centralHeaders: Uint8Array[] = [];
  let offset = 0;

  for (const { name, data } of entries) {
    const nameBytes = enc.encode(name);
    // Local file header (30 bytes) + name + data
    const lh = new Uint8Array(30 + nameBytes.length + data.length);
    const lv = new DataView(lh.buffer);
    lv.setUint32(0, 0x04034b50, true); // signature
    lv.setUint16(4, 20, true); // version needed
    lv.setUint16(6, 0, true); // flags
    lv.setUint16(8, 0, true); // method = STORED
    lv.setUint32(14, 0, true); // crc (unused by reader)
    lv.setUint32(18, data.length, true); // compressed size
    lv.setUint32(22, data.length, true); // uncompressed size
    lv.setUint16(26, nameBytes.length, true); // name len
    lv.setUint16(28, 0, true); // extra len
    lh.set(nameBytes, 30);
    lh.set(data, 30 + nameBytes.length);
    localHeaders.push(lh);

    // Central directory header (46 bytes) + name
    const ch = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(ch.buffer);
    cv.setUint32(0, 0x02014b50, true); // signature
    cv.setUint16(4, 20, true); // version made by
    cv.setUint16(6, 20, true); // version needed
    cv.setUint16(10, 0, true); // method = STORED
    cv.setUint32(20, data.length, true); // compressed size
    cv.setUint32(24, data.length, true); // uncompressed size
    cv.setUint16(28, nameBytes.length, true); // name len
    cv.setUint32(42, offset, true); // local header offset
    ch.set(nameBytes, 46);
    centralHeaders.push(ch);

    offset += lh.length;
  }

  const cdStart = offset;
  const cdSize = centralHeaders.reduce((a, b) => a + b.length, 0);

  // EOCD (22 bytes)
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, cdStart, true);

  const total =
    localHeaders.reduce((a, b) => a + b.length, 0) + cdSize + eocd.length;
  const out = new Uint8Array(total);
  let p = 0;
  for (const b of localHeaders) {
    out.set(b, p);
    p += b.length;
  }
  for (const b of centralHeaders) {
    out.set(b, p);
    p += b.length;
  }
  out.set(eocd, p);
  return out;
}

type Range = [number, number];

function recordingFetcher(buf: Uint8Array) {
  const calls: Range[] = [];
  const fetchBytes = (
    _url: string,
    start: number,
    end: number
  ): Promise<Uint8Array> => {
    calls.push([start, end]);
    return Promise.resolve(buf.slice(start, end + 1));
  };
  return { fetchBytes, calls };
}

describe("openRemoteZipFile tail-window cache", () => {
  test("zip-open + small-entry read use a single network range", async () => {
    const zip = buildZip([
      { name: "header.json", data: new TextEncoder().encode('{"a":1}') },
    ]);
    expect(zip.length).toBeLessThan(128 * 1024);
    const { fetchBytes, calls } = recordingFetcher(zip);

    const z = await openRemoteZipFile("mem://zip", zip.length, fetchBytes);
    expect(calls.length).toBe(1);
    expect(calls[0]).toEqual([0, zip.length - 1]);

    expect(z.centralDirectory.has("header.json")).toBe(true);
    const data = await z.readFile("header.json");
    expect(new TextDecoder().decode(data)).toBe('{"a":1}');
    // readFile served entirely from the tail buffer — no extra network.
    expect(calls.length).toBe(1);
  });

  test("entries before the tail window fall through to a network fetch", async () => {
    // Place a small entry at offset 0, then a 200 KB entry after it so
    // the file is large enough that offset 0 falls outside the 128 KB
    // tail window. cdir/EOCD sit at the end, so the open stays at one
    // call; readFile("first.json") needs a second.
    const first = new TextEncoder().encode('{"first":true}');
    const zip = buildZip([
      { name: "first.json", data: first },
      { name: "filler.bin", data: new Uint8Array(200 * 1024) },
    ]);
    expect(zip.length).toBeGreaterThan(128 * 1024);
    const { fetchBytes, calls } = recordingFetcher(zip);

    const z = await openRemoteZipFile("mem://zip", zip.length, fetchBytes);
    expect(calls.length).toBe(1);

    const got = await z.readFile("first.json");
    expect(new TextDecoder().decode(got)).toBe('{"first":true}');
    expect(calls.length).toBe(2);
    expect(calls[1][0]).toBe(0);
  });
});

describe("openRemoteZipFile parallelChunkSize", () => {
  test("readFile splits a large entry into parallel chunks", async () => {
    const payload = new Uint8Array(3 * 1024 * 1024); // 3 MB
    const zip = buildZip([{ name: "big.bin", data: payload }]);
    const { fetchBytes, calls } = recordingFetcher(zip);

    const z = await openRemoteZipFile("mem://zip", zip.length, fetchBytes, {
      parallelChunkSize: 768 * 1024,
    });

    const openCalls = calls.length;
    const got = await z.readFile("big.bin");
    expect(got.length).toBe(payload.length);

    // Entry header + 3 MB payload at 768 KB chunks → ~5 range requests.
    const readCalls = calls.length - openCalls;
    expect(readCalls).toBeGreaterThanOrEqual(4);
    expect(readCalls).toBeLessThanOrEqual(6);
  });

  test("default chunk size keeps a 3 MB entry as a single range", async () => {
    const payload = new Uint8Array(3 * 1024 * 1024);
    const zip = buildZip([{ name: "big.bin", data: payload }]);
    const { fetchBytes, calls } = recordingFetcher(zip);

    const z = await openRemoteZipFile("mem://zip", zip.length, fetchBytes);
    const openCalls = calls.length;
    await z.readFile("big.bin");
    expect(calls.length - openCalls).toBe(1);
  });
});
