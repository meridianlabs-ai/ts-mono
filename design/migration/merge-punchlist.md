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
- [x] Matt **Ctrl+F find band (Phase 5)** — landed (`4f57331d`).
  — `loglistgrid-tanstack.md:69,200`
- [ ] Matt **Confirm log-list column order divergence vs main is intentional.** Branch: Model after
  Task, Sample Limits before Tokens; main: Model / Sample Limits at the end.
  Meeting 2026-07-06: main's ordering is buggy (`indexOf` on `field` returns -1, so Model mis-sorts);
  the branch's `column.id` compare is an accidental but correct fix. Position divergence still to confirm.
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
- [x] Matt **Re-enable or delete the 3 `describe.skip`'d suites** in `apps/inspect/e2e/log-list-filters.spec.ts`
  — revived (`43d74b06`); no skips remain in the file.
  — `loglistgrid-tanstack.md:136,152`
- [ ] Eric **Live-eval polling: new eval showed up late / not at all** in the live test (manual refresh
  resolved it; poll interval may be too long). Re-test with a longer eval run and confirm new evals
  appear promptly.
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
- [ ] **Default column sizes: confirm they initialize to a sane set** (meeting 2026-07-06 said likely
  not). May be subsumed by the fit-to-grid-width work (`aed3575f`, `ec3eea0f`) — verify.

## 5. Feature & parity work required for merge (reclassified from backlog 2026-07-06)

These were in the "out of scope" backlog; on review they must land in this PR. Feature/parity work,
not verification or decisions.

- [x] Matt **Auto-fit-to-grid-width** + user-resize-override suppression (Phase 6's other half) —
  landed (`aed3575f`, `ec3eea0f` grow-only "roomy + scroll" + 65px `#` col, `ee852bc7`). — `loglistgrid-tanstack.md:71`
- [ ] Matt **Column pinning** (`type` icon col pinned-left). Samples-grid `#` col pin landed
  (`7cac3fbd`); log-list `type` col still open. — `loglistgrid-tanstack.md:74`
  (Preformatted-cell tooltips moved to §7 — meeting 2026-07-06 decided native `title` is OK for merge.)
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

### 5a. Parity findings from the 2026-07-06 meeting walkthrough

Styling decision from the walkthrough: **match main, don't improve** (sort icons, fonts, affordances).

- [x] **Tasks-view selection highlight lost on navigating away from a log** (users rely on it for
  keyboard nav between rows) — selection persisted across navigation (`b8b57a77`); samples grid
  focused on mount for keyboard nav (`361d034c`).
- [x] **Multi-line mode vertical alignment** — ID/status/score cells center- instead of top-aligned;
  fixed (`f1194e6f`).
- [x] **Ordinal multi-sort order badges** (1/2 next to sort arrows) missing vs main — restored
  (`485cd710`).
- [x] **Sort icons + header font size differ from main** — aligned (`533f7490`, `410d3ed0`).
- [x] **Double-click resize-handle auto-sizes column to content** (up to a max; Eric OK with
  measuring only the client-side render buffer) — landed (`1e315c37`).
- [ ] Eric **Infinite loading animation bug** — poll interval on the log poller syncs too frequently.
  Check whether `c645f6a0` (ActivityBar animates while the listing syncs) already covers it.
- [ ] **Leftmost icon column not sortable in folders view** — fix.
- [ ] **Filter UI: keep the branch's Scout-style explicit-apply UI; add AND/OR support** (decision:
  don't revert to main's apply-as-you-type). Apply should also dismiss the popover (today only
  click-away closes it).
- [ ] **Filter state not round-tripping through the filter UI** — half-done per meeting; finish.

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
- **Folder replication caching bug (both branches):** log file copied into the root first, then moved
  to a subfolder — the replicator caches it at the original location and never detects the move as a
  delta. Worth fixing, not a merge blocker (meeting 2026-07-06).
- **Styled-popover tooltips** for multi-line/preformatted cells (model-roles, task-args JSON — was
  `PreformattedTooltip` on main, now native `title`). Meeting 2026-07-06: native is OK for merge;
  restoration is a future upgrade. — `loglistgrid-tanstack.md:75`

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
- Tasks-view hover affordance lighter than main — accepted 2026-07-06 (leave it; match this same style for future affordances).

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
