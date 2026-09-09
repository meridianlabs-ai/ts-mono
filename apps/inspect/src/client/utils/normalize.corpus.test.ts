/**
 * Vintage-corpus regression test for boundary normalization (#555).
 *
 * Every real `.eval` fixture in the repo (Nov-2024 through Jul-2025 writers)
 * is read the way the viewer reads it — header.json / _journal/start.json
 * plus every samples/*.json — and run through the normalizers. The
 * assertions are the invariants downstream code now relies on unguarded:
 * required-by-type fields are genuinely present after normalization.
 *
 * When an old log breaks in production, its file joins this corpus.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  normalizeEvalSample,
  normalizeSampleSummaries,
} from "@tsmono/inspect-common/normalize";
import { isRecord } from "@tsmono/util";

import { openZipFileFromBuffer } from "../remote/remoteZipFile";

import { normalizeEvalHeader, normalizeLogStart } from "./normalize";

const fixturesDir = join(
  process.cwd(),
  "src/log_data/chunked/fixtures/logs/original"
);
const logNames = readdirSync(fixturesDir).filter((name) =>
  name.endsWith(".eval")
);

const openZip = async (name: string) => {
  const bytes = new Uint8Array(readFileSync(join(fixturesDir, name)));
  return openZipFileFromBuffer(bytes);
};

const decoder = new TextDecoder();

describe("normalization over the real .eval fixture corpus", () => {
  it.each(logNames.map((name) => [name]))("%s", async (name) => {
    const zip = await openZip(name);
    const entries = Array.from(zip.centralDirectory.keys());
    const readJson = async (entry: string): Promise<unknown> =>
      JSON.parse(decoder.decode(await zip.readFile(entry)));

    // Header path: header.json when finalized, start.json while running.
    if (entries.includes("header.json")) {
      const header = normalizeEvalHeader(await readJson("header.json"));
      expect(isRecord(header.eval.task_args_passed), "task_args_passed").toBe(
        true
      );
      expect(Array.isArray(header.tags), "tags").toBe(true);
      expect(isRecord(header.metadata), "metadata").toBe(true);
      expect(header.plan?.name).toBeTypeOf("string");
      if (header.results !== null) {
        expect(Array.isArray(header.results?.scores), "results.scores").toBe(
          true
        );
      }
    }
    if (entries.includes("_journal/start.json")) {
      const start = normalizeLogStart(await readJson("_journal/start.json"));
      expect(start.eval.eval_id).toBeTypeOf("string");
      expect(isRecord(start.eval.task_args_passed)).toBe(true);
    }

    // Summary path: summaries.json (finalized) and the per-flush journal
    // files (running / fallback reads) both feed readSampleSummaries. Real
    // vintage rows carry only id/epoch/input/scores/target — the fills are
    // what downstream now reads unguarded.
    const summaryEntries = entries.filter(
      (entry) =>
        entry === "summaries.json" ||
        (entry.startsWith("_journal/summaries/") && entry.endsWith(".json"))
    );
    expect(summaryEntries.length).toBeGreaterThan(0);
    for (const entry of summaryEntries) {
      const summaries = normalizeSampleSummaries(await readJson(entry));
      const context = `${name} ${entry}`;
      expect(summaries.length, context).toBeGreaterThan(0);
      for (const summary of summaries) {
        expect(typeof summary.completed, context).toBe("boolean");
        expect(isRecord(summary.metadata), context).toBe(true);
        expect(isRecord(summary.model_usage), context).toBe(true);
        expect(isRecord(summary.role_usage), context).toBe(true);
        expect(
          isRecord(summary.scores) || summary.scores === null,
          context
        ).toBe(true);
        expect(
          typeof summary.input === "string" || Array.isArray(summary.input),
          context
        ).toBe(true);
        expect(
          typeof summary.target === "string" || Array.isArray(summary.target),
          context
        ).toBe(true);
        for (const fallback of summary.model_fallbacks ?? []) {
          expect(typeof fallback.count, context).toBe("number");
        }
      }
    }

    // Sample path: the invariants the transcript renders unguarded.
    const sampleEntries = entries.filter(
      (entry) => entry.startsWith("samples/") && entry.endsWith(".json")
    );
    expect(sampleEntries.length).toBeGreaterThan(0);
    for (const entry of sampleEntries) {
      const sample = normalizeEvalSample(await readJson(entry));
      const context = `${name} ${entry}`;

      expect(Array.isArray(sample.messages), context).toBe(true);
      expect(Array.isArray(sample.events), context).toBe(true);
      for (const field of [
        "metadata",
        "store",
        "model_usage",
        "role_usage",
        "attachments",
      ] as const) {
        expect(isRecord(sample[field]), `${context} ${field}`).toBe(true);
      }
      expect(sample.output.completion, context).toBeTypeOf("string");
      expect(Array.isArray(sample.output.choices), context).toBe(true);

      // Recursive: tool/subtask events nest child event streams, and the
      // normalizer must fill them the way pydantic validates nested models.
      const assertEventInvariants = (events: unknown[], context: string) => {
        for (const event of events) {
          if (!isRecord(event)) continue;
          const eventContext = `${context} ${String(event["event"])}`;
          expect(event["working_start"], eventContext).toBeTypeOf("number");
          expect(event["timestamp"], eventContext).toBeTypeOf("string");
          if (event["event"] === "model") {
            expect(isRecord(event["config"]), eventContext).toBe(true);
            const output = event["output"];
            expect(isRecord(output), eventContext).toBe(true);
            if (isRecord(output)) {
              expect(output["completion"], eventContext).toBeTypeOf("string");
              expect(Array.isArray(output["choices"]), eventContext).toBe(true);
            }
            expect(Array.isArray(event["input"]), eventContext).toBe(true);
            expect(Array.isArray(event["tools"]), eventContext).toBe(true);
            expect(event["tool_choice"], eventContext).toBeDefined();
          }
          if (event["event"] === "error") {
            expect(isRecord(event["error"]), eventContext).toBe(true);
          }
          if (event["event"] === "logger") {
            expect(isRecord(event["message"]), eventContext).toBe(true);
          }
          if (event["event"] === "score") {
            expect(event["intermediate"], eventContext).toBeTypeOf("boolean");
          }
          if (event["event"] === "state" || event["event"] === "store") {
            expect(Array.isArray(event["changes"]), eventContext).toBe(true);
          }
          if (event["event"] === "tool" || event["event"] === "subtask") {
            expect(Array.isArray(event["events"]), eventContext).toBe(true);
            if (Array.isArray(event["events"])) {
              assertEventInvariants(event["events"], `${eventContext} >`);
            }
          }
        }
      };
      assertEventInvariants(sample.events, context);
    }
  });
});
