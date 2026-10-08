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

The default is two minutes per campaign: five Scout campaigns and one Inspect
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
`run.log`, `trace.jsonl`, screenshots, and copies of the specification and
campaign source used for the run. **Copy a failure's entire `bombadil`
directory outside that app's `.bombadil-results` before another run:**
Playwright clears the output directory at startup.

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
| Scout dataframe integrity (6 and 500 rows) | Sorting, numeric filters, column visibility, wrapping, grid mounting, scrolling, clipboard export, click and Enter activation | Unique rows; filter counts agree with the fixture; CSV row count/order, chosen columns, and complete values agree with the grid and original fixture; activating a displayed row opens its own result |
| Scout filter transactions | Numeric/range/blank filters, AND/OR conditions, a second text column, ascending/descending sorts, abandoned drafts, grid remounts | Exact exported transcript IDs match an independent fixture model; numeric ordering is correct; cancelling a draft and remounting preserve the CSV |
| Scout transcript recovery | Twelve IDs reused across two directories, full and focused-event routes, delayed responses, one 503 per directory/ID on alternating info/content endpoints, rapid navigation and history | A selected route eventually renders its own evidence after retries; evidence cannot belong to another directory or transcript |
| Inspect sample identity and hostile content | Two JSON logs with overlapping sample IDs across two epochs and opposite scores, delayed loads, messages/events/scoring/metadata tabs, hostile HTML/Markdown/MathJax strings | Evidence matches the selected log/sample/epoch after navigation settles; no content execution marker, unsafe links, monitored external fetches, monitored log-message writes, or uncaught exceptions |

Identity checks tolerate up to three seconds of stale rendering during navigation
and cancel an expectation if navigation supersedes it. They compare evidence
that is visible; an empty or collapsed panel does not establish liveness.
The deadline exceeds the 1.4-second settle action so a correct render can be
observed in a new snapshot before a pending expectation expires.
Dataframe checks operate on the rendered controls and clipboard. CSV is parsed
independently of the application serializer, including embedded quotes and
newlines. Every exported cell is checked against the synthetic fixture, and
rendered row ordinals must point to the same transcript in the export. Numeric
filter actions set the real filter controls and compare the footer with an
independent count. Activation checks use both row buttons and Enter. Each
campaign requires at least one completed export, filter, and activation check;
recovery actions remount the grid and clear filters to keep exploration active.
Scout campaigns explicitly scroll nested panels to the top, middle, and bottom;
the 500-row campaign also requires at least one completed panel scroll. Initial
traces contained no default scroll actions because the document itself did not
overflow, so relying on that generator alone missed virtualized rows further
down the grid.
Directory identity is checked only on explicit-directory detail routes: the
list route has no selected transcript directory to compare. A follow-up run
caught that omission in the initial oracle while a detail panel was closing;
it was a harness false positive, not a fourth application defect.

Filter transactions check exact row membership, not just counts, so a filter
cannot silently substitute one matching-sized set for another. Range endpoints
are exclusive, matching the grid's existing contract. Cancel and remount checks
compare the complete CSV before and after the operation. These checks use only
rendered controls and clipboard data, not the application filter implementation.

Recovery uses a six-second temporal deadline and cancels the expectation when
navigation supersedes the selected route. Short settling actions allow retries
to complete and record successful renders. Each run must inject and recover from
multiple failures and observe a successful render; the network and UI counts
are attached to the Playwright result. Its fixture source is saved explicitly
beside the trace. The initial recovery oracle incorrectly kept waiting for a
superseded route inside a navigation action; that harness false positive was
replaced with a temporal property.

Custom actions navigate through public URLs or operate rendered controls; they
do not modify application stores. Click generators omit developer tools and
destructive editing controls. Network fixtures replace the backend and use
synthetic content. This covers the browser and shared client data layer, not
real server authorization, every transport, or the VS Code host. JavaScript
coverage instrumentation is disabled; action and property traces remain enabled.

## Branch relationship

