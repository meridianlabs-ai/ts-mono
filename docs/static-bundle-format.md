# Scout Static Bundle Format (v1)

`scout view bundle` (inspect_scout, Python) produces a directory of static
files that the scout viewer (apps/scout, this repo) can serve read-only from
any static HTTP host — no backend, no wasm. This document is the contract
between the two sides. The TypeScript types in
`apps/scout/src/api/static-http/bundle-format.ts` mirror the manifest schema;
change them in lockstep.

## Design summary

- **Everything is JSON**, compressed with **zstd** where payloads are large
  (`.json.zst` extension, standard zstd frames). The viewer decompresses
  in-app with pure-JS `fzstd`, so no reliance on `Content-Encoding`
  negotiation, which static hosts handle inconsistently.
- **Catalogs are sharded.** Listing metadata (never messages/events) is split
  into shard files of a few thousand rows. The manifest records per-shard
  min/max of the default sort column so the viewer can serve default-order
  pages by fetching only the shards a page needs; the first arbitrary
  filter/sort triggers a one-time parallel load of all shards, cached in
  memory thereafter. Target scale: ~100k transcripts.
- **Detail reads are O(1).** Each transcript (and scan detail) lives in its
  own file addressed purely by id, so deep links never read a catalog.
- **Scanner dataframes stay Arrow IPC** — the viewer already decodes Arrow
  with pure-JS flechette/arquero, and columnar beats JSON for wide scan
  results.

## Directory layout

```
bundle/
  index.html                 # built viewer; must embed the scout_context tag
  assets/…                   # viewer js/css
  api/
    manifest.json            # entry point (uncompressed)
    config.json              # AppConfig (uncompressed)
    scanners.json            # ScannersResponse; optional
    project-config.json      # ProjectConfig (no etag semantics); optional
    transcripts/
      catalog/
        shard-0000.json.zst  # TranscriptInfo[] — listing columns only
        shard-0001.json.zst
        …
      columns.json           # precomputed distinct values; optional
      items/
        <safe-id>.json.zst   # combined info + content per transcript
    scans/
      catalog/
        shard-0000.json.zst  # ScanRow[]
        …
      columns.json
      items/
        <b64url(scan-path)>/
          status.json                  # Status (uncompressed)
          scanners/<scanner>.arrow     # Arrow IPC dataframe
          details/<scanner>/<uuid>.json.zst
```

All paths inside `manifest.json` are relative to the `api/` directory. The
viewer defaults to `./api` as the base URL, overridable via the
`scout_context` boot tag.

## Boot detection

`index.html` must contain an inline JSON5 script tag; its presence (with
`bundle: true`) switches the viewer into static mode:

```html
<script id="scout_context" type="application/json">
  { "bundle": true, "bundleBaseUrl": "./api" }
</script>
```

## manifest.json

```jsonc
{
  "format": "scout-static-bundle",
  "version": 1,
  "generated_at": "2026-08-03T12:00:00Z", // optional, informational
  "transcripts": { /* CatalogManifest */ },
  "scans": { /* CatalogManifest */ }
}
```

The viewer rejects manifests whose `format` differs or whose `version` is
greater than it supports. Additive changes (new optional fields) do not bump
the version; layout-breaking changes do.

### CatalogManifest

```jsonc
{
  "dir": "s3://bucket/transcripts",   // original dir URI (display only)
  "id_column": "transcript_id",       // "scan_id" for the scans catalog
  "row_count": 100000,
  "default_order": { "column": "date", "direction": "DESC" },
  "shards": [
    {
      "path": "transcripts/catalog/shard-0000.json.zst",
      "row_count": 5000,
      "min": "2026-01-01T00:00:00Z",  // min/max of default_order.column
      "max": "2026-01-14T09:30:00Z"
    }
    // …
  ],
  "column_values": "transcripts/columns.json" // optional
}
```

**Shard invariants the bundler MUST uphold:**

1. Rows are **globally sorted ascending** by `default_order.column` across
   the shard sequence (nulls first). Equal values may span shard boundaries;
   the viewer handles boundary ties via the `id_column` tiebreak.
2. `min`/`max` are the shard's actual bounds for that column (`null` if the
   shard holds only nulls for it).
3. `row_count` sums to the catalog's `row_count`.

Recommended shard size: 2,000–5,000 rows (a few hundred KB compressed).
`default_order` should match the viewer's default listing sort
(`date DESC` for transcripts).

Shard content is a JSON array of row objects — `TranscriptInfo` /
`ScanRow` shapes from the server OpenAPI schema, **excluding** content
columns (`messages`, `events`, `events_data`, `timelines`, `attachments`).
Custom metadata stays nested under the row's `metadata` key; the viewer's
filter evaluator resolves unknown filter columns through `metadata`
automatically.

### columns.json

Optional map of column name → sorted distinct values, used for filter
autocomplete without a catalog load:

```json
{ "model": ["claude-3", "gpt-4"], "task_set": ["swe-bench"] }
```

Only include columns whose distinct sets are reasonably small (say ≤1,000
values); omit the file or a column to make the viewer compute distincts from
shards instead.

## Transcript items

`transcripts/items/<safe-id>.json.zst` where `<safe-id>` is the
`transcript_id` with `/` and `\` replaced by `_` (ids are expected to be
UUID-like; the bundler must fail on collisions). Content is the server's
`MessagesEventsResponse` plus the row's `TranscriptInfo` under `info`:

```jsonc
{
  "info": { "transcript_id": "…", "date": "…", /* TranscriptInfo */ },
  "messages": [ /* … */ ],
  "events": [ /* … */ ],
  "events_data": null,      // optional condensed events, as served live
  "timelines": [ /* … */ ],
  "attachments": { "<32-hex-id>": "…" } // optional, resolved client-side
}
```

The viewer also issues `HEAD` requests against item files to answer
"does this transcript exist" without a catalog read.

## Scan items

Directory name is the **base64url (unpadded) encoding of the scan path**
string the catalog rows reference — the same encoding the live server uses in
URLs (`encodeBase64Url`).

- `status.json` — the scan `Status` object.
- `scanners/<scanner>.arrow` — Arrow IPC stream for
  `getScannerDataframe` (LZ4-compressed IPC is fine; the viewer registers an
  LZ4 codec). `<scanner>` is percent-encoded by the viewer when requested;
  bundlers should keep scanner names filesystem-safe.
- `details/<scanner>/<uuid>.json.zst` — one file per result row:

```jsonc
{
  "input": /* ScannerInput.input */,
  "input_type": "transcript",
  "input_data": null,       // optional condensed input events
  "scan_events": [ /* Event[] */ ]
}
```

## Top-level files

- `config.json` — the `AppConfig` the live server would return from
  `/app-config`, with `transcripts`/`scans` pointing at the bundled dirs.
- `scanners.json` — `ScannersResponse`; optional (viewer falls back to
  `{ "items": [] }`).
- `project-config.json` — `ProjectConfig`; optional. Editing is disabled in
  static mode regardless.

## What static mode does NOT include

No search, no validation sets, no scan launching, no filter-to-code
generation, no live topic updates — the viewer hides these surfaces when it
boots from a bundle (`api.readOnly === true`). Bundlers need not emit any
files for them. `downloadScan` (zip archive) is also unavailable.

## Hosting requirements

Plain static file serving with `GET` and `HEAD`. No range requests, no
custom headers, no `Content-Encoding` configuration. Files are fetched with
same-origin relative URLs, so no CORS setup is needed when the bundle is
served as one tree.
