# loglist-tanstack-phase1 — merge punchlist

Single source of truth for what must happen before this branch merges. Consolidates the
TODOs / deferred / open items that were scattered across the 16 migration goal & plan docs.

The branch has executed a *sequence* of goals (reactive-refactor → fetch-engine →
subsystem-dirs → data-hook-contract → pending-samples → log-data surface/entity/imperative →
unified-fetch → loglistgrid-tanstack → resize). Most of that work has **landed**; the goal
docs' "Scope IN" / phasing sections describe completed work, not pending work. What remains is
a small set of human sign-offs and verification passes — plus doc hygiene so a reviewer isn't
misled by stale checkboxes.

Legend: `[ ]` open · `[~]` needs decision · refs are `file:line`. **The completed goal/plan docs now
live in `./archive/`** (moved there once their work landed). This punchlist stays active here in
`design/migration/`; the durable current-design ownership map now lives at
`apps/inspect/design/domain-ownership.md`.

---

## 1. Blockers — human decision / sign-off (cannot self-resolve)

- [x] **Charles: grid keyboard selection now writes `selectedSampleHandle`** (commit `318e2192`).
  Confirmed with Charles — the branch behavior is accepted as-is.
  — `log-data-imperative-goal.md:120-143`
- [x] **Charles: deleted `fullScreen` flag + log-history-sidebar CSS fossils** (commit `570fe436`).
  Confirmed with Charles — the deletion is good; no external CSS consumer.
  — `log-data-imperative-goal.md:166-181`
- [ ] Matt **Ctrl+F find band (Phase 5)** — **owner: Matt Brandly.** Required for merge (its absence
  is a real regression vs origin/main). Not optional; must land before the branch merges.
  — `loglistgrid-tanstack.md:69,200`
- [ ] Matt **Confirm log-list column order divergence vs main is intentional.** Branch: Model after
  Task, Sample Limits before Tokens; main: Model / Sample Limits at the end.
  — `loglistgrid-tanstack.md:223`
- [~] Eric **OK that `invalidateLogListing` survives until host-event normalization?** Accept-and-defer
  is the current stance; confirm.
  — `log-data-imperative-goal.md:259`

## 2. Blockers — verification (we run these; no new feature work)

- [ ] Eric **Replication still ensured across all paths vs main.** `ensureReplication` was deleted and
  `syncLogs` moved into `replicationControl.ts`. Confirm the replicator is (re)activated on
  dir-mode mount, on re-sync triggers (`useLogs`/`useClientEvents`), and on the VS Code
  `App.onMessage` background-update. Functional-regression risk; flagged in two docs.
  — `loglistgrid-tanstack.md:258`, `zustand-io-extraction.md:71`
- [ ] **Manual pass on single-file / VS-Code-embed / deep-link modes.** Dir mode is e2e-green;
  these paths are "preserved by construction" but untested.
  — `loglistgrid-tanstack.md:253`
- [ ] **Verify `#logview-state` is always present at startup in embedded mode** (static /
  view-server / VS Code) *before* deleting `PushedQuerySource`; otherwise defer the delete.
  — `reactive-refactor-goal.md:110`, `loglistgrid-tanstack.md:254`
- [ ] **Green gates:** `pnpm typecheck && lint && format:check && test` + `top-level-views`
  e2e — all clean. (The "Done when" acceptance set common to every goal doc.)
- [ ] Matt **Re-enable or delete the 3 `describe.skip`'d suites** in `apps/inspect/e2e/log-list-filters.spec.ts`
  (lines 202, 316, 344) — they were skipped pending the filter UI, which has since landed.
  — `loglistgrid-tanstack.md:136,152`
- [ ] Matt **Add the missing resize e2e** (resize-plan Task 6) + run the manual parity sweep (Task 7). Resize Tasks 1–4 landed (`4d861806`, `65c6ebe0`, per-scope persistence in `LogListGrid.tsx`); only the e2e + manual sweep are outstanding.
  — `loglist-resize-columns-plan.md:607-694`

## 3. Correctness smells — decide keep-vs-fix before merge

These were parked under "deliberately deferred," but each is a real defect, not a feature gap.
Confirm each is acceptable to ship, or fix.

- [~] Eric **`skipToken` for the logs-content query before `logDir` is known.** `state/logsContent.ts:24`
  runs/caches under an empty-string key before `logDir` hydrates.
  — `loglistgrid-tanstack.md:209`
- [X] OK to defer. **Details error channel unreachable.** Details cache is passive with no error source, so
  `useLogDetail`'s error branch never fires (absent ⇒ loading forever on a real fetch error).
  — `loglistgrid-tanstack.md:256`
