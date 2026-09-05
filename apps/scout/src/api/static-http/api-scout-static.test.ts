// @vitest-environment jsdom
import { http, HttpResponse } from "msw";
import { beforeAll, describe, expect, it } from "vitest";

import { encodeBase64Url } from "@tsmono/util";

import { server } from "../../test/setup-msw";
import { setupZstdCompress } from "../../test/zstd";
import type { TranscriptInfo } from "../../types/api-types";

import { apiScoutStatic, StaticBundleError } from "./api-scout-static";
import type { BundleManifest } from "./bundle-format";

let compress: (data: unknown) => Uint8Array;

beforeAll(async () => {
  compress = await setupZstdCompress();
});

const baseUrl = "/bundle/api";

const manifest: BundleManifest = {
  format: "scout-static-bundle",
  version: 1,
  transcripts: {
    dir: "/transcripts",
    id_column: "transcript_id",
    row_count: 1,
    default_order: { column: "date", direction: "DESC" },
    shards: [
      {
        path: "transcripts/catalog/shard-0.json.zst",
        row_count: 1,
        min: "2026-01-01",
        max: "2026-01-01",
      },
    ],
  },
  scans: {
    dir: "/scans",
    id_column: "scan_id",
    row_count: 0,
    default_order: { column: "timestamp", direction: "DESC" },
    shards: [],
  },
};

const info: TranscriptInfo = {
  transcript_id: "t1",
  metadata: {},
  model: "gpt-4",
  date: "2026-01-01",
};

const useManifest = (m: BundleManifest) =>
  server.use(http.get(`${baseUrl}/manifest.json`, () => HttpResponse.json(m)));

