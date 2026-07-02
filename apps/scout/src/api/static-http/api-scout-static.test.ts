import { beforeEach, describe, expect, it, vi } from "vitest";

import { apiScoutStatic } from "./api-scout-static";
import type { SqlParam } from "./condition-sql";

type QueryObjects = (sql: string, params?: SqlParam[]) => Promise<object[]>;
type QueryArrowIpc = (sql: string, params?: SqlParam[]) => Promise<Uint8Array>;

const duckdb = vi.hoisted(() => ({
  queryObjects: vi.fn<QueryObjects>(),
  queryArrowIpc: vi.fn<QueryArrowIpc>(),
}));

vi.mock("./duckdb-engine", () => ({
  StaticDuckDB: class {
    queryObjects = duckdb.queryObjects;
    queryArrowIpc = duckdb.queryArrowIpc;
  },
  absoluteUrl: (url: string) => url,
}));

describe("apiScoutStatic", () => {
  beforeEach(() => {
    duckdb.queryObjects.mockReset();
    duckdb.queryArrowIpc.mockReset();
    duckdb.queryArrowIpc.mockResolvedValue(new Uint8Array([1, 2, 3]));
  });

  it("omits missing optional transcript content columns", async () => {
    duckdb.queryObjects
      .mockResolvedValueOnce([
        {
          row_json: JSON.stringify({ transcript_id: "t1" }),
          content_file: "transcripts/content.parquet",
        },
      ])
      .mockResolvedValueOnce([
        { column_name: "transcript_id" },
        { column_name: "messages" },
        { column_name: "events" },
      ])
      .mockResolvedValueOnce([{ messages: "[]", events: "[]" }]);

    const api = apiScoutStatic({ bundleBaseUrl: "/bundle/api" });
    const transcript = await api.getTranscript("ignored", "t1");

    expect(transcript).toMatchObject({
      transcript_id: "t1",
      metadata: {},
      messages: [],
      events: [],
      timelines: [],
    });
    expect(duckdb.queryObjects.mock.calls[0]?.[0]).toContain(
      `SELECT row_json, content_file FROM`
    );
    expect(duckdb.queryObjects.mock.calls[0]?.[0]).not.toContain("metadata");
    expect(duckdb.queryObjects.mock.calls[2]?.[0]).toContain(
      `SELECT "messages", "events" FROM`
    );
    expect(duckdb.queryObjects.mock.calls[2]?.[0]).not.toContain("events_data");
    expect(duckdb.queryObjects.mock.calls[2]?.[0]).not.toContain("timelines");
  });

  it("reconstructs transcript metadata from content parquet columns", async () => {
    duckdb.queryObjects
      .mockResolvedValueOnce([
        {
          row_json: JSON.stringify({
            transcript_id: "t1",
            metadata: {},
            model: "row-model",
          }),
          content_file: "transcripts/content.parquet",
        },
      ])
      .mockResolvedValueOnce([
        { column_name: "transcript_id" },
        { column_name: "messages" },
        { column_name: "events" },
        { column_name: "events_data" },
        { column_name: "timelines" },
        { column_name: "model" },
        { column_name: "filename" },
        { column_name: "epoch" },
        { column_name: "sample_metadata" },
        { column_name: "score_report" },
        { column_name: "plain_text" },
        { column_name: "broken_json" },
        { column_name: "empty_value" },
      ])
      .mockResolvedValueOnce([
        {
          messages: "[]",
          events: "[]",
          events_data: null,
          timelines: "[]",
          epoch: 2,
          sample_metadata: JSON.stringify({ patch: "diff --git" }),
          score_report: JSON.stringify(["PASS", "FAIL"]),
          plain_text: "not json",
          broken_json: "{not-json",
          empty_value: null,
        },
      ]);

    const api = apiScoutStatic({ bundleBaseUrl: "/bundle/api" });
    const transcript = await api.getTranscript("ignored", "t1");

    expect(transcript.metadata).toEqual({
      epoch: 2,
      sample_metadata: { patch: "diff --git" },
      score_report: ["PASS", "FAIL"],
      plain_text: "not json",
      broken_json: "{not-json",
    });
    expect(duckdb.queryObjects.mock.calls[2]?.[0]).toBe(
      `SELECT "messages", "events", "events_data", "timelines", "epoch", "sample_metadata", "score_report", "plain_text", "broken_json", "empty_value" FROM read_parquet('/bundle/api/transcripts/content.parquet') WHERE "transcript_id" = ? LIMIT 1`
    );
    expect(duckdb.queryObjects.mock.calls[2]?.[0]).not.toContain(`"model"`);
    expect(duckdb.queryObjects.mock.calls[2]?.[0]).not.toContain(`"filename"`);
  });

  it("ignores scanner excludes for columns absent from older parquet files", async () => {
    duckdb.queryObjects
      .mockResolvedValueOnce([
        {
          bundle_id: "scan-1",
          status_path: "scans/scan-1/status.json",
          scanner_paths_json: JSON.stringify({
            toxicity: "scans/scan-1/toxicity.parquet",
          }),
        },
      ])
      .mockResolvedValueOnce([
        { column_name: "uuid" },
        { column_name: "input" },
        { column_name: "value" },
      ]);

    const api = apiScoutStatic({ bundleBaseUrl: "/bundle/api" });
    await api.getScannerDataframe("ignored", "scan-1", "toxicity", [
      "input",
      "scan_events",
    ]);

    expect(duckdb.queryArrowIpc.mock.calls[0]?.[0]).toBe(
      `SELECT * EXCLUDE ("input") FROM read_parquet('/bundle/api/scans/scan-1/toxicity.parquet')`
    );
  });
});
