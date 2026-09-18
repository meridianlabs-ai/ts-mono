## Summary

Adds an **Activity** tab to the sample view (next to Transcript / Messages / Scoring / Metadata). It shows what an agent did over the life of one sample, on one shared time axis, so you can see at a glance where the time, tokens and context went and jump straight to the transcript event behind any point.

**What is on the tab**

- **Model & tool activity** — one row per conversation (the main agent, each sub-agent or hand-off, and a grey row for any model-graded scorer). Grey blocks are model calls, teal blocks are tool calls, failed tools are outlined red, concurrent tool calls stack into sub-lanes with a `bash ×3 · 1 failed` label. A parent waiting on a spawned child shows a dotted `awaiting <child>` thread. On samples with more than one conversation a gutter appears with a checkbox per row so you can hide a conversation from every band.
- **Context size** — the model's input context per call, one line per conversation. Compactions draw as dashed cliffs annotated `142k → 38k`.
- **Token burn** — cumulative tokens as stacked areas by conversation.
- **Markers** — a rail of glyphs for errors ✕, limits ▲, rejected approvals ●, human input ◇, interrupts ‖, compactions ▼ and scores ◎, clustered as `×N` when they crowd.
- **Working time** (opt-in) — the sample's working clock, with gaps where it waited and red brackets for rate-limit stalls (`12s · rate limit ×3`). Wall-clock axis only.
- **History list** beneath the chart — every marker as a row with a Kind pill, filter pills per category (`Errors 3`, `Limits 1`, `Rejections 0`, …), free-text search, sortable Time column, virtualised. Rows link to the transcript.

**Two axes.** A **Wall clock | Turns** segmented control at the right of the chip row switches the whole chart. Wall clock lays events out by real time. Turns gives every model turn (one model call plus the tool calls it made) an equal-width column, so long-running and quick turns read alike; the axis reads `TURN 1 … 90` and turns from all conversations interleave in order.

**Hover, then click through.** Moving over the chart draws one hairline through every band with a time pill on the axis and read-out dots on the curves. Resting on a model call, tool call, marker, context point, compaction or stall opens one card: header (subject and status), the time on its own line, who ran it (swatch · agent · model · turn), a short detail grid (duration, input / cached / output tokens, stop reason, tool result size or error, context delta, compaction before → after …) and an **`open in transcript →`** footer. The card stays put while you move the pointer down to its footer. Where the chart has collapsed something (a dense bin, a crowded turn, a `×N` marker cluster, a fan-out of parallel calls) the footer reads `open first in transcript →` and opens the earliest event in the range. Nothing drawn in the chart has a click action of its own.

**Dense samples.** Past roughly one call per 3 px a row degrades to a per-pixel occupancy strip (grey / teal by majority, red hairline where a call failed); hovering a strip column reads `8 model calls · 1 tool call (1 failed)` with the window. In Turns mode the same happens once columns fall under 9 px.

**Approvals** render only when a policy did not approve: `reject` / `escalate` / `terminate` / `modify` produce a ● marker and a history row naming the decision, the tool call and the approver.

Band toggles, axis, hidden conversations, filters, search, sort and selection persist per sample. The tab is hidden for old logs whose events carry no timestamps. Running samples draw pending calls open-ended.

**Companion change:** the log-level `Timeline` tab is now labelled **Activity** (tab id and persisted keys unchanged).

Code lives in `packages/inspect-components/src/sample-activity/` (`activityData.ts` derivation, `SampleActivityPanel.tsx`, `ActivityChart.tsx`, `ActivityTooltip.tsx`, `ActivityHistoryList.tsx`). The task-level timeline is untouched.

## Design decisions

The settled calls, in their final form (the design owner made or confirmed each during the live review; the history section links the rounds):

