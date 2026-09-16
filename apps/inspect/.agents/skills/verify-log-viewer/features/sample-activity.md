# Sample Activity tab

The operational timeline for a single sample: stacked bands on one shared
wall-clock axis (working time with waiting gaps and stall brackets, marker rail, token
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
| "Context size" | "Token burn" | "Markers" | "Working time" })` —
  default-on set is the first four; Working time is opt-in.
- Band labels (SVG text, uppercase — use `exact: true` or the chip matches
  too): `WORKING TIME`, `TOKEN BURN`, `CONTEXT SIZE`,
  `MODEL & TOOL ACTIVITY`.
- Axis toggle (right end of the chip row; the shared `SegmentedControl`, so
  `aria-pressed` buttons inside `role="group"` named `X axis`):
  `getByRole("button", { name: "Wall clock", exact: true })` / `"Turns"`; Turns relabels the axis `TURN`
  (a strict grid: one equal-width column per model turn, always split
  into a left model half and a right tool half — a tool-less turn leaves
  the tool half empty, a tool-only turn the model half; N sequential tool
  calls split the tool half into N equal slots regardless of working
  time, rejected calls taking a slot as dashed ghosts, a burst stacking
  its sub-lanes inside its slot; 6–10 gridlines from seven turns up, one
  per column boundary below that; a tool half too narrow for its slots
  draws one aggregate teal rect whose hover reads `turn N · M tool
calls[ · k failed][ · r rejected]`; when every slot is a rejected call the aggregate is a
  dashed ghost reading `turn N · r rejected · no tool run`)
  and removes the Working time chip from the picker — the band hides
  there too, but its override is kept, so Wall clock restores both as they
  were.
- Agent gutter (only when a sample has more than one conversation — agent /
  subtask / solver spans, plus grader rows): `getByRole("checkbox", { name:
"Hide <agent>" | "Show <agent>" })`; rows past 4 fold into a
  `+N more` button. Curve bands carry a swatch · name legend
  (`text[class*='legendName']`); per-row values are on the hover card only.
- Hover: any pointer position over the plot draws one hairline through
  every band plus a dark time pill on the axis (`[class*='cursorPillText']`,
  `turn N` in Turns mode). Hovering a span, marker, stall, burst, context
  point or dense bin shows the single tooltip card after 120ms (header = subject + status
  on the full card width · mono time line beneath it (`[class*='timeLine']`) ·
  who · detail grid · `open in transcript →` footer).
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
- Category pills filter the list additively; `All` resets.
- `open in transcript →` (the hover card's footer link, and the button on a
  history row) lands on `/transcript?event=<uuid>` with the transcript
  scrolled to the event. Nothing drawn in the chart has a click action:
  clicking a span, marker glyph, strip column or crowded-half aggregate
  leaves the URL and the history filters unchanged (the pointer cursor
  stays `default` over them); hover or keyboard focus shows the card.
- Dense logs (50+ turns): the merged model+tool band degrades to a
  per-pixel occupancy strip and the headline appends `per-pixel occupancy`;
  in Turns mode the strip bins by turn index and bin hovers read
  `turns a–b · N model · M tool`. A Turns row also degrades once its
  columns are narrower than 9 px (two 4.5 px halves: the 3 px tick floor
  plus the 1.5 px seam each) — about 107 turns on a 960 px plot; every
  grid cell is a half, so a model-only row switches at the same width.
- Multi-conversation samples (`example_of_weird_subagent_logging.eval` in
  test_evals has 3 hand-off agents): one activity row per conversation with
  a checkbox gutter, a dotted `awaiting <child>` thread on the parent while
  a spawned agent runs, per-conversation context lines and token burn as
  stacked areas; unchecking a row removes it from every band and the
  headline appends `a of b shown`.
