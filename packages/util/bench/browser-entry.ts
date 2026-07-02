/*
 * Page-side benchmark harness for json-worker. Bundled by run-bench.mjs and
 * loaded into Chromium. Exposes window.JsonWorkerBench for the node runner.
 *
 * Not part of the library build; excluded from typecheck/lint.
 */
import JSON5 from "json5";

import { asyncJsonParse, asyncJsonParseBytes } from "../src/json-worker";

type PayloadKind =
  | "flat"
  | "evalLog"
  | "numbers"
  | "deep"
  | "json5"
  | "nonfinite";
type ApiName = "syncParse" | "asyncJsonParse" | "asyncJsonParseBytes";

interface IterationStats {
  // per-op wall clock (divided by innerReps)
  totalMs: number;
  // sum of event-loop gaps > threshold during the timed window (per-op)
  blockedMs: number;
  // longest single event-loop gap during the window (raw, not divided)
  maxBlockMs: number;
}

interface CaseResult {
  iterations: IterationStats[];
  verified: boolean;
  verifyDetail?: string;
}

const BLOCK_THRESHOLD_MS = 10;

// --- deterministic payload generation ---------------------------------------

const makeRng = (seed: number) => {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
};

const WORDS =
  "alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima mike november oscar papa quebec romeo sierra tango uniform victor whiskey xray yankee zulu".split(
    " "
  );

const sentence = (rng: () => number, approxChars: number): string => {
  const parts: string[] = [];
  let len = 0;
  while (len < approxChars) {
    const w = WORDS[Math.floor(rng() * WORDS.length)]!;
    parts.push(w);
    len += w.length + 1;
  }
  return parts.join(" ");
};

const makeRecord = (rng: () => number, i: number, contentChars: number) => ({
  id: i,
  uuid: `${Math.floor(rng() * 1e9).toString(16)}-${Math.floor(rng() * 1e9).toString(16)}`,
  score: Math.round(rng() * 1e6) / 1e4,
  ok: rng() > 0.5,
  tags: Array.from({ length: 1 + Math.floor(rng() * 4) }, () =>
    sentence(rng, 8)
  ),
  message: {
    role: rng() > 0.5 ? "assistant" : "user",
    content: sentence(rng, contentChars),
  },
});

const genFlat = (targetBytes: number): string => {
  const rng = makeRng(42);
  if (targetBytes < 400) {
    return JSON.stringify(makeRecord(rng, 0, 16));
  }
  const contentChars = 256;
  const probe = JSON.stringify(makeRecord(rng, 0, contentChars));
  const count = Math.max(1, Math.round(targetBytes / (probe.length + 1)));
  const records = Array.from({ length: count }, (_, i) =>
    makeRecord(rng, i, contentChars)
  );
  return JSON.stringify(records);
};

// String-heavy nested structure shaped like an inspect eval log
const genEvalLog = (targetBytes: number): string => {
  const rng = makeRng(7);
  const makeSample = (i: number) => ({
    id: `sample-${i}`,
    epoch: 1 + (i % 3),
    input: sentence(rng, 800),
    target: sentence(rng, 120),
    messages: Array.from({ length: 6 }, (_, m) => ({
      id: `msg-${i}-${m}`,
      role: m % 2 === 0 ? "user" : "assistant",
      content: sentence(rng, 2500),
    })),
    events: Array.from({ length: 10 }, (_, e) => ({
      timestamp: `2026-01-01T00:${String(e % 60).padStart(2, "0")}:00Z`,
      event: "model",
      output: sentence(rng, 400),
      tokens: Math.floor(rng() * 4096),
    })),
    scores: { accuracy: { value: rng(), explanation: sentence(rng, 200) } },
  });
  const probe = JSON.stringify(makeSample(0));
  const count = Math.max(1, Math.round(targetBytes / (probe.length + 1)));
  const log = {
    version: 2,
    status: "success",
    eval: {
      task: "benchmark_task",
      model: "example/model",
      created: "2026-01-01T00:00:00Z",
    },
    samples: Array.from({ length: count }, (_, i) => makeSample(i)),
  };
  return JSON.stringify(log);
};