- **Band order and defaults:** Model & tool activity → Context size → Token burn → Markers on by default; Working time opt-in.
- **Conversation rows** are keyed on the nearest enclosing `agent` / `subtask` / `solver` span (verified stable across the inspect_ai source and 1,241 local logs); scorer calls get their own row, sorted last; span-less events fall into one root row.
- **Turns is a strict grid:** every column is a left model half and a right tool half, always. A tool-less turn leaves its tool half empty; N sequential tools split the tool half into N equal slots; rejected calls take a dashed ghost slot; a burst stacks inside its slot. Working-time proportions are visible on the Wall clock and on the card, not in Turns.
- **Every call is visible:** a span draws at least 3 px in both modes, so a 0.1 s `python` call beside a 16 s model call still shows.
- **Tool colour** is a saturated teal (`#14b8a6` light / `#2dd4bf` dark) against the model grey; hovering a span outlines it and dims nothing else.
- **Turns gridlines:** 6–10 full-height separators whatever the turn count (a 1-2-3-5-6-10 step table); one per boundary for six turns or fewer.
- **Density switch at 9 px columns:** a Turns row drops to the turn-binned occupancy strip once its halves would fall under the 3 px floor plus the 1.5 px seam (about 107 turns on a 960 px plot). A crowded tool half that still fits its column draws one aggregate teal rect (`turn N · M tool calls`), or a dashed ghost when every call was rejected.
- **No chart click actions.** Navigation happens from hover-card footers and history rows only; the dense-bin time filter and glyph→row selection went with the clicks.
- **Working time is Wall-clock only:** in Turns the chip leaves the picker and the band hides; the persisted override is kept, so Wall clock restores it. The chip-row hint `working time · gap = waiting` was dropped.
- **Curve anchors in Turns:** a turn's context dot sits at its column's left edge; its burn step and any compaction cliff rise at the end of the model half. Column 1 carries turn 1's values and the last step ends before the axis end.
- **Fan-outs on the Wall clock:** parallel calls issued within 1 s of each other while all still running collapse to one context vertex at the largest value; the dot's card lists the calls (`6 parallel calls · 984 – 1,470`) and links the first. A compaction splits a fan-out. Turns keeps one column per call, and the context line follows turn order so it never steps backwards.
- **Collapsed-range cards link to their first event** (`open first in transcript →`).
- **Bin labels count calls**, spelled out: `8 model calls · 1 tool call (2 failed)`, distinct calls overlapping the bin's window.
- **Curve-band gutters are swatch + name only**; per-row values live on the hover card.
- **The axis toggle is the shared `SegmentedControl`** from `@tsmono/react/components` (same look as the navbar's Tasks / Folders / Samples).
- **Hover-card title has the full header width**; the time range sits on its own line beneath.
- **Card travel:** once a card is up it holds while the pointer heads for its footer, inside a corridor 24 px either side of the card; curve bands, another row's strip, a crowded half or the marker rail crossed on the way do not take it over, and returning to the same target re-shows it.

**Open for the reviewer** — items still flagged for the design owner; nothing in the code is blocked on them:

1. **Density switch vs. hairline:** below 9 px columns a Turns row goes to the strip rather than drawing seam-free hairline halves. Confirm.
2. **Strip colouring:** a strip column is coloured by its majority kind, so a one-model-one-tool turn reads grey. Colour it teal whenever it holds any tool call?
3. **In-band seams:** the 1.5 px body-coloured seams between adjacent Turns rects were kept when the full-height separators went to 6–10. Keep or drop?
4. **Tool hue:** the exact teal was the developer's reading of "more contrasting". Confirm or pick another.
5. **Glyph→row selection removed:** a marker glyph used to select and scroll to its history row on click; that went with the no-click rule (the row is reachable via the card footer, hover linking is unchanged). Confirm.
6. **Model-only rows under 9 px:** since the strict grid, rows with no tool calls also switch to the strip at 9 px columns (their model rects are halves too). Confirm.
7. **Neighbouring-point hold:** a context point's card holds inside its column like a span card, so sweeping right along a dense line reads the next vertex only after the 300 ms grace or once past the card. Confirm.
8. **`open first in transcript →` label** for collapsed ranges. Confirm the wording.
9. **Bin identity per row:** on a multi-row chart the same bin window on two rows is two targets (row 2's bin does not take over row 1's card). Confirm.
10. **Fan-out split at a compaction:** a call issued after a compaction inside a fan-out opens a new group. Confirm.

## Screenshots

**Before** = the PR as first opened (`206c207d`); **after** = the current head (`5527d8fe`). Same log, same sample, same 1280 × 900 viewport, same axis mode per pair. The pre-revision build had no Turns axis and hid the Model & tool activity and Context size bands by default; the "before" shots have those two bands switched on so the pairs compare like with like. Where the old build has no comparable view the before cell says so.

### Light

| Before (`206c207d`) | After (`5527d8fe`) |
| --- | --- |
| ![Before: ascii/car, Wall clock, light](./before-car-wall-light.png) | ![After: ascii/car, Wall clock, light](./after-car-wall-light.png) |
| **ascii/car** (`ascii_art_python`, 91 turns · 89 `python` calls), Wall clock. Tool calls are invisible next to the model calls, the context line drops to zero at the end, one undifferentiated row. | Model and tool calls both visible (3 px floor), one row per conversation with the scorer's row below, the context line ends at the last call, stacked burn, `Wall clock \| Turns` control. |
| *No Turns axis in the pre-revision build.* | ![After: ascii/car, Turns, light](./after-car-turns-light.png) |
| | Same sample in **Turns**: one equal column per turn, model half grey / tool half teal, 6–10 gridlines, `TURN` axis, Working time chip hidden. |
| ![Before: model call popover, light](./before-car-wall-model-card-light.png) | ![After: model turn card, light](./after-car-wall-model-card-light.png) |
| Hovering a model call: a two-line popover (model · time · `click to open in transcript`). | Hovering a model turn: the shared card — subject and status, time line, who ran it, duration / input · cached / output / stop / tool calls, `open in transcript →` footer; hairline and read-out dots through every band. |
| *No comparable card: the 0.1 s `python` calls had no hit area on the old build.* | ![After: tool call card, light](./after-car-wall-tool-card-light.png) |
| | Hovering a `python` tool call: duration, result size, the first argument (the code), the turn it belongs to. |
| *No Turns axis in the pre-revision build.* | ![After: compaction log, Turns, compaction card, light](./after-compaction-turns-card-light.png) |
| | **ascii/car** (`ascii_art_compaction`, 73 turns · 12 compactions) in Turns: dashed cliffs at the end of each compacted turn's model half, ▼ markers, and a compaction card (`5,067 → 2,068 · freed 2,999 · 59% · strategy summary`). |
| *No Turns axis in the pre-revision build.* | ![After: 18-compaction log, Turns, density strip, bin card, light](./after-compaction18-turns-bin-card-light.png) |
| | The 18-compaction `ascii/car` log (246 turns · 253 tool calls) in Turns: both rows on the occupancy strip, cliffs annotated `5k → 893`, and a strip-bin card (`5 model calls · 4 tool calls · turns 121–125`, `open first in transcript →`). |
| *No Turns axis in the pre-revision build.* | ![After: osworld, Turns, light](./after-osworld-turns-light.png) |
| | **osworld** (7 turns) in Turns: column 1 carries turn 1's context and burn; every step rises at the end of its model half and the last one ends before the axis end. |
| ![Before: ai-rd main/2, Wall clock, light](./before-aird-wall-light.png) | ![After: ai-rd main/2, Wall clock, light](./after-aird-wall-light.png) |
| **ai-rd-fix-embedding** `main` / epoch 2 (triframe, 484 model calls, fan-outs of 3 + 3 parallel calls): the context line is a wall of stacked vertices. | The same sample: fan-outs collapse to one vertex each (161 for 484 calls), the strip shows the failed-tool hairlines, error markers cluster. |
| ![Before: ai-rd context vertex popover, light](./before-aird-wall-vertex-card-light.png) | ![After: ai-rd fan-out card, light](./after-aird-wall-fanout-card-light.png) |
| Hovering the context line: `10,679 tokens · 10:28:49 PM`, no way to tell which of the stacked calls it is. | Hovering a fan-out vertex: `6 parallel calls · 984 – 1,470`, each call with its context, duration and turn, the shown one bold, `open first in transcript →`. |

### Dark

| Before (`206c207d`) | After (`5527d8fe`) |
| --- | --- |
| ![Before: ascii/car, Wall clock, dark](./before-car-wall-dark.png) | ![After: ascii/car, Wall clock, dark](./after-car-wall-dark.png) |
| **ascii/car**, Wall clock. | Dark tool teal `#2dd4bf`, row hues, stacked burn. |
| *No Turns axis in the pre-revision build.* | ![After: ascii/car, Turns, dark](./after-car-turns-dark.png) |
| | **ascii/car** in Turns. |
| ![Before: model call popover, dark](./before-car-wall-model-card-dark.png) | ![After: model turn card, dark](./after-car-wall-model-card-dark.png) |
| Hovering a model call. | Hovering a model turn: card, hairline and read-outs in dark. |
| *No Turns axis in the pre-revision build.* | ![After: 18-compaction log, Turns, density strip, bin card, dark](./after-compaction18-turns-bin-card-dark.png) |
| | 18-compaction log in Turns: strip, cliffs and a bin card. |
| ![Before: ai-rd main/2, Wall clock, dark](./before-aird-wall-dark.png) | ![After: ai-rd main/2, Wall clock, dark](./after-aird-wall-dark.png) |
| **ai-rd** `main` / epoch 2, Wall clock. | Collapsed fan-outs, clustered error markers. |
| ![Before: ai-rd context vertex popover, dark](./before-aird-wall-vertex-card-dark.png) | ![After: ai-rd fan-out card, dark](./after-aird-wall-fanout-card-dark.png) |
| Hovering the context line. | Hovering a fan-out vertex. |

## Testing

| Suite | Count | What it covers |
| --- | --- | --- |
| `activityData.test.ts` | 57 | conversation keying (span tree, root fallback, scorer rows, prototype-named ids), turn grouping and interleaving, per-span working seconds, timestamp-ordered attribution, rejection filtering and decision captions, context / compaction series (per-conversation fallback, fan-out ordering and grouping, split at a compaction), burst membership and fold, stalls and retries, non-finite token guards |
| `ActivityChart.test.tsx` | 91 | Wall clock and Turns geometry (strict grid, equal slots, 3 px floor, crowded aggregate and ghost, 9 px density switch, gridline steps), curve anchors and interpolated read-outs, the 1,000-conversation fold, tooltip dwell / travel corridor / re-show, collapsed-range footers, no click actions or pointer cursors, tool-colour contrast |
| `SampleActivityPanel.test.tsx` | 29 | default chips and order, band toggles, Turns hiding the Working time chip while keeping its override, malformed persisted state, filter / search / axis round-trips, hover card content and header layout, marker ↔ row hover link, shared `SegmentedControl` |
| `apps/inspect/e2e/sample-activity.spec.ts` (MSW) | 27 | tab presence and defaults, axis toggle, computed hover / failed outline colours over the Turns seam in both themes, 320- / 300- / 100-turn density behaviour in both themes, pointer travel from span, fan-out vertex, first-row bin and marker cluster to the footer with the same card at every step, inert span and glyph clicks, history click-through, tab hidden without timestamps, log-tab relabel |
| `@tsmono/inspect-components` package | 1,258 | `pnpm test --filter @tsmono/inspect-components` |

Every fix in the revision carries a regression test that was confirmed to fail with the fix reverted.

**Real-log drives** (verify-log-viewer harness — the production view server over real `.eval` files, Chromium, light and dark): the 91-turn `ascii_art_python` and 73-turn / 12-compaction `ascii_art_compaction` logs (`ascii/car`), the 18-compaction and 69-turn flaky fixtures, osworld (7 turns), ai-rd `main` / epoch 2 (484 model calls, 323 overlapping) and the 3-agent hand-off sample. Assertions on computed geometry and colours: every tool rect ≥ 3 px and the same width as its model rect in Turns, 6–10 separators, hover stroke `rgb(33,37,41)` 1 px light / `rgb(248,249,250)` dark, context lines starting in column 1, 0 backward context segments on ai-rd in both modes, stepped-pointer travel to every footer kind. The tracked drive is `apps/inspect/.agents/skills/verify-log-viewer/drive/sample-activity.spec.ts`.

**Hosted CI** at `5527d8fe`: all 11 checks green (build, changes, comment, e2e, e2e (inspect), e2e (scout), format, lint, suppressions, test, typecheck). `pnpm check` 33/33 locally.

## Known limits / follow-ups

- No local log carries a non-approve `ApprovalEvent`; the rejection row, `Rejections` pill and Turns ghost slot are covered by fixtures only.
- The context card omits the design's `limit (200k · 48%)` row: no event carries the model's context window.
- Deferred per the design: zoom / minimap, swimlane unification, a shared band-chart primitive.
- `CompactionEventView` (transcript, not this PR) throws `RangeError: Invalid time value` on a compaction event with an empty timestamp instead of omitting the time; surfaced by an e2e fixture.
- Between the 9 px switch and the global 3 px threshold the Turns strip colours a column by majority kind, so a one-model-one-tool turn reads grey (open item 2).
- In Turns a between-turn compaction's ▼ rail marker follows the marker rule (snapped forward to the next column) while its cliff sits in the compacted turn's column, so the glyph can sit about half a column right of the cliff.
- The fan-out window is a constant (`kParallelStartSec`, 1 s); a same-conversation call issued later into a running call keeps its own vertex.
- A rejected-only crowded Turns tool half has no event to open, so its card has no footer.
- Span rects are not held off during card travel: moving from a marker to its footer across a discrete-column row's model rects can still be taken over by a span (recorded by review pass 10).
- The curve read-out interpolates along the drawn line, so between two dots the card can show a fractional value (`2,701.002 tokens in context`); rounding the display is a one-line follow-up.

## Revision history

<details>
<summary>22 development rounds and 18 review passes (2026-09-14 → 2026-09-17)</summary>

Screenshots from every round are on the assets branch: [`ao/ts-mono-2/sample-activity-assets` → `sample-activity/`](https://github.com/meridianlabs-ai/ts-mono/tree/ao/ts-mono-2/sample-activity-assets/sample-activity) (`revision-2026-09-14/`, `revision-2026-09-15/`, `final-2026-09-17/` for this description's set).

| Round | Head | What changed |
| --- | --- | --- |
| pre-revision | `206c207d` | The PR as first opened: single activity row, working / waiting band first, Wall clock only, span and marker popovers, click-to-navigate |
| 1 | `a872e47c` | Sept 14 design handoff: band reorder and defaults, Turns axis, rejections-only approvals, conversation rows + agent gutter, stacked burn, shared-cursor hover card; merged `main` |
| 2 | `6f42b16a` | Review pass 1 (10 findings): prototype-named ids, scorer-row attribution, working-time Turns split, monotone burn path, pre-uuid turn links, fold membership, interpolated read-out, per-conversation compaction fallback, graced card close, card follows the pointer |
| 3 | `86902596` | Review pass 2 (7): persisted-state validation, decision Map lookup, fold aggregate curves (O(R²P) → O(P)), trailing compaction, timestamp-ordered attribution, burst overflow, finite-number guards |
| 4 | `1937f9b3` | Review pass 3 (3): fold sentinel by symbol, `max` caption on the fold's context, per-lane dwell keys |
| 5 | `13514568` | Review pass 4 (2): `CurveValueText` max caption in the single-value card, burst key by lane |
| 6 | `21854048` | Design owner: 3 px tick floor in both modes; 1-2-5 gridline step; uuid-first burst key (pass 5) |
| 7 | `5ed422f0` | Design owner: equal model / tool halves in Turns, saturated tool teal, name-only gutter legends, 6–10 gridlines from seven turns |
| 8 | `4b7ea5a2` | Design owner: turn-mate dimming on hover dropped |
| 9 | `d40be0c3` | Review pass 7 (2 + 2 nits): state outlines win over the Turns seam, crowded tool half → aggregate rect, terminal tick clamp |
| 10 | `f371e610` | Review pass 8 (2): 9 px density switch, ghost aggregate for rejected-only turns |
| 11 | `c0944068` | Design owner: Working time chip hidden in Turns |
| 12 | `13ebff3a` | Design owner: the card can be reached by hand (holds after leaving the target, corridor to the footer, debounced close) |
| 13 | `9addf792` | Design owner: axis toggle is the shared `SegmentedControl` |
| 14 | `817df84a` | Design owner: Turns is a strict grid (model half always, tool half always reserved, equal slots) |
| 15 | `b1798eed` | Design owner: "Working time" rename; no chart click actions; stale harness assertion |
| 16 | `a514633c` | Review pass 12 (2 + 2 cleanups): default cursors on glyphs and strips, harness compaction drive asserts the inert contract |
| 17 | `da0d10fe` | Design owner: card title takes the full header width, time on its own line |
| 18 | `77c93e39` | Design owner: Turns curve points anchor inside their own column |
| 19 | `b3ac9637` | Design owner: collapsed-range cards link to their first event; fan-out context vertices on the Wall clock; bin labels count calls |
| 20 | `dd79efdc` | Review pass 15 (3): point cards hold during footer travel, one anchor per fan-out vertex and split at a compaction, crossed surfaces don't re-target |
| 21 | `efa6add6` | Review pass 16 (1): returning to the shown target during the grace re-shows its card |
| 22 | `5527d8fe` | Design owner: the Working time legend hint dropped |

| Review pass | Head reviewed | Outcome |
| --- | --- | --- |
| 1 | `a872e47c` | 10 should-fix → round 2 |
| 2 | `6f42b16a` | 7 should-fix → round 3 |
| 3 | `86902596` | 3 should-fix → round 4 |
| 4 | `1937f9b3` | 2 should-fix + 1 nit → round 5 |
| 5 | `13514568` | 1 should-fix + 1 nit → round 6 |
| 6 | `5ed422f0` | not performed (reviewer usage limit); folded into pass 7 |
| 7 | `4b7ea5a2` | 2 should-fix + 2 nits → round 9 |
| 8 | `d40be0c3` | 2 should-fix → round 10 |
| 9 | `f371e610` | clean |
| 10 | `13ebff3a` | clean (marker → footer across model rects recorded as a limit) |
| 11 | `9addf792` | clean |
| 12 | `b1798eed` | 2 findings + 2 cleanups → round 16 |
| 13 | `a514633c` | clean |
| 14 | `da0d10fe` | clean |
| 15 | `b3ac9637` | 3 findings → round 20 |
| 16 | `dd79efdc` | 1 finding → round 21 |
| 17 | `efa6add6` | clean |
| 18 | `5527d8fe` | clean |

Design-owner decisions recorded along the way: turns interleave chronologically across conversations; `span_begin.type` is the conversation key (verified stable, no fallback needed); the context-limit card row is omitted (no data); a model-graded scorer counts as its own conversation; the handoff's working-time Turns split, turn-mate hover dimming, greyed Working time chip, bespoke axis toggle and legend hint are all superseded by the decisions above.

</details>
