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

import { logFetchInit } from "@tsmono/util";

import { fetchJsonFile, fetchLogFile, fetchManifest } from "./fetch";

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

describe("static log fetch options", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response("{}", { status: 200 })))
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("log fetches omit the referrer, scope credentials, and refuse redirects", async () => {
    await fetchJsonFile("http://localhost:3000/logs/listing.json");

    expect(fetch).toHaveBeenCalledWith(
      "http://localhost:3000/logs/listing.json",
      expect.objectContaining(logFetchInit)
    );
  });
});

describe("fetchManifest", () => {
  // What inspect_ai 0.3.150 `inspect view bundle` writes: LogOverview
  // predates `model_roles`/`invalidated`, and exclude_none drops `error`
  // and an unscored log's `primary_metric`.
  const legacyListing = {
    "2024-11-21T07-19-57-08-00_solo-agent_KLVSy7Dn9tHf7WCHbFmbPY.eval": {
      eval_id: "TcENcn2QPtcgSkeNc5nSbj",
      run_id: "DSwRm98qw3sm8uTY6hCWhk",
      task: "solo_agent",
      task_id: "KLVSy7Dn9tHf7WCHbFmbPY",
      task_version: 0,
      version: 2,
      status: "success",
      model: "openai/gpt-4o-mini-2024-07-18-free",
      started_at: "2024-11-21T07:19:57-08:00",
      completed_at: "2024-11-21T08:22:27-08:00",
    },
  };

  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify(legacyListing), { status: 200 })
        )
      )
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("parses a legacy bundle listing and passes its entries through", async () => {
    const manifest = await fetchManifest("http://localhost:3000/logs");

    expect(fetch).toHaveBeenCalledWith(
      "http://localhost:3000/logs/listing.json",
      expect.objectContaining(logFetchInit)
    );
    const [preview] = Object.values(manifest?.parsed ?? {});
    expect(preview).toEqual(Object.values(legacyListing)[0]);
    expect(preview?.primary_metric).toBeUndefined();
  });
});
