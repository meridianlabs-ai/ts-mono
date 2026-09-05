// @vitest-environment jsdom
import { http, HttpResponse } from "msw";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { transcriptColumns as tc } from "../../query";
import { server } from "../../test/setup-msw";
import { setupZstdCompress } from "../../test/zstd";

import type { CatalogManifest } from "./bundle-format";
import { StaticCatalog } from "./catalog";

let compress: (data: unknown) => Uint8Array;

beforeAll(async () => {
  compress = await setupZstdCompress();
});

const baseUrl = "/bundle/api";

// Three shards globally sorted ascending by date (two rows each).
const shardRows = [
  [
    { transcript_id: "t1", date: "2026-01-01", model: "gpt-4" },
    { transcript_id: "t2", date: "2026-01-02", model: "claude-3" },
  ],
  [
    { transcript_id: "t3", date: "2026-01-03", model: "gpt-4" },
    { transcript_id: "t4", date: "2026-01-04", model: "claude-3" },
  ],
  [
    { transcript_id: "t5", date: "2026-01-05", model: "gpt-4" },
    { transcript_id: "t6", date: "2026-01-06", model: "gpt-4" },
  ],
];

const manifest: CatalogManifest = {
  dir: "/transcripts",
  id_column: "transcript_id",
  row_count: 6,
  default_order: { column: "date", direction: "DESC" },
  shards: shardRows.map((rows, i) => ({
    path: `transcripts/catalog/shard-${i}.json.zst`,
    row_count: rows.length,
    min: rows[0]!.date,
    max: rows[rows.length - 1]!.date,
  })),
  column_values: "transcripts/columns.json",
};

let shardFetches: number[];

beforeEach(() => {
  shardFetches = [0, 0, 0];
  server.use(
    ...shardRows.map((rows, i) =>
      http.get(`${baseUrl}/transcripts/catalog/shard-${i}.json.zst`, () => {
        shardFetches[i]!++;
        return HttpResponse.arrayBuffer(compress(rows).buffer as ArrayBuffer);
      })
    ),
    http.get(`${baseUrl}/transcripts/columns.json`, () =>
      HttpResponse.json({ model: ["claude-3", "gpt-4"] })
    )
  );
});

describe("StaticCatalog shard-skip fast path", () => {
  it("serves the first default-order page from the newest shard only", async () => {
    const catalog = new StaticCatalog(baseUrl, manifest);
    const result = await catalog.query(
      undefined,
      { column: "date", direction: "DESC" },
      { limit: 2, direction: "forward" }
    );

    expect(result.items.map((r) => r["transcript_id"])).toEqual(["t6", "t5"]);
    expect(result.total_count).toBe(6);
    expect(result.next_cursor).toEqual({
      date: "2026-01-05",
      transcript_id: "t5",
    });
    expect(shardFetches).toEqual([0, 0, 1]);
  });

  it("serves cursor pages, skipping shards past the cursor", async () => {
    const catalog = new StaticCatalog(baseUrl, manifest);
    const page2 = await catalog.query(
      undefined,
      { column: "date", direction: "DESC" },
      {
        limit: 2,
        direction: "forward",
        cursor: { date: "2026-01-05", transcript_id: "t5" },
      }
    );

    expect(page2.items.map((r) => r["transcript_id"])).toEqual(["t4", "t3"]);
    // shard-2's min ties with the cursor value, so it must be checked for
    // id-tiebreak rows; shard-0 is never touched.
    expect(shardFetches).toEqual([0, 1, 1]);
  });

  it("spans shards when a page straddles a boundary", async () => {
    const catalog = new StaticCatalog(baseUrl, manifest);
    const result = await catalog.query(
      undefined,
      { column: "date", direction: "DESC" },
      { limit: 3, direction: "forward" }
    );

    expect(result.items.map((r) => r["transcript_id"])).toEqual([
      "t6",
      "t5",
      "t4",
    ]);
    expect(shardFetches).toEqual([0, 1, 1]);
  });

  it("serves ascending pages from the oldest shard", async () => {
    const catalog = new StaticCatalog(baseUrl, manifest);
    const result = await catalog.query(
      undefined,
      { column: "date", direction: "ASC" },
      { limit: 2, direction: "forward" }
    );

    expect(result.items.map((r) => r["transcript_id"])).toEqual(["t1", "t2"]);
    expect(shardFetches).toEqual([1, 0, 0]);
  });

  it("keeps loading through boundary ties", async () => {
    const tiedRows = [
      [
        { transcript_id: "a", date: "2026-01-01" },
        { transcript_id: "d", date: "2026-01-02" },
      ],
      [
        { transcript_id: "b", date: "2026-01-02" },
        { transcript_id: "c", date: "2026-01-02" },
      ],
    ];
    const tiedManifest: CatalogManifest = {
      ...manifest,
      row_count: 4,
      shards: tiedRows.map((rows, i) => ({
        path: `tied/shard-${i}.json.zst`,
        row_count: rows.length,
        min: rows[0]!.date,
        max: rows[rows.length - 1]!.date,
      })),
    };
    server.use(
      ...tiedRows.map((rows, i) =>
        http.get(`${baseUrl}/tied/shard-${i}.json.zst`, () =>
          HttpResponse.arrayBuffer(compress(rows).buffer as ArrayBuffer)
        )
      )
    );

    const catalog = new StaticCatalog(baseUrl, tiedManifest);
    const result = await catalog.query(
      undefined,
      { column: "date", direction: "ASC" },
      { limit: 2, direction: "forward" }
    );

    // The id tiebreak on 2026-01-02 pulls "b" from the second shard ahead
    // of "d" from the first; stopping at shard 0 would return ["a", "d"].
    expect(result.items.map((r) => r["transcript_id"])).toEqual(["a", "b"]);
  });
});