`codex/bombadil-properties` is based directly on main as of 2026-10-07
(`c9cfb1d5`). [PR #728](https://github.com/meridianlabs-ai/ts-mono/pull/728)
has merged, so its three application fixes and deterministic regressions come
from main. Only the Bombadil commits were replayed during the rebase.

Review the testing-only changes with:

```sh
git diff origin/main...codex/bombadil-properties
```

The original failure traces remain in the local, ignored root
`.bombadil-results/discoveries/` archive.

## Investigation record

The first investigation on 2026-09-28 found cross-file JSON request mixing in
Inspect, wrong-directory transcript loading in Scout, and truncated CSV values.
Each finding was reduced to a deterministic regression in #728. The CSV issue
predated the TanStack migration: that migration preserved the display formatter
in exports and explicitly tested the truncation behavior.

On 2026-10-02, the campaigns were extended with export/grid agreement,
independent numeric-filter expectations, row-activation identity, 500-row
virtualization, and cross-epoch sample identity. The original one-off findings
are tracked in the fixes PR; new failures should get their own deterministic
reproduction and be triaged separately from harness assumptions.

The first expanded grid runs reported incorrect numeric-filter counts. A
deterministic browser reproduction traced this to the custom action: a DOM
`click()` omitted the outside `mousedown` that dismisses another column's
popover, and a global selector edited that other column instead. Normal
interaction returned the expected rows. The action now dismisses the previous
editor and scopes controls to the numeric column; this was a harness error.

All four three-minute campaigns then passed: transcript identity, sample
identity/hostile content, and both grid sizes. The successful grid runs
completed 242 export comparisons, 203 row activations, and 168 numeric-filter
checks. This round found no additional confirmed application defect.
`pnpm check` passed, and `pnpm test` passed 5,715 tests with two skipped.

A longer follow-up on the same date ran all four campaigns for eight minutes
each, plus a second eight-minute Scout transcript run after adding explicit
nested-panel scrolling. All five runs passed across 7,612 observed states.
Inspect rendered all 32 log/sample/epoch combinations; the 500-row grid rendered
every row during exploration. The grid runs completed 565 export comparisons,
555 row activations, and 365 numeric-filter checks. The scrolling campaigns
completed 172 panel scrolls. No additional application defect was confirmed;
the actionable finding was the missing nested-scroll coverage. Traces, source
snapshots, logs, and a machine-readable summary are preserved locally under
`.bombadil-results/discoveries/long-campaigns-20261002/`.

After rebasing onto main on 2026-10-07, all six campaigns passed with a
three-minute budget each, followed by an additional eight-minute Inspect run:
26 aggregate minutes and 3,764 observed states. The new filter campaign
completed 168 exact-result checks, including 32 cancelled drafts and 31 grid
remounts. It exercised all nine operators, all six transaction modes, and both
sort directions. The recovery campaign injected 22 transient failures, observed
21 endpoints recover, and recorded 101 successful settled renders across 20 of
the 24 directory/ID combinations.

The grid campaigns completed 216 export comparisons, 230 row activations, and
144 numeric-filter checks. Grid and transcript campaigns completed 81 nested
panel scrolls; 493 of the 500 virtualized rows appeared in captured states.
All six Scout transcript/directory combinations and all 32 Inspect
log/sample/epoch combinations rendered. No new data-integrity or security
defect was confirmed. `pnpm check` passed, and `pnpm test` passed 5,760 tests
with two skipped. Traces, source snapshots, logs, and `summary.json` are saved
locally under
`.bombadil-results/discoveries/new-properties-20261007/extended-campaigns/`.

The 2026-10-07 run also logged React's `flushSync` lifecycle warning when opening
popovers. A captured browser stack leads from `PopOver.tsx`'s layout-effect
`forceUpdate()` call into `react-popper`. That call dates to `16a17f46`; the same
warning already appears in the deterministic `ThemeToggle.test.tsx` and
`SearchPanel.test.tsx` runs. No incorrect evidence or crash accompanied it in
this exploration. The stack is preserved as `popover-warning.json` in the local
archive; it is a follow-up lead, not a new confirmed data-integrity finding.

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