const genNumbers = (targetBytes: number): string => {
  const rng = makeRng(1234);
  // ~19 chars per element incl. separator
  const count = Math.max(1, Math.round(targetBytes / 19));
  const nums = Array.from(
    { length: count },
    () => Math.round(rng() * 1e12) / 1e4
  );
  return JSON.stringify(nums);
};

// Array of depth-24 chains: exercises deeply nested structure at any size
const genDeep = (targetBytes: number): string => {
  const rng = makeRng(99);
  const chain = (depth: number): unknown =>
    depth <= 0
      ? { leaf: sentence(rng, 40), value: rng() }
      : { name: sentence(rng, 12), value: rng(), child: chain(depth - 1) };
  const probeStr = JSON.stringify(chain(24));
  const count = Math.max(1, Math.round(targetBytes / (probeStr.length + 1)));
  return JSON.stringify(Array.from({ length: count }, () => chain(24)));
};

// JSON5-only syntax (unquoted keys, single quotes, trailing commas, comments)
// so JSON.parse fails immediately and the JSON5 fallback path is exercised.
const genJson5 = (targetBytes: number): string => {
  const rng = makeRng(5);
  const item = (i: number) =>
    `{id:${i},label:'${sentence(rng, 32)}',score:${(rng() * 100).toFixed(4)},flags:[${rng() > 0.5},${rng() > 0.5},],}`;
  const probe = item(0);
  const count = Math.max(1, Math.round(targetBytes / (probe.length + 1)));
  const items: string[] = [];
  for (let i = 0; i < count; i++) items.push(item(i));
  return `// benchmark payload\n[${items.join(",\n")},]`;
};

// Strict JSON except for bare NaN/Infinity tokens — what Python's json.dumps
// emits for non-finite floats. This is the dominant real-world reason the
// JSON5 fallback exists. Some string values deliberately contain ", NaN,"
// to prove in-string tokens survive repair untouched.
const genNonFinite = (targetBytes: number): string => {
  const rng = makeRng(77);
  const item = (i: number): string => {
    const score =
      i % 50 === 3
        ? ["NaN", "Infinity", "-Infinity"][i % 3]!
        : (rng() * 100).toFixed(4);
    const label =
      i % 97 === 5
        ? "decoy tokens in string: NaN, Infinity, -Infinity"
        : sentence(rng, 48);
    return `{"id":${i},"label":${JSON.stringify(label)},"score":${score},"ok":${rng() > 0.5}}`;
  };
  const probe = item(0);
  const count = Math.max(2, Math.round(targetBytes / (probe.length + 1)));
  const items: string[] = [];
  for (let i = 0; i < count; i++) items.push(item(i));
  return `[${items.join(",")}]`;
};

const GENERATORS: Record<PayloadKind, (target: number) => string> = {
  flat: genFlat,
  evalLog: genEvalLog,
  numbers: genNumbers,
  deep: genDeep,
  json5: genJson5,
  nonfinite: genNonFinite,
};

// --- correctness probes ------------------------------------------------------

const probeValue = (v: unknown): unknown => {
  if (Array.isArray(v)) {
    return {
      type: "array",
      length: v.length,
      first: v[0],
      mid: v[Math.floor(v.length / 2)],
      last: v[v.length - 1],
    };
  }
  if (v && typeof v === "object") {
    const keys = Object.keys(v).sort();
    const o = v as Record<string, unknown>;
    return {
      type: "object",
      keyCount: keys.length,
      firstKey: keys[0],
      firstVal: probeShallow(o[keys[0]!]),
      lastKey: keys[keys.length - 1],
    };
  }
  return v;
};

const probeShallow = (v: unknown): unknown =>
  Array.isArray(v)
    ? { length: v.length }
    : v && typeof v === "object"
      ? { keyCount: Object.keys(v).length }
      : v;

// NaN/Infinity stringify to null by default, which would mask corruption of
// non-finite values — encode them explicitly so probes catch it.
const probeJson = (v: unknown): string =>
  JSON.stringify(probeValue(v), (_k, val: unknown) =>
    typeof val === "number" && !Number.isFinite(val)
      ? `__nonfinite:${String(val)}__`
      : val
  );

// --- event-loop blocking monitor ----------------------------------------------

