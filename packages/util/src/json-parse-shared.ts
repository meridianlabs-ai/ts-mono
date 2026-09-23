/**
 * JSON parsing helpers shared by the main-thread parser in json-worker.ts and
 * the worker entry in json-parse.worker.ts, plus the message shapes the two
 * exchange.
 */

export interface NonFiniteSentinels {
  nan: string;
  inf: string;
  ninf: string;
}

export interface ParseRequest {
  type: "parse";
  requestId: number;
  text?: string;
  bytes?: Uint8Array;
}

// Shape posted back by the worker for a parse request.
export interface ParseResponse {
  requestId: number;
  success: boolean;
  result?: unknown;
  // Payload is (possibly repaired) strict JSON too large to clone
  // efficiently — re-parse it on the main thread from sourceText (or the
  // retained request text for string inputs).
  reparse?: boolean;
  sourceText?: string;
  // Set when sourceText is repaired JSON: paths whose values are sentinel
  // strings to restore to NaN/Infinity/-Infinity after the plain parse.
  nonFinitePaths?: (string | number)[][];
  sentinels?: NonFiniteSentinels;
  error?: string;
  stack?: string;
}

export const makeSentinels = (): NonFiniteSentinels => {
  const nonce = Math.random().toString(36).slice(2);
  return {
    nan: `__json5_nan_${nonce}__`,
    inf: `__json5_inf_${nonce}__`,
    ninf: `__json5_ninf_${nonce}__`,
  };
};

// Repairs text with sentinel-string replacements for the bare non-finite
// tokens; see repairNonFiniteJson.
export const repairWithSentinels = (
  source: string,
  sentinels: NonFiniteSentinels
): string | null =>
  repairNonFiniteJson(
    source,
    `"${sentinels.nan}"`,
    `"${sentinels.inf}"`,
    `"${sentinels.ninf}"`
  );

// A bare non-finite token at the root parses to its sentinel string.
export const restoreRootSentinel = (
  value: string,
  sentinels: NonFiniteSentinels
): unknown =>
  value === sentinels.nan
    ? NaN
    : value === sentinels.inf
      ? Infinity
      : value === sentinels.ninf
        ? -Infinity
        : value;

// Above this size, node-dense strict-JSON results skip the structured clone
// and are re-parsed on the main thread instead (see json-parse.worker.ts). Below it,
// clone stalls are ~20ms or less and cloning avoids the second parse.
export const kReparseThresholdChars = 10_000_000;

// Repairs "almost strict" JSON — strict JSON except bare NaN/Infinity/
// -Infinity tokens, which is what Python's json.dumps emits for non-finite
// floats and the dominant real reason the JSON5 fallback exists — by
// swapping those tokens for the given sentinel strings so native JSON.parse
// (~100x faster than JSON5.parse) can take it from there. Tracks in-string
// state, so tokens inside string values are never touched. Returns null if
// the text needs real JSON5 (comments, unquoted keys, quotes, ...) or
// contains no bare tokens; JSON.parse of the output remains the final
// validator for anything this scan waves through (digits, exponents, ...).
export const repairNonFiniteJson = (
  source: string,
  nanToken: string,
  infToken: string,
  negInfToken: string
): string | null => {
  const n = source.length;
  const parts: string[] = [];
  let copied = 0;
  let i = 0;
  // A bare token followed by ':' is a JSON5 unquoted object KEY ({NaN: 1}),
  // not a value — replacing it would silently rename the key, so bail to the
  // full JSON5 parser instead.
  const isKeyPosition = (after: number): boolean => {
    let j = after;
    while (j < n) {
      const w = source.charCodeAt(j);
      if (w === 32 || w === 9 || w === 10 || w === 13) j++;
      else return w === 58; /* : */
    }
    return false;
  };
  while (i < n) {
    const c = source.charCodeAt(i);
    if (c === 34 /* " */) {
      i++;
      while (i < n) {
        const s = source.charCodeAt(i);
        if (s === 92 /* \ */) i += 2;
        else if (s === 34) break;
        else i++;
      }
      i++;
      continue;
    }
    if (c === 78 /* N */) {
      if (!source.startsWith("NaN", i) || isKeyPosition(i + 3)) return null;
      parts.push(source.slice(copied, i), nanToken);
      i += 3;
      copied = i;
      continue;
    }
    if (c === 73 /* I */) {
      if (!source.startsWith("Infinity", i) || isKeyPosition(i + 8)) {
        return null;
      }
      parts.push(source.slice(copied, i), infToken);
      i += 8;
      copied = i;
      continue;
    }
    if (c === 45 /* - */) {
      if (source.startsWith("-Infinity", i)) {
        if (isKeyPosition(i + 9)) return null;
        parts.push(source.slice(copied, i), negInfToken);
        i += 9;
        copied = i;
      } else {
        i++;
      }
      continue;
    }
    if (c === 116 /* t */) {
      if (!source.startsWith("true", i)) return null;
      i += 4;
      continue;
    }
    if (c === 102 /* f */) {
      if (!source.startsWith("false", i)) return null;
      i += 5;
      continue;
    }
    if (c === 110 /* n */) {
      if (!source.startsWith("null", i)) return null;
      i += 4;
      continue;
    }
    if (
      c === 32 ||
      c === 9 ||
      c === 10 ||
      c === 13 || // whitespace
      c === 44 ||
      c === 58 ||
      c === 123 ||
      c === 125 ||
      c === 91 ||
      c === 93 || // , : { } [ ]
      (c >= 48 && c <= 57) ||
      c === 46 ||
      c === 101 ||
      c === 69 ||
      c === 43 // number chars . e E +
    ) {
      i++;
      continue;
    }
    return null;
  }
  if (parts.length === 0) return null;
  parts.push(source.slice(copied));
  return parts.join("");
};

