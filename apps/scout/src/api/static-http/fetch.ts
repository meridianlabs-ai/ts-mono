import { decompress as decompressZstd } from "fzstd";

import { asyncJsonParseBytes } from "@tsmono/util";

export const joinUrl = (base: string, ...parts: string[]): string => {
  const trimmedBase = base.endsWith("/") ? base.slice(0, -1) : base;
  const cleaned = parts
    .map((p) => p.replace(/^\/+|\/+$/g, ""))
    .filter((p) => p.length > 0);
  return [trimmedBase, ...cleaned].join("/");
};

const fetchOk = async (url: string): Promise<Response> => {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch ${url}: ${res.status} ${res.statusText}`);
  }
  return res;
};

export const fetchJson = async <T>(url: string): Promise<T> => {
  const res = await fetchOk(url);
  return (await res.json()) as T;
};

export const fetchBytes = async (url: string): Promise<ArrayBuffer> => {
  const res = await fetchOk(url);
  return res.arrayBuffer();
};

/**
 * Fetch a `.json.zst` file: zstd-decompress (pure-JS fzstd, no wasm) then
 * parse — off the main thread for large payloads.
 */
export const fetchJsonZst = async <T>(url: string): Promise<T> => {
  const bytes = await fetchBytes(url);
  return asyncJsonParseBytes<T>(decompressZstd(new Uint8Array(bytes)));
};

/** True when a resource exists (HEAD request; 404 → false). */
export const urlExists = async (url: string): Promise<boolean> => {
  const res = await fetch(url, { method: "HEAD" });
  return res.ok;
};