describe("StaticCatalog full-load path", () => {
  it("filters across all shards with correct total_count", async () => {
    const catalog = new StaticCatalog(baseUrl, manifest);
    const result = await catalog.query(
      tc.model.eq("gpt-4"),
      { column: "date", direction: "DESC" },
      { limit: 2, direction: "forward" }
    );

    expect(result.items.map((r) => r["transcript_id"])).toEqual(["t6", "t5"]);
    expect(result.total_count).toBe(4);
    expect(result.next_cursor).toEqual({
      date: "2026-01-05",
      transcript_id: "t5",
    });
    expect(shardFetches).toEqual([1, 1, 1]);
  });

  it("caches shards across queries", async () => {
    const catalog = new StaticCatalog(baseUrl, manifest);
    await catalog.query(tc.model.eq("gpt-4"), undefined, undefined);
    await catalog.query(tc.model.eq("claude-3"), undefined, undefined);
    expect(shardFetches).toEqual([1, 1, 1]);
  });

  it("sorts by non-default columns via full load", async () => {
    const catalog = new StaticCatalog(baseUrl, manifest);
    const result = await catalog.query(
      undefined,
      [
        { column: "model", direction: "ASC" },
        { column: "date", direction: "ASC" },
      ],
      { limit: 3, direction: "forward" }
    );
    expect(result.items.map((r) => r["transcript_id"])).toEqual([
      "t2",
      "t4",
      "t1",
    ]);
  });
});

describe("StaticCatalog failure recovery", () => {
  it("retries shard fetches after a transient failure", async () => {
    let attempts = 0;
    const flakyManifest: CatalogManifest = {
      ...manifest,
      row_count: 2,
      shards: [
        {
          path: "flaky/shard-0.json.zst",
          row_count: 2,
          min: "2026-01-01",
          max: "2026-01-02",
        },
      ],
    };
    server.use(
      http.get(`${baseUrl}/flaky/shard-0.json.zst`, () => {
        attempts++;
        if (attempts === 1) {
          return HttpResponse.arrayBuffer(new ArrayBuffer(0), { status: 500 });
        }
        return HttpResponse.arrayBuffer(
          compress(shardRows[0]).buffer as ArrayBuffer
        );
      })
    );

    const catalog = new StaticCatalog(baseUrl, flakyManifest);
    const query = () =>
      catalog.query(undefined, undefined, { limit: 10, direction: "forward" });

    await expect(query()).rejects.toThrow(/500/);
    // rejection must not be cached: the retry gets a fresh fetch
    const result = await query();
    expect(result.items.map((r) => r["transcript_id"])).toEqual(["t1", "t2"]);
    expect(attempts).toBe(2);
  });
});

describe("StaticCatalog distinct", () => {
  it("serves unfiltered distincts from the precomputed file", async () => {
    const catalog = new StaticCatalog(baseUrl, manifest);
    const values = await catalog.distinct("model", undefined);
    expect(values).toEqual(["claude-3", "gpt-4"]);
    expect(shardFetches).toEqual([0, 0, 0]);
  });

  it("computes filtered distincts from shard rows", async () => {
    const catalog = new StaticCatalog(baseUrl, manifest);
    const values = await catalog.distinct("model", tc.date.gte("2026-01-05"));
    expect(values).toEqual(["gpt-4"]);
  });
});