// Restores non-finite values at pre-located paths after a plain JSON.parse
// of repaired text.
export const applyNonFinitePaths = (
  root: unknown,
  paths: (string | number)[][],
  sentinels: NonFiniteSentinels
): void => {
  const isRecord = (v: unknown): v is Record<string | number, unknown> =>
    typeof v === "object" && v !== null;
  for (const path of paths) {
    let target: unknown = root;
    for (let i = 0; i < path.length - 1; i++) {
      if (!isRecord(target)) break;
      target = target[path[i]!];
    }
    // paths come from a walk of this same graph, so a miss here means the
    // document changed underneath us — skip rather than throw.
    if (!isRecord(target)) continue;
    const leaf = path[path.length - 1]!;
    const value = target[leaf];
    target[leaf] =
      value === sentinels.nan
        ? NaN
        : value === sentinels.inf
          ? Infinity
          : value === sentinels.ninf
            ? -Infinity
            : value;
  }
};

// Collects paths of sentinel-string values in a plain-parsed repaired
// document. Bails (returns null) past maxPaths so a pathological all-NaN
// document falls back to fixup-in-place + clone rather than shipping a huge
// path list. Iterative with a reverse-linked key chain (materialized only on
// hits): JSON.parse handles nesting far deeper than the JS call stack, so a
// recursive walk would overflow where the parse succeeded.
export const findSentinelPaths = (
  root: unknown,
  sentinels: NonFiniteSentinels,
  maxPaths: number
): (string | number)[][] | null => {
  const isRecord = (v: unknown): v is Record<string, unknown> =>
    typeof v === "object" && v !== null;
  type Frame = {
    node: unknown;
    key: string | number | null;
    prev: Frame | null;
  };
  const paths: (string | number)[][] = [];
  const stack: Frame[] = [{ node: root, key: null, prev: null }];
  while (stack.length > 0) {
    const frame = stack.pop()!;
    const node = frame.node;
    if (typeof node === "string") {
      if (
        node === sentinels.nan ||
        node === sentinels.inf ||
        node === sentinels.ninf
      ) {
        if (paths.length >= maxPaths) return null;
        const path: (string | number)[] = [];
        for (let f: Frame | null = frame; f && f.key !== null; f = f.prev) {
          path.push(f.key);
        }
        path.reverse();
        paths.push(path);
      }
    } else if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i++) {
        const v: unknown = node[i];
        if (typeof v === "string" || (v && typeof v === "object")) {
          stack.push({ node: v, key: i, prev: frame });
        }
      }
    } else if (isRecord(node)) {
      for (const key of Object.keys(node)) {
        const v = node[key];
        if (typeof v === "string" || (v && typeof v === "object")) {
          stack.push({ node: v, key, prev: frame });
        }
      }
    }
  }
  return paths;
};

// Restores every sentinel in a parsed repaired document in place. Iterative
// for the same deep-nesting reason as findSentinelPaths. Does not handle a
// sentinel at the root (callers special-case root strings).
export const replaceSentinelsInPlace = (
  root: unknown,
  sentinels: NonFiniteSentinels
): void => {
  const isRecord = (v: unknown): v is Record<string, unknown> =>
    typeof v === "object" && v !== null;
  const restore = (v: unknown): unknown =>
    v === sentinels.nan
      ? NaN
      : v === sentinels.inf
        ? Infinity
        : v === sentinels.ninf
          ? -Infinity
          : v;
  const stack: unknown[] = [root];
  while (stack.length > 0) {
    const node = stack.pop();
    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i++) {
        const v: unknown = node[i];
        if (typeof v === "string") node[i] = restore(v);
        else if (v && typeof v === "object") stack.push(v);
      }
    } else if (isRecord(node)) {
      for (const key of Object.keys(node)) {
        const v = node[key];
        if (typeof v === "string") node[key] = restore(v);
        else if (v && typeof v === "object") stack.push(v);
      }
    }
  }
};

// Structural density of the document: separators per character, ignoring
// string contents entirely — strings often embed serialized JSON or prose
// commas, which say nothing about the size of the parsed graph (a >10MB
// tool-call-heavy log would otherwise misclassify and take a main-thread
// parse stall). Scans from position 0, where in-string state is known — a
// mid-document sample can't tell string from structure — and stops after
// 16M chars: enough to classify real transcript files whose heads are less
// dense than their bodies (186MB scout: head-8MB reads 0.0499, head-16MB
// 0.0799, full file 0.1321), while capping cost at ~45ms off-thread.
// Strings are skipped via indexOf (SIMD-fast on string-heavy documents)
// with backslash-parity checks for escaped quotes. Threshold from measured
// shapes: dense 0.08-0.13 vs string-heavy <= 0.03 and embedded-JSON-in-
// strings 0.011.
export const isDenseGraph = (source: string): boolean => {
  const n = Math.min(source.length, 16_000_000);
  let seps = 0;
  let i = 0;
  while (i < n) {
    const c = source.charCodeAt(i);
    if (c === 34 /* " */) {
      i++;
      while (i < n) {
        const quote = source.indexOf('"', i);
        if (quote === -1 || quote >= n) {
          i = n;
          break;
        }
        let backslashes = 0;
        for (let j = quote - 1; j >= 0 && source.charCodeAt(j) === 92; j--) {
          backslashes++;
        }
        i = quote + 1;
        if (backslashes % 2 === 0) break;
      }
      continue;
    }
    if (c === 44 /* , */ || c === 58 /* : */) seps++;
    i++;
  }
  return seps / n > 0.05;
};