- [~] Eric & Matt **Loading-state not derived from the query** (stale-flash guard). Explicitly accepted as a
  follow-up by `reactive-refactor-goal.md:46-47` (dormant loading UI is OK) — likely defer, but record the decision.
  — `loglistgrid-tanstack.md:255`

## 4. Verification / tuning — likely non-blocking, confirm

- [X] Multi-column sort mechanics vs main (plain-click on 2nd header); add e2e. — `loglistgrid-tanstack.md:210`
- [ ] Eric `kMaxFetchAttempts = 5`, per-tick Low re-enqueue, no time-based backoff — right numbers? — `log-data-unified-fetch-plan.md:434`
- [ ] Eric Attempts reset on restart (error text kept) — confirm intended. — `log-data-unified-fetch-plan.md:435`

## 5. Feature & parity work required for merge (reclassified from backlog 2026-07-06)

These were in the "out of scope" backlog; on review they must land in this PR. Feature/parity work,
not verification or decisions.

- [ ] Matt **Auto-fit-to-grid-width** + user-resize-override suppression (Phase 6's other half). origin/main had it via AG `autoSizeStrategy: fitGridWidth`; without it columns don't fill the width. — `loglistgrid-tanstack.md:71`
- [ ] Matt **Column pinning** (`type` icon col pinned-left) + **multi-line/preformatted cell tooltips**
  (model-roles, task-args JSON — was `PreformattedTooltip`, now degraded to native `title`). — `loglistgrid-tanstack.md:74,75`
- [ ] Matt **ARIA-label audit vs origin/main** (funnel `aria-label="Filter <columnId>"` substring-collides
  with header/segment names), **filter-code export** ("copy query"), **per-column filter clear +
  autocomplete** (autocomplete needs an inspect API for per-column distinct values). — `loglistgrid-tanstack.md:215,216,217`
- [ ] Eric **Move `log-list/listing/` engine dir → `shared/`** now both grids consume it, and clear the
  **residual AG type-only imports** (dormant `GridState` slice in `app/types.ts`/`logsSlice`/`state/hooks`,
  `ColDef` picker shims, `IRowNode` in `gridComparators`). — `loglistgrid-tanstack.md:192`
- [ ] Matt **Samples grid feature restoration** — rotated/compact score headers, colour scales, follow-output/
  auto-scroll, pinning/resize/reorder, grid-state persistence, Reset-Filters/filtered-count chrome,
  new-tab (Cmd/middle-click) row parity. **Check with Matt Brandly — likely has some of this done.** — `loglistgrid-tanstack.md:183-192,262`
- [ ] Eric **Fix cold-dir preview-tail pacing regression.** On a large cold dir, preview rows 26+ arrive at
  details pace — slower than pre-branch (where light previews had their own queue). Demote synced
  missing-details backfill below the preview tail, or High-wave all cold previews. — `loglistgrid-tanstack.md:242`
- [x] **eslint import-path / layering enforcement — DONE.** Satisfied by
  `barrelOnly(["app_config", "log_data"])` in `apps/inspect/eslint.config.mjs`. The "deferred eslint
  enforcement" notes in the goal docs are stale. — `loglistgrid-tanstack.md:95`, `reactive-refactor-goal.md:84`

---

## 6. Doc hygiene (part of the cleanup) — do before/at merge so reviewers aren't misled

The docs had drifted from the code. Done in this pass:

- [x] **Stale checkboxes.** Added a **Status** banner to `log-data-unified-fetch-plan.md`
  (COMPLETE — all tasks landed) and `loglist-resize-columns-plan.md` (Tasks 1–5 landed; Tasks 6–7
  outstanding, tracked in §2). Also updated `loglist-resize-columns-design.md`'s status from
  "ready for implementation" to "implemented." The unchecked `- [ ]` boxes are kept as historical
  execution scaffolding, now labeled as such. Verified against code (WorkQueue/fetchEngine present,
  `useLogDetailQuery` gone, resize `enableResizing:false` + `columnSizing` persistence in place).
- [x] **Prune evolution commentary.** Removed the `(Since landed …)` / `(Since superseded …)`
  parentheticals in `log-data-surface-goal.md` and `log-data-imperative-goal.md`; the bullets now
  state current design and point to `domain-ownership.md` + `log-data-unified-fetch-plan.md`.
- [x] **Reconcile `replication-startup-modes.md`.** Confirmed against code that
  `activateReplication`/`deactivateReplication`/`<ReplicationController>`/`<DirModeLoaderHost>`/
  `<SingleFileLoaderHost>`/`startReplication` **no longer exist**, while `ensureFetchEngine` does.
  Added a "partially superseded" banner flagging the stale loader-wiring sections, naming the
  current fetch-engine model, pointing to `domain-ownership.md`, and noting which sections remain
  accurate. Full rewrite of the wiring sections tracked as a §7 follow-up.
- [x] **Verify `domain-ownership.md` matches landed code.** It does — describes the current
  `ensureFetchEngine(logDir)` on-demand model ("No mount/cleanup bracket anywhere") in
  `log_data/replicationControl.ts`, and the `fetchEngine` singleton. It is the authoritative
  current-design reference. No edit needed.
- [x] **Deferred-items consolidation.** §7 below is the single consolidated backlog. Decision:
  do **not** gut the goal docs' "Scope OUT" sections — those are legitimate parts of each spec and
  the goal docs are historical records. If/when completed goal docs are archived, §7 is the
  durable home for their deferred items.

---

## 7. Explicitly out of scope → future backlog (NOT merge-blockers)

Confirmed later-PR on the 2026-07-06 walkthrough. Do not gate merge on these. (Ctrl+F / Phase 5 is
NOT here — required, owned by Matt Brandly; see §1. The now-required grid/parity items moved to §5.)

**Listing / grid future:**
- Server-side filter/sort + infinite scroll/pagination; delete the `log-list/listing/` evaluator.

**AG Grid removal:** migrate `ScoreAgGrid` (last `<AgGridReact>`), then drop
`ag-grid-community`/`ag-grid-react` + `agGrid.ts` registration.

**Data/architecture future** (all architecture/relocation with no user-facing behavior change):
- `?log_file=` vs `#/tasks/` URL-form divergence — agreed with Charles to address *after* this first PR (`log-data-imperative-goal.md:145-164`, commit `64ac24db`).
- Host-event normalization (retire `invalidateLogListing`; unify `backgroundUpdate` postMessage + `refresh-evals` poll).
- Details-read unification / `LogLoadController` "fetch settled" event (TODO at `state/selectedLogDetails.ts:30`).
- Dedicated samples table paged via `useInfiniteQuery` (server payload + schema split).
- Server `/log-headers` per-file result contract (python; client falls back to per-file reads meanwhile — TODO in `log-data-unified-fetch-plan.md:176-179`). *Later if ever — unlikely to change python types.*
- Sample-*detail* data (`samplePolling`, `runningEvents`, `selectedSample`, `useLoadSample`) as `AsyncData`.
- Moving `get_log_pending_samples` into the acquisition subsystem (narrows but keeps a Boundaries exception) — no behavior change, so later.
- `clientEventsService` polling; retiring `utils/polling.ts` — no behavior change, so later.
- Listing UI affordances for errored rows (fetch-state records errors; no badge/filter yet) — new feature, later.
- Scout reconciliation (user-owned); `EvalSample` acquisition/shape.

**Doc follow-ups:**
- Rewrite `replication-startup-modes.md`'s "The two loaders" + "The invariant" wiring sections to the current `ensureFetchEngine` fetch-engine model (currently banner-flagged as stale) — later if ever.

**Minor / parked** (none are regressions vs main):
- `WorkResult` → `@tsmono/util` if it wants it.
- `useLogFetchState` full-table scan per mount → fold into unified row.
- `log_fetch_state` row accretion from persisted settled-seq.
- Collection-identity churn workaround `useStableValue` at `grid/columns/hooks.tsx:110`.
- Where `urlLogSource` belongs; whether react-query is the sole upward medium (open design Qs).
- Next/prev sample arrows disabled on direct navigation to a sample — not a regression (main behaves the same); the nav list is never populated on that path (`loglistgrid-tanstack.md:211`).

---

## Suggested execution order

1. **Doc hygiene §6** — done (this pass): plan-doc status banners, pruned evolution notes,
   `replication-startup-modes.md` superseded banner, backlog consolidated here.
2. **Verification §2** (replication-ensured, embedded/deep-link manual pass, green gates,
   filters-spec un-skip, resize e2e) — these can surface real bugs, do them early.
3. **Feature/parity §5** — auto-fit, pinning+tooltips, ARIA/filter-code/filter-clear, `listing/`→`shared/`
   + AG-type-import cleanup, cold-dir pacing fix, eslint scope decision; **coordinate §5 samples-grid
   restoration with Matt Brandly** (overlaps his in-flight work + Ctrl+F).
4. **Decisions §1 + §3** — batch the two remaining Charles confirmations and the correctness-smell
   keep-vs-fix calls into one review conversation.
5. Merge once §1–§5 are resolved/green.
