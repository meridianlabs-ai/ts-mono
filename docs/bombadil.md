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

The default is two minutes per campaign: three Scout campaigns and one Inspect
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

## Branch relationship

`codex/bombadil-properties` is stacked on `codex/eval-data-integrity`, the branch
for [PR #728](https://github.com/meridianlabs-ai/ts-mono/pull/728). Its own diff
contains the optional harness, properties, and documentation. The three
application fixes and deterministic regressions belong to #728 and are not
reimplemented here. They remain active in the campaign baseline so exploration
can move past the already confirmed failures.

Review the testing-only changes with:

```sh
git diff codex/eval-data-integrity...codex/bombadil-properties
```

After #728 merges, rebase the testing commits onto main, dropping the three
fix commits if the PR was squash-merged. The original failure traces remain
in the local, ignored root `.bombadil-results/discoveries/` archive.

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