describe("apiScoutStatic", () => {
  it("reports readOnly and workbench capability", () => {
    const api = apiScoutStatic({ bundleBaseUrl: baseUrl });
    expect(api.readOnly).toBe(true);
    expect(api.capability).toBe("workbench");
  });

  it("rejects manifests from a newer format version", async () => {
    useManifest({ ...manifest, version: 99 });
    const api = apiScoutStatic({ bundleBaseUrl: baseUrl });
    await expect(api.getTranscripts("/transcripts")).rejects.toThrow(
      /Unsupported bundle manifest/
    );
  });

  it("retries the manifest fetch after a transient failure", async () => {
    let attempts = 0;
    server.use(
      http.get(`${baseUrl}/manifest.json`, () => {
        attempts++;
        if (attempts === 1) {
          return HttpResponse.text("boom", { status: 500 });
        }
        return HttpResponse.json(manifest);
      }),
      http.get(`${baseUrl}/transcripts/catalog/shard-0.json.zst`, () =>
        HttpResponse.arrayBuffer(compress([info]).buffer as ArrayBuffer)
      )
    );
    const api = apiScoutStatic({ bundleBaseUrl: baseUrl });
    await expect(api.getTranscripts("/transcripts")).rejects.toThrow(/500/);
    // rejection must not be cached: the retry refetches the manifest
    const result = await api.getTranscripts("/transcripts");
    expect(result.total_count).toBe(1);
    expect(attempts).toBe(2);
  });

  it("lists transcripts from catalog shards", async () => {
    useManifest(manifest);
    server.use(
      http.get(`${baseUrl}/transcripts/catalog/shard-0.json.zst`, () =>
        HttpResponse.arrayBuffer(compress([info]).buffer as ArrayBuffer)
      )
    );
    const api = apiScoutStatic({ bundleBaseUrl: baseUrl });
    const result = await api.getTranscripts("/transcripts");
    expect(result.total_count).toBe(1);
    expect(result.items[0]).toMatchObject({ transcript_id: "t1" });
  });

  it("reads a transcript from its combined .json.zst item file", async () => {
    server.use(
      http.get(`${baseUrl}/transcripts/items/t1.json.zst`, () =>
        HttpResponse.arrayBuffer(
          compress({
            info,
            messages: [
              {
                role: "user",
                content: `attachment://${"a".repeat(32)}`,
              },
            ],
            events: [],
            timelines: [],
            attachments: { ["a".repeat(32)]: "hello" },
          }).buffer as ArrayBuffer
        )
      )
    );
    const api = apiScoutStatic({ bundleBaseUrl: baseUrl });
    const transcript = await api.getTranscript("/transcripts", "t1");
    expect(transcript.transcript_id).toBe("t1");
    expect(transcript.model).toBe("gpt-4");
    expect(transcript.messages[0]).toMatchObject({ content: "hello" });
  });

  it("sanitizes path separators in transcript item ids", async () => {
    server.use(
      http.get(`${baseUrl}/transcripts/items/a_b_c.json.zst`, () =>
        HttpResponse.arrayBuffer(
          compress({
            info: { ...info, transcript_id: "a/b\\c" },
            messages: [],
            events: [],
            timelines: [],
          }).buffer as ArrayBuffer
        )
      )
    );
    const api = apiScoutStatic({ bundleBaseUrl: baseUrl });
    const transcript = await api.getTranscript("/transcripts", "a/b\\c");
    expect(transcript.transcript_id).toBe("a/b\\c");
  });

  it("answers hasTranscript with a HEAD probe", async () => {
    server.use(
      http.head(`${baseUrl}/transcripts/items/t1.json.zst`, () =>
        HttpResponse.text("")
      ),
      http.head(`${baseUrl}/transcripts/items/nope.json.zst`, () =>
        HttpResponse.text("", { status: 404 })
      )
    );
    const api = apiScoutStatic({ bundleBaseUrl: baseUrl });
    await expect(api.hasTranscript("/transcripts", "t1")).resolves.toBe(true);
    await expect(api.hasTranscript("/transcripts", "nope")).resolves.toBe(
      false
    );
  });

  it("reads scan status from the base64url-encoded scan path", async () => {
    const scanPath = "scans/2026-01-01T00-00-00/scan.json";
    server.use(
      http.get(
        `${baseUrl}/scans/items/${encodeBase64Url(scanPath)}/status.json`,
        () => HttpResponse.json({ complete: true })
      )
    );
    const api = apiScoutStatic({ bundleBaseUrl: baseUrl });
    const status = await api.getScan("/scans", scanPath);
    expect(status).toMatchObject({ complete: true });
  });

  it("rejects mutations with StaticBundleError", async () => {
    const api = apiScoutStatic({ bundleBaseUrl: baseUrl });
    await expect(
      api.startScan({} as Parameters<typeof api.startScan>[0])
    ).rejects.toBeInstanceOf(StaticBundleError);
    await expect(
      api.updateProjectConfig(
        {} as Parameters<typeof api.updateProjectConfig>[0],
        null
      )
    ).rejects.toBeInstanceOf(StaticBundleError);
    await expect(api.deleteValidationSet("uri")).rejects.toBeInstanceOf(
      StaticBundleError
    );
  });

  it("emits one initial topic update to unblock app readiness", async () => {
    const api = apiScoutStatic({ bundleBaseUrl: baseUrl });
    const updates: unknown[] = [];
    api.connectTopicUpdates((topicVersions) => updates.push(topicVersions));
    expect(updates).toEqual([]);
    await Promise.resolve();
    expect(updates).toEqual([
      { "project-config": "static", scans: "static", transcripts: "static" },
    ]);
  });

  it("does not emit the initial topic update after unsubscribing", async () => {
    const api = apiScoutStatic({ bundleBaseUrl: baseUrl });
    const updates: unknown[] = [];
    const unsubscribe = api.connectTopicUpdates((topicVersions) =>
      updates.push(topicVersions)
    );
    unsubscribe();
    await Promise.resolve();
    expect(updates).toEqual([]);
  });

  it("serves empty search and validation listings", async () => {
    const api = apiScoutStatic({ bundleBaseUrl: baseUrl });
    await expect(api.getSearches("grep", 10)).resolves.toEqual({ items: [] });
    await expect(api.getValidationSets()).resolves.toEqual([]);
  });
});
