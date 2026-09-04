# Find on the Messages tab

**Status:** implemented (Messages tab). Server side: inspect_ai
`design/find-messages.md`.

The Messages tab's Cmd+F is answered by the backend, which says which rows
match and what text matched; the rendered row finds the exact spot. Other
tabs keep their DOM find.

Terms: the **band** is the Cmd+F input with its "N of M" counter. A
**surface** is a list that registered itself as the thing being searched;
its **scope** is a string naming what it shows (here one sample's
Messages). A **sealed** sample is finished; a **live** one is still being
written and polled. A **projection** is the text a row is rendered from
under the current display settings.

## Contract

`LogViewAPI.find_messages?` is optional: without it the Messages tab
registers no surface and the band behaves as on any other tab. The view
server implements `POST /api/find-messages/{log}`; hawk supplies its own via
`setApiFactory`.

```
request  { sample_id, epoch, text, after?: anchor,
           projection?: { unlabeled_roles, tool_call_style, display_mode } }
response { rows: [{ anchor, index, count, texts }], at_end, complete }
```

A response is the matching rows after `after` (from the top when absent);
the server sizes the page. `at_end`: the page reached the sample's current
last row. `complete`: the sample is sealed. `texts`: the substrings that
matched in the row's projection; `count`: how many; `index`: the row's
position in the conversation.

An **anchor** names a row stably across polls of a live sample: the head
message id (`msg-{index}` for a message without one), with `#rowIndex`
appended while a *prior* row already holds the string. Only prior rows
count, so appending messages never renames an anchor
(`messageRowAnchorIds`, mirrored by the server):
`[dup, dup#2, dup, "", "", #4]` → `[dup, dup#2, dup#2#2, "", #4, #4#5]`.

## Decisions

- **Keep every matching row of one forward scan** (`FindStore`). The count
  needs every page anyway; holding the rows makes N, wrapping and
  relocation plain list arithmetic. The band shows "N of M+" while pages
  are still arriving and "N of M" once a page reports `at_end` on a
  `complete` sample. A live sample is always M+ and is re-scanned on each
  poll.
- **Steps never wait for rows that are already known.** Enter and
  Shift+Enter move inside the scanned rows at once. A step past them waits
  for the next page; steps taken meanwhile accumulate as a signed count, so
  Enter mashed past the first page lands on 1, 2, 3, … and an opposite step
  cancels one. Past the end of a finished scan a step wraps. Shift+Enter
  from the first match before the scan has finished waits for it, then
  lands on the last match.
- **The DOM decides inside a row, the server decides the total.** A mounted
  row reports how many of its `texts` it actually renders; stepping inside
  the row follows that number, and a row rendering none flashes and is
  skipped. M stays the server's sum (DOM counts differ by design: markdown,
  tool views) and N clamps the DOM position to the server's count.
- **A re-scan keeps the screen still until it catches up.** A display
  setting change or a live poll re-scans from the top while the old rows
  stay visible; when the scan reaches the active row it takes over and puts
  the user back on the same anchor (occurrence clamped, no scroll) or, if
  that row no longer matches, on the nearest matching row by `index`
  (scrolled to). A same-scope re-register (tab switch) does the same without
  scrolling: the list restores its own saved position, and the match stays
  active in the band. A scroll happens only for an activation (first hit,
  step, wrap, that fallback): the coordinator asks the surface to bring the
  row in and holds one reveal that the row's highlighter claims, so a row
  that merely re-renders or remounts never scrolls. Only
  a running sample's rows count as a data change; a sealed sample's rows
  change only by paging in what the server has already searched.
- **A failed page is shown, not swallowed.** The band shows "Error" in the
  count slot and the message on a line under the controls until the next
  search or close; rows already found stay usable as M+. The line cannot
  widen the band, so the input does not move.
- **Type-ahead is debounced and sealed pages are cached.** The band waits
  500ms after a lone first letter and 300ms from the second; Enter searches
  at once. The inspect adapter caches sealed pages (LRU) keyed by log,
  sample, term, cursor and projection, so backspacing to an earlier term
  does not POST again; a live page drops that sample's entries
  (`messagesFind.ts`, `findPageCache.ts`).
- **Highlight through the CSS Custom Highlight API** (`::highlight(find-match)`
  for the other occurrences, `::highlight(find-active)` for the active one):
  every DOM occurrence of the row's `texts`, skipping viewer chrome marked
  `data-find-chrome`. The active occurrence is centred through the
  virtualizer once the row's markdown has rendered (`data-markdown-pending`)
  and the range has a box, and once more if the row grows after a scroll
  that was clamped short; the list jumps only to a row that is not
  rendered, so a rendered row centres its own occurrence. A collapsed panel
  expands when the active occurrence sits below its fold, decided in a
  layout effect so it never paints expanded-then-collapsed; a closed
  `<details>` around it is opened. Without Custom Highlights the row
  flashes (`useFindHighlights`).
- **Chunked conversations are searched whole.** The server scans all rows;
  a match beyond the loaded prefix is paged in through its `index` (the
  list's own load-more) and then scrolled to.

## Why not

- `window.find` / DOM search: virtualized rows are not in the DOM; searching
  it needs retry and settle loops, and those jump the view.
- A window of rows instead of all of them: it needs cursors in both
  directions, an "end pin" for wrapping under a lower-bound total, and
  de-duplication against a separate count scan, for no saving the count
  scan does not already spend.
- Any fold in JavaScript: `RegExp` `iu` is simple case folding only
  (İstanbul, straße, café do not match their typed forms).
- A FIFO of step operations: a signed count gives the same 1, 2, 3 past the
  first page, and an opposite step cancels instead of queueing.
- Offsets on the wire: they would pin the server to the DOM's text.
