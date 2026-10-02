# Browser property testing with Bombadil

[Bombadil](https://github.com/antithesishq/bombadil) explores action sequences
against the real React apps. These campaigns focus on evidence identity,
lossless exports, and untrusted transcript content. Playwright supplies Chromium
and the existing MSW fixtures; Bombadil attaches to that browser over CDP.
The application still runs through Vite and React Compiler.

## Run

From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm --filter scout exec playwright install chromium
pnpm e2e:bombadil
```

The default is two minutes per campaign: two Scout campaigns and one Inspect
campaign. Turbo runs the apps concurrently; each app uses one browser worker.
These exploratory runs are separate from deterministic `pnpm test` and `pnpm
e2e` gates. A property violation fails the command immediately.

Run one campaign, or give each campaign a longer budget (up to eight minutes):

```sh
pnpm --filter scout e2e:bombadil --grep 'transcript identity'
BOMBADIL_TIME=5m pnpm --filter @meridianlabs/log-viewer e2e:bombadil
```

The runner has a nine-minute process deadline and each Playwright test has a
ten-minute deadline. Scout uses HTTP port 5186 and debugger port 9333; Inspect
uses 5185 and 9334. Do not run two copies of the same app's campaign concurrently.

Results live under each app's ignored `.bombadil-results/` directory, including
`run.log`, `trace.jsonl`, and screenshots. **Copy a failure's entire `bombadil`
directory outside `.bombadil-results` before another run:** Playwright clears
the output directory at startup.

Replay the preserved action sequence with the same fixture:

```sh
BOMBADIL_REPRODUCE=/absolute/path/to/saved/bombadil \
  pnpm --filter scout e2e:bombadil --grep 'transcript identity'
```

Use the matching app and test name for other traces, and retain the exact
specification and fixture revision with a failure. The original identity
traces diverged when replayed after harness edits, with Bombadil reporting
that a recorded custom action could not be matched. Replay is a debugging aid;
browser scheduling and changes to available actions can prevent reproduction.
Reduce useful failures to deterministic behavioral tests before making them
a required CI gate.

Bombadil is pinned to 0.7.6, which met the workspace's dependency-age policy
when this was added. Its shipped declaration files refer to an unexported
`@antithesishq/bombadil/internal` types entry. The pnpm patch only exports that
existing declaration file; it changes no runtime behavior. Recheck whether
the patch is necessary when upgrading.

## Properties and scope

| Campaign | Exploration | Properties |
| --- | --- | --- |
| Scout transcript identity | Three transcripts of different lengths, two directories with overlapping IDs, delayed responses, tab changes, scrolling, history navigation | Rendered evidence matches the selected transcript and directory after navigation settles; no uncaught exceptions or error boundary |
| Scout dataframe integrity | Sorting, filters, column visibility, wrapping, grid mounting, clipboard export | Unique rendered row IDs, valid visible-row count, complete long explanations in CSV; no uncaught exceptions or error boundary |
| Inspect sample identity and hostile content | Two JSON logs with overlapping sample IDs and opposite scores, delayed loads, messages/events/scoring/metadata tabs, hostile HTML/Markdown/MathJax strings | Evidence matches the selected log/sample after navigation settles; no content execution marker, unsafe links, monitored external fetches, monitored log-message writes, or uncaught exceptions |

Identity checks tolerate up to three seconds of stale rendering during navigation
and cancel an expectation if navigation supersedes it. They compare evidence
that is visible; an empty or collapsed panel does not establish liveness.
The deadline exceeds the 1.4-second settle action so a correct render can be
observed in a new snapshot before a pending expectation expires.
The dataframe export check runs when the long row and explanation column are
visible. Ordinary deterministic tests also exercise those conditions directly.
Directory identity is checked only on explicit-directory detail routes: the
list route has no selected transcript directory to compare. A follow-up run
caught that omission in the initial oracle while a detail panel was closing;
it was a harness false positive, not a fourth application defect.

Custom actions navigate through public URLs or operate rendered controls; they
do not modify application stores. Click generators omit developer tools and
destructive editing controls. Network fixtures replace the backend and use
synthetic content. This covers the browser and shared client data layer, not
real server authorization, every transport, or the VS Code host. JavaScript
coverage instrumentation is disabled; action and property traces remain enabled.

## Findings from the first investigation

Investigated on 2026-09-28, starting at
`cff263a4f15fadb39e0042fbf412ba3539b07dcf`. All three findings were observed in a
browser campaign and independently reproduced with deterministic tests that
failed before the corresponding fix.

### Inspect: concurrent JSON-log loads can substitute another log's evidence

**High impact for evaluation integrity.** The browser trace showed a
`blue.json` breadcrumb while the task, transcript evidence, and score belonged
to `red.json` (score 0 rather than blue's 1). The `correctSample` property failed
after about 79 seconds.

`clientApi` shared one pending JSON-log promise across every filename. Requests
for different logs could receive the same contents when their loads overlapped.
The fix deduplicates pending requests by filename and removes each entry on
success or failure. The existing single-log settled cache stays bounded.

Regression coverage in `apps/inspect/src/client/api/client-api.test.ts` starts
overlapping detail and sample reads, controls both completion orders, verifies
same-file deduplication, and covers a failure in one log followed by a retry
without failing the other log. The finding concerns the JSON loading path;
it is not evidence of the same defect in `.eval` range reads.

### Scout: selected transcript directory differs from the data source

**High impact for evaluation integrity.** Navigating to the same transcript ID
in another directory retained evidence from the configured default directory.
The `correctDirectory` property failed after about 39 seconds. Without a
configured default directory, an explicit-directory link could fail to load.

Both the full transcript panel and focused event panel fetched from
`config.transcripts.dir`, although the route and breadcrumb used the resolved
directory. Both now fetch from `resolvedTranscriptsDir`; visit/reset identity
also includes the directory so reused transcript IDs do not share visit state.

Four browser regressions in `apps/scout/e2e/transcript.spec.ts` cover full and
focused-event views, with and without a configured directory. The configured
cases warm the primary transcript first, switch directories, and navigate back.

### Scout: CSV export silently truncates long explanations

**Evidence loss in exported results.** The export reused the grid's display
formatter, which center-truncates long strings to 1,024 characters. A 1,700
character explanation was shortened in both copied and downloaded CSV.
`losslessExport` failed on the first export, within a second.

CSV now serializes the full underlying value while cells retain display
truncation. The dataframe model regression checks both behaviors, and
`apps/scout/e2e/dataframe.spec.ts` parses copied CSV to check the full
explanation and verifies that the downloaded CSV matches it.

No new exploitable security issue was confirmed in the hostile-content
campaign. That is a bounded negative result for these fixtures and actions,
not a claim that the application is free of security defects.

### Deterministic validation

- `pnpm check`: all 36 tasks passed, including strict type checking and lint.
- `pnpm test`: the complete workspace unit/integration suite passed.
- Scout browser tests matching `dataframe.spec.ts` and `transcript.spec.ts`:
  24 passed, including the scanner dataframe integration test.
- Inspect `viewer-xss.spec.ts`, `transcript-baseline.spec.ts`, and
  `message-deeplink.spec.ts`: 6 passed.
- Post-fix Bombadil campaigns: each of the three campaigns completed a
  two-minute run without violations. The final two identity runs used the
  corrected route scope and three-second observation deadline described above.

The new deterministic regressions failed on the original implementations and
passed with the fixes. The exploratory traces are useful discovery evidence;
they are not substitutes for these regression gates.

## Extending the campaigns

Add properties around user-visible meaning: score-to-sample association,
filter/export agreement, or consistent evidence after cancellation and retry.
Vary network ordering and reuse IDs across sources deliberately; otherwise
identity bugs can remain invisible. Keep markers in synthetic fixture content
so the oracle is independent of application internals.

For every failure, preserve the trace, distinguish a harness error from a
product defect, and write the smallest deterministic regression at the layer
responsible. Keep a browser regression when the failure depends on routing,
rendering, clipboard behavior, or the compiled React build.
