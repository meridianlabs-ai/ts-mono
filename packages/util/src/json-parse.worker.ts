import JSON5 from "json5";

import {
  findSentinelPaths,
  isDenseGraph,
  kReparseThresholdChars,
  makeSentinels,
  ParseResponse,
  repairWithSentinels,
  replaceSentinelsInPlace,
  restoreRootSentinel,
} from "./json-parse-shared";

type ParseOutcome = Omit<ParseResponse, "requestId" | "success">;

const decoder = new TextDecoder();

// Non-strict JSON: repair Python-style bare NaN/Infinity and parse natively;
// full (slow) JSON5 only for real JSON5 syntax. Returns { result } to clone
// back, or { reparse, sourceText, nonFinitePaths, sentinels } when the main
// thread is better off parsing the repaired text itself. A reviver would be
// ~8x slower than plain parse on either thread, so sentinels are located
// with an off-thread walk and restored by targeted fixup instead.
const parseFallback = (source: string, big: boolean): ParseOutcome => {
  const sentinels = makeSentinels();
  const repaired = repairWithSentinels(source, sentinels);
  if (repaired !== null) {
    let plain: unknown;
    let repairedOk = true;
    try {
      plain = JSON.parse(repaired);
    } catch {
      // repaired text still invalid — let JSON5 produce the real error
      repairedOk = false;
    }
    if (repairedOk) {
      if (typeof plain === "string") {
        return { result: restoreRootSentinel(plain, sentinels) };
      }
      if (big && isDenseGraph(source)) {
        const paths = findSentinelPaths(plain, sentinels, 100000);
        if (paths !== null) {
          return {
            reparse: true,
            sourceText: repaired,
            nonFinitePaths: paths,
            sentinels,
          };
        }
        // Path cap exceeded: a big dense document saturated with non-finite
        // values lands on the (slower) clone path — accepted inversion, the
        // alternative is shipping a path list rivaling the payload itself.
      }
      replaceSentinelsInPlace(plain, sentinels);
      return { result: plain };
    }
  }
  return { result: JSON5.parse<unknown>(source) };
};

const parse = (text: string | undefined, bytes: Uint8Array): ParseOutcome => {
  const source = text ?? decoder.decode(bytes);
  const big = source.length > kReparseThresholdChars;

  // Structured clone hands the object graph straight to the main thread,
  // but its cost scales with node count: for big node-dense payloads it
  // blocks the receiving thread longer than a plain JSON.parse of the
  // source would (measured 4x total / 2x blocking on real 186MB
  // transcript data — see bench/). For those, skip the clone and tell
  // the main thread to run one JSON.parse itself — the cheapest possible
  // materialization. String-heavy payloads keep the clone (cheaper than
  // re-parsing).
  let result: unknown;
  try {
    result = JSON.parse(source);
  } catch {
    return parseFallback(source, big);
  }
  if (big && isDenseGraph(source)) {
    // string requests retain their text on the main thread; byte requests
    // need the decoded source shipped back (cheap flat clone)
    return text !== undefined
      ? { reparse: true }
      : { reparse: true, sourceText: source };
  }
  return { result };
};

self.addEventListener("message", (event: MessageEvent<unknown>) => {
  const message = event.data;
  if (
    typeof message !== "object" ||
    message === null ||
    !("type" in message) ||
    message.type !== "parse" ||
    !("requestId" in message) ||
    typeof message.requestId !== "number"
  ) {
    return;
  }
  const { requestId } = message;
  const text =
    "text" in message && typeof message.text === "string"
      ? message.text
      : undefined;
  const bytes =
    "bytes" in message && message.bytes instanceof Uint8Array
      ? message.bytes
      : new Uint8Array();
  let response: ParseResponse;
  try {
    response = { ...parse(text, bytes), requestId, success: true };
  } catch (err) {
    response = {
      requestId,
      success: false,
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? (err.stack ?? "") : "",
    };
  }
  self.postMessage(response);
});
