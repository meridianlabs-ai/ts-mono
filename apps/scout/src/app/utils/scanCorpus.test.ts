/**
 * Vintage-corpus regression test for scan-row normalization (#555).
 *
 * The fixtures are real inspect_scout 0.3.2 (Nov 2025) scan dataframes,
 * shrunken and sanitized: written before the first-class transcript
 * identity columns (task_set / task_id / repeat / model) existed, with
 * record-shaped validation JSON strings, one resultset-valued scanner and
 * one object-valued scanner with model/tool events in scan_events. They
 * are stored as LZ4-compressed Arrow IPC — the encoding the scout server
 * sends — and run through the exact client chain: decodeArrowBytes →
 * expandResultsetRows → parseScanResultSummaries / parseScanResultData.
 *
 * When an old scan breaks in production, its dataframe joins this corpus.
 */
/// <reference types="node" />
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { ColumnTable } from "arquero";
import { describe, expect, it } from "vitest";

import { decodeArrowBytes, isRecord } from "@tsmono/util";

import { expandResultsetRows } from "./arrow";
import { parseScanResultData, parseScanResultSummaries } from "./arrowHelpers";

const fixturesDir = join(process.cwd(), "src/app/utils/fixtures");

const loadFixture = async (name: string): Promise<ColumnTable> =>
  expandResultsetRows(
    decodeArrowBytes(new Uint8Array(readFileSync(join(fixturesDir, name))))
  );

const filterToRow = (table: ColumnTable, identifier: string): ColumnTable =>
  (table.params({ targetIdentifier: identifier }) as ColumnTable).filter(
    (d: { identifier: string }, $: { targetIdentifier: string }) =>
      d.identifier === $.targetIdentifier
  );

const assertNormalizedEvents = (events: unknown[], context: string) => {
  for (const event of events) {
    expect(isRecord(event), context).toBe(true);
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
    }
  }
};

describe("normalization over the real legacy scan-dataframe corpus", () => {
  it.each([
    ["legacy-2025-11-resultset.arrows"],
    ["legacy-2025-11-object.arrows"],
  ])("%s summaries", async (name) => {
    const table = await loadFixture(name);
    expect(table.numRows()).toBeGreaterThan(0);

    const summaries = await parseScanResultSummaries(table.objects());
    expect(summaries.length).toBe(table.numRows());

    for (const summary of summaries) {
      const context = `${name} ${summary.identifier}`;

      // These scans predate the first-class transcript identity columns;
      // identity must be lifted out of transcript_metadata.
      expect(summary.transcriptModel, context).toBeTypeOf("string");
      expect(summary.transcriptTaskSet, context).toBeTypeOf("string");
      expect(summary.transcriptTaskId, context).toBeDefined();
      expect(summary.transcriptTaskRepeat, context).toBeTypeOf("number");

      // Record-shaped validation JSON strings parse to booleans (expanded
      // labeled rows) or all-boolean records (whole-row validation).
      const validation = summary.validationResult;
      if (validation !== undefined && typeof validation !== "boolean") {
        expect(isRecord(validation), context).toBe(true);
        for (const entry of Object.values(validation)) {
          expect(entry, context).toBeTypeOf("boolean");
        }
      }

      expect(Array.isArray(summary.eventReferences), context).toBe(true);
      expect(Array.isArray(summary.messageReferences), context).toBe(true);
    }
  });

  it("expands legacy resultset rows into per-result rows with per-label validation", async () => {
    const table = await loadFixture("legacy-2025-11-resultset.arrows");

    // Every source row carries a two-result resultset; expansion at least
    // doubles the row count (synthetic missing-label rows may add more).
    expect(table.numRows()).toBeGreaterThanOrEqual(8);

    const summaries = await parseScanResultSummaries(table.objects());
    const labeled = summaries.filter((s) => s.label !== undefined);
    expect(labeled.length).toBeGreaterThan(0);
    for (const summary of labeled) {
      // extractLabelValidation reduces the record to this row's own label;
      // the normalizer must surface it as a plain boolean.
      expect(summary.validationResult, summary.identifier).toBeTypeOf(
        "boolean"
      );
    }
  });

  it.each([
    ["legacy-2025-11-resultset.arrows"],
    ["legacy-2025-11-object.arrows"],
  ])("%s detail rows", async (name) => {
    const table = await loadFixture(name);
    const identifiers = table.array("identifier") as string[];

    for (const identifier of identifiers) {
      const context = `${name} ${identifier}`;
      const data = await parseScanResultData(filterToRow(table, identifier));

      expect(isRecord(data.metadata), context).toBe(true);
      expect(isRecord(data.scanMetadata), context).toBe(true);
      expect(isRecord(data.scannerParams), context).toBe(true);
      expect(isRecord(data.scanModelUsage), context).toBe(true);
      for (const usage of Object.values(data.scanModelUsage)) {
        expect(usage.input_tokens, context).toBeTypeOf("number");
        expect(usage.output_tokens, context).toBeTypeOf("number");
        expect(usage.total_tokens, context).toBeTypeOf("number");
      }
      expect(Array.isArray(data.scanTags), context).toBe(true);
      expect(Array.isArray(data.inputIds), context).toBe(true);
      expect(data.scanTotalTokens, context).toBeTypeOf("number");
      expect(data.transcriptId, context).toBeTypeOf("string");
      expect(data.transcriptSourceUri, context).toBeTypeOf("string");

      if (data.scanEvents !== undefined) {
        expect(data.scanEvents.length, context).toBeGreaterThan(0);
        assertNormalizedEvents(data.scanEvents, context);
      }
    }
  });

  // Note: real scan_events are written by the scanning process, which has
  // never predated the modern event schema (scout is younger than the
  // event fields the normalizer fills) — these fixtures' events are already
  // conformant, so this pins the parse wiring over real payloads; the fill
  // behavior itself is covered by normalizeScanRow.test.ts and the MSW
  // legacy-transcript integration test.
  it("parses model/tool scan_events from the object-valued scan", async () => {
    const table = await loadFixture("legacy-2025-11-object.arrows");
    const identifiers = table.array("identifier") as string[];

    const allEventTypes = new Set<string>();
    for (const identifier of identifiers) {
      const data = await parseScanResultData(filterToRow(table, identifier));
      for (const event of data.scanEvents ?? []) {
        allEventTypes.add(event.event);
      }
    }
    // The fixture must keep exercising the model/tool normalization paths;
    // if this fails the fixture was regenerated without them.
    expect(allEventTypes).toContain("model");
    expect(allEventTypes).toContain("tool");
  });
});
