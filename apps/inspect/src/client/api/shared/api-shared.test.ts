// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { download_file } from "./api-shared";

let downloaded: Blob[] = [];

beforeEach(() => {
  downloaded = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.reject(new Error("fetch is not allowed")))
  );
  vi.spyOn(URL, "createObjectURL").mockImplementation((blob) => {
    if (blob instanceof Blob) downloaded.push(blob);
    return "blob:download";
  });
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const bytes = async (blob: Blob | undefined): Promise<number[]> =>
  Array.from(new Uint8Array(await (blob ?? new Blob()).arrayBuffer()));

test("decodes a base64 data URL without fetching it", async () => {
  await download_file("x.png", "data:image/png;base64,AAEC");
  expect(downloaded[0]?.type).toBe("image/png");
  expect(await bytes(downloaded[0])).toEqual([0, 1, 2]);
  expect(fetch).not.toHaveBeenCalled();
});

test("decodes a percent-encoded data URL", async () => {
  await download_file("x.txt", "data:,a%20b");
  expect(downloaded[0]?.type).toBe("text/plain");
  expect(await downloaded[0]?.text()).toBe("a b");
});

test("rejects a malformed data URL", async () => {
  await expect(download_file("x", "data:no-comma")).rejects.toThrow(
    /Malformed data URL/
  );
  expect(downloaded).toHaveLength(0);
});

test("downloads other text as plain text", async () => {
  await download_file("x.json", '{"a": 1}');
  expect(downloaded[0]?.type).toBe("text/plain");
  expect(await downloaded[0]?.text()).toBe('{"a": 1}');
});
