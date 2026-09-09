/**
 * The static-HTTP v1 migration, exercised against a real v1 log.
 *
 * The fixture derives from an actual inspect_ai 0.3.15 (June 2024) pico-ctf
 * log from an internal archive, trimmed to two samples (one scored 0, one
 * scored 1) with long message content truncated and the CTF flag and source
 * revision redacted. The v1 shape under test is untouched: `results.scorer`
 * (singular) with sibling `results.metrics`, and a singular `score` object
 * per sample.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { fetchLogFile } from "./fetch";

const fixtureText = readFileSync(
  join(
    process.cwd(),
    "src/client/api/static-http/fixtures/2024-06-26T08-50-44+00-00_pico-ctf_LVDZAPGgTfBDUo3yzLpPmG_v1_truncated.json"
  ),
  "utf-8"
);

const SCORER = "metr_integration/metr_scorer";

describe("fetchLogFile v1 migration", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response(fixtureText, { status: 200 })))
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("reshapes results.scorer into the scores array", async () => {
    const contents = await fetchLogFile("http://localhost:3000/logs/v1.json");
    const log = contents?.parsed;
    expect(log?.version).toBe(1);

    const scores = log?.results?.scores;
    expect(scores).toHaveLength(1);
    expect(scores?.[0]?.name).toBe(SCORER);
    expect(scores?.[0]?.scorer).toBe(SCORER);
    expect(scores?.[0]?.metrics["mean"]?.value).toBe(0.5);

    // the v1 fields are gone, not duplicated alongside the migrated shape
    expect(log?.results).not.toHaveProperty("scorer");
    expect(log?.results).not.toHaveProperty("metrics");
  });

  test("moves each sample's singular score under the scorer name", async () => {
    const contents = await fetchLogFile("http://localhost:3000/logs/v1.json");
    const samples = contents?.parsed.samples;
    expect(samples).toHaveLength(2);

    expect(samples?.map((sample) => sample.scores?.[SCORER]?.value)).toEqual([
      0.0, 1.0,
    ]);
    for (const sample of samples ?? []) {
      expect(sample).not.toHaveProperty("score");
    }
  });

  test("migrated output flows through the normalizer", async () => {
    const contents = await fetchLogFile("http://localhost:3000/logs/v1.json");
    const log = contents?.parsed;

    // read-time defaults for fields v1 logs predate
    expect(log?.eval.task_args_passed).toEqual({});
    for (const sample of log?.samples ?? []) {
      expect(Array.isArray(sample.events)).toBe(true);
      expect(sample.store).toEqual({});
      expect(sample.attachments).toEqual({});
    }
  });
});