const startBlockMonitor = () => {
  const ch = new MessageChannel();
  let last = performance.now();
  let blockedMs = 0;
  let maxBlockMs = 0;
  let running = true;
  ch.port1.onmessage = () => {
    const now = performance.now();
    const gap = now - last;
    if (gap > BLOCK_THRESHOLD_MS) blockedMs += gap;
    if (gap > maxBlockMs) maxBlockMs = gap;
    last = now;
    if (running) ch.port2.postMessage(0);
  };
  ch.port2.postMessage(0);
  return {
    stop(): { blockedMs: number; maxBlockMs: number } {
      running = false;
      ch.port1.close();
      ch.port2.close();
      return { blockedMs, maxBlockMs };
    },
  };
};

const nextMacroTask = () =>
  new Promise<void>((resolve) => setTimeout(resolve, 0));

// --- harness state -------------------------------------------------------------

let payloadText = "";
let payloadBytes: Uint8Array | null = null;
let payloadKind: PayloadKind = "flat";
let refProbe = "";

const syncParse = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return JSON5.parse(text);
  }
};

const generate = (
  kind: PayloadKind,
  targetBytes: number
): { chars: number; bytes: number } => {
  payloadKind = kind;
  payloadText = GENERATORS[kind](targetBytes);
  payloadBytes = new TextEncoder().encode(payloadText);
  refProbe = probeJson(syncParse(payloadText));
  return { chars: payloadText.length, bytes: payloadBytes.length };
};

// Real-world payloads served by the bench runner from bench/fixtures/
const loadFixture = async (
  url: string
): Promise<{ chars: number; bytes: number }> => {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`fixture fetch failed: ${resp.status}`);
  payloadBytes = new Uint8Array(await resp.arrayBuffer());
  payloadText = new TextDecoder().decode(payloadBytes);
  refProbe = probeJson(syncParse(payloadText));
  return { chars: payloadText.length, bytes: payloadBytes.length };
};

const runApi = async (api: ApiName): Promise<unknown> => {
  switch (api) {
    case "syncParse":
      return syncParse(payloadText);
    case "asyncJsonParse":
      return asyncJsonParse(payloadText);
    case "asyncJsonParseBytes": {
      // parseBytes transfers (detaches) the buffer, so hand it a fresh copy —
      // real callers pass freshly-fetched bytes they no longer need.
      const copy = payloadBytes!.slice();
      return asyncJsonParseBytes(copy);
    }
  }
};

const runCase = async (
  api: ApiName,
  iterations: number,
  innerReps: number
): Promise<CaseResult> => {
  // warmup (also verifies correctness once)
  const warm = await runApi(api);
  const got = probeJson(warm);
  const verified = got === refProbe;
  const verifyDetail = verified ? undefined : `expected ${refProbe} got ${got}`;

  const stats: IterationStats[] = [];
  for (let i = 0; i < iterations; i++) {
    const g = (globalThis as { gc?: () => void }).gc;
    if (g) g();
    await nextMacroTask();
    const monitor = startBlockMonitor();
    const t0 = performance.now();
    for (let r = 0; r < innerReps; r++) {
      await runApi(api);
    }
    const t1 = performance.now();
    // let the loop settle so trailing gaps attribute to this window
    await nextMacroTask();
    const { blockedMs, maxBlockMs } = monitor.stop();
    stats.push({
      totalMs: (t1 - t0) / innerReps,
      blockedMs: blockedMs / innerReps,
      maxBlockMs,
    });
  }
  return { iterations: stats, verified, verifyDetail };
};

const releasePayload = () => {
  payloadText = "";
  payloadBytes = null;
  refProbe = "";
};

// warm the worker pool once so pool/JSON5 startup doesn't skew the first case
const warmupPool = async (): Promise<void> => {
  const big = `[${Array.from({ length: 6000 }, (_, i) => `{"i":${i}}`).join(",")}]`;
  await asyncJsonParse(big);
  await asyncJsonParseBytes(new TextEncoder().encode(big));
};

declare global {
  interface Window {
    JsonWorkerBench: {
      warmupPool: typeof warmupPool;
      generate: typeof generate;
      loadFixture: typeof loadFixture;
      runCase: typeof runCase;
      releasePayload: typeof releasePayload;
      payloadKindCheck: () => PayloadKind;
    };
  }
}

window.JsonWorkerBench = {
  warmupPool,
  generate,
  loadFixture,
  runCase,
  releasePayload,
  payloadKindCheck: () => payloadKind,
};
