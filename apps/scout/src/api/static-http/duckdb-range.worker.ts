/// <reference lib="webworker" />

// Classic shim worker: force identity (uncompressed) responses for Parquet HTTP
// reads, then delegate to the real DuckDB-WASM worker via importScripts.
//
// Some static hosts (e.g. Netlify) transparently compress responses based on
// content type. A non-ranged HEAD/GET then reports the *compressed*
// Content-Length, but byte ranges are served against the *uncompressed* body.
// DuckDB-WASM discovers a remote file's size from a non-ranged request, so it
// gets the compressed length and computes Parquet footer offsets that fall short
// of the true end of file — DuckDB fails with "No magic bytes found at end of
// file". Hosts serve a *ranged* request (206) uncompressed with a correct
// Content-Length / Content-Range, so adding a Range header to size-discovery
// requests makes sizing and column-chunk reads consistent.
//
// We add `Range: bytes=0-0` (a single byte) to any .parquet request that
// doesn't already carry a Range header. The 206 response still reports the true
// total via `Content-Range: bytes 0-0/<size>`, so DuckDB learns the correct
// uncompressed size without downloading the whole file — using `bytes=0-`
// (whole file) would pull the entire body on every size-discovery probe,
// defeating the range-read design. Requests DuckDB already makes as ranges
// (column-chunk reads) are untouched, and non-Parquet assets (wasm, extensions)
// are left alone so their normal whole-file delivery is unaffected.
//
// The real DuckDB worker URL is passed via the Worker constructor's `name`
// option and is available here as the global `name`.

interface PatchedRequestState {
  url: string;
  hasRange: boolean;
}

const requestState = new WeakMap<XMLHttpRequest, PatchedRequestState>();
const xhrProto = XMLHttpRequest.prototype;
// Re-dispatched below via `.call(this, ...)`, so the unbound-method concern
// (losing `this`) doesn't apply to these captured native methods.
/* eslint-disable @typescript-eslint/unbound-method */
const nativeOpen = xhrProto.open;
const nativeSetRequestHeader = xhrProto.setRequestHeader;
const nativeSend = xhrProto.send;
/* eslint-enable @typescript-eslint/unbound-method */

xhrProto.open = function (
  this: XMLHttpRequest,
  method: string,
  url: string | URL,
  async = true,
  username?: string | null,
  password?: string | null
): void {
  requestState.set(this, {
    url: typeof url === "string" ? url : url.href,
    hasRange: false,
  });
  nativeOpen.call(this, method, url, async, username, password);
};

xhrProto.setRequestHeader = function (
  this: XMLHttpRequest,
  name: string,
  value: string
): void {
  if (name.toLowerCase() === "range") {
    const state = requestState.get(this);
    if (state) state.hasRange = true;
  }
  nativeSetRequestHeader.call(this, name, value);
};

xhrProto.send = function (
  this: XMLHttpRequest,
  body?: XMLHttpRequestBodyInit | null
): void {
  const state = requestState.get(this);
  if (state && !state.hasRange && /\.parquet(\?|$)/.test(state.url)) {
    try {
      nativeSetRequestHeader.call(this, "Range", "bytes=0-0");
    } catch {
      // Header not settable in the current state; proceed unchanged.
    }
  }
  nativeSend.call(this, body ?? null);
};

// The real DuckDB worker URL is passed via the Worker constructor's `name`.
importScripts(self.name);
