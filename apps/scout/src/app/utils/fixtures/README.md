# Legacy scan-dataframe fixtures

Real inspect_scout 0.3.2.dev27 (2025-11-29) scan dataframes, shrunken and
sanitized (local paths rewritten, long prose truncated; column set, arrow
types, and JSON encodings preserved verbatim). Stored as LZ4_FRAME-compressed
Arrow IPC streams — the encoding `decodeArrowBytes` receives from the scout
server. Consumed by `scanCorpus.test.ts`.

Legacy traits these pin down:

- no first-class transcript identity columns (`transcript_task_set` /
  `transcript_task_id` / `transcript_task_repeat` / `transcript_model` /
  `transcript_date` / `transcript_score`…) — identity lives inside
  `transcript_metadata`
- no `scan_error_refusal` / `validation_predicate` / `validation_split`
  columns
- `validation_result` / `validation_target` as record-shaped JSON strings
  (per-validator booleans)
- `legacy-2025-11-resultset.arrows` — resultset-valued scanner (4 rows, two
  results each), exercising `expandResultsetRows` → per-label validation
  extraction
- `legacy-2025-11-object.arrows` — object-valued scanner (3 rows) with
  model/tool events in `scan_events`

When an old scan breaks in production, add its (sanitized) dataframe here
and extend the corpus test.
