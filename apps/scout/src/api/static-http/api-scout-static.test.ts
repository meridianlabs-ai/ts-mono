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
          metadata: "{}",
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
      messages: [],
      events: [],
      timelines: [],
    });
    expect(duckdb.queryObjects.mock.calls[2]?.[0]).toContain(
      `SELECT "messages", "events" FROM`
    );
    expect(duckdb.queryObjects.mock.calls[2]?.[0]).not.toContain("events_data");
    expect(duckdb.queryObjects.mock.calls[2]?.[0]).not.toContain("timelines");
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
