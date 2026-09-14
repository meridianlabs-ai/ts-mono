# Sample Activity tab

The operational timeline for a single sample: stacked bands on one shared
wall-clock axis (working/waiting with stall brackets, marker rail, token
burn, context size with compaction drops, merged model+tool activity), with
a filterable virtualized history list beneath. Companion rename: the
log-level workspace tab with id `timeline` is now labeled **Activity**.

## Reaching it

- Deep link: `/#/logs/<enc(file)>/samples/sample/<enc(id)>/<epoch>/activity`
  (sample ids can contain `/` — encodeURIComponent them).
- Or open any sample and click the `Activity` tab (`getByRole("tab",
{ name: "Activity" })`), a peer of Transcript / Messages / Scoring.
- The tab is HIDDEN for logs whose events carry no timestamps (old logs)
  and for chunked samples — its absence on such logs is correct behavior.

## Fixture

The mocked e2e suite (`apps/inspect/e2e/sample-activity.spec.ts`) covers
the tab against synthetic events. For a real-density proof, generate an
agentic log with 50+ model turns and intermittent tool failures:

```sh
cd ~/Development/test_evals/agentic
inspect eval ascii_art_python.py@ascii_art_flaky \
  --model openai/gpt-4o-mini --log-dir ./logs-sample-activity
VERIFY_LOG_DIR=~/Development/test_evals/agentic/logs-sample-activity \
  pnpm exec playwright test --config .agents/skills/verify-log-viewer/playwright.verify.config.ts drive/sample-activity.spec.ts
```

`drive/sample-activity.spec.ts` skips itself when no `ascii-art` log is in
`VERIFY_LOG_DIR`. When the default fixture dir grows a suitable log, fold
an Activity test into the standing spec.

## Selectors

- Band chips, in order: `getByRole("button", { name: "Model & tool activity"
| "Context size" | "Token burn" | "Markers" | "Working / waiting" })` —
  default-on set is the first four; Working / waiting is opt-in.
- Band labels (SVG text, uppercase — use `exact: true` or the chip matches
  too): `WORKING / WAITING`, `TOKEN BURN`, `CONTEXT SIZE`,
  `MODEL & TOOL ACTIVITY`.
- Marker glyphs: `getByRole("button", { name: <marker label> })`, e.g.
  `Tool bash errored`.
- History filter pills: `getByRole("button", { name: /Errors \d/ })` etc.;
  search box `getByPlaceholder("filter by event or detail")`.
- History rows: `role=button`; each row with an event uuid carries an
  `open in transcript →` button.

## Observable proof

- Default bands render with a right-aligned mono headline
  (`<N> model turns · <M> tool calls[ · K rejected]`, `peak <N>k`,
  `<N>k total`); the opt-in working band reads `working <dur> · total <dur>`.
- Retry-attributable stalls show a red bracket labeled
  `<dur> · rate limit ×N` under the working band.
- Approvals: only non-approve decisions render (glyph ● + a row whose Kind
  pill is the decision word — rejected / escalated / terminated / modified);
  the filter pill reads `Rejections`; the By cell shows the approver name.
- Chips toggle bands on/off and persist across tab switches.
- Category pills filter the list additively; `All` resets; a glyph click
  widens filters so its row is always revealed.
- `open in transcript →` (and any span/glyph click-through) lands on
  `/transcript?event=<uuid>` with the transcript scrolled to the event.
- Dense logs (50+ turns): the merged model+tool band degrades to a
  per-pixel occupancy strip and the headline appends `per-pixel occupancy`.
