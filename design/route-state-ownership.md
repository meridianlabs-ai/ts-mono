# Route ownership and VS Code restoration

The router owns the current destination in both viewers. A VS Code snapshot
is a checkpoint used to construct that router after the webview is recreated;
it is not a second live navigation model. Browser sessions do not read or write
these checkpoints.

## Ownership

| State | Owner | Lifetime |
| --- | --- | --- |
| Current path, route query parameters, route fragment | React Router | Current page |
| Inspect active log and sample | Derived from route; sole inline sample from that log’s summaries | Current destination |
| Last committed route | Webview route checkpoint | VS Code webview |
| Embedded launch destination and display mode | Host bootstrap | Initial page construction |
| Explicit host navigation | Host message bridge | Delivered command |
| List highlight, filters, expansion, scroll, component state bags | UI store | Page; persisted in VS Code where configured |
| User settings | Settings store | Existing settings persistence |
| Fetched logs, samples, scans and transcripts | Data layer / query cache | Existing cache policy |

A route checkpoint stores `pathname + search + hash` on committed router
location changes, immediately through `getState`/`setState`. The debounced
Zustand UI snapshot remains separate. Its later writes must preserve the route
checkpoint, and route writes must preserve UI state. `createWebviewStorage`
provides named entries with read/merge/write semantics for both apps. It also
reads Inspect's previous raw JSON string as the `app-storage` entry to retain
UI preferences; old navigation fields inside that snapshot are ignored.

Restoration happens before router creation and before route-dependent views
mount. Precedence is an explicit nonempty URL hash, the current webview route
checkpoint, then the embedded launch route.
Without any of these, normal index routing applies. A fresh browser page has
no webview checkpoint and starts from its URL or launch parameters.

There is no migration from Inspect's former `app.urlHash` or Scout's former
selected scan/result fields. An older webview without a route checkpoint starts
from its explicit URL, host launch destination, or normal index route once.
Subsequent navigation writes the current checkpoint and resumes normally.

## Host lifecycle and messages

VS Code destroys hidden webview contents by default; losing keyboard focus
while the panel remains visible is different. The installed Inspect extension
(0.9.18) and the local extension checkout use `retainContextWhenHidden: false`
for file custom editors, but `true` for the full Inspect View / Scout View
panels. File editors therefore exercise reconstruction; switching away from a
full View panel exercises retained state and host focus handling.

Inspect View re-posts its last `updateState` message when activated. A replay
must not reset an in-app sample or tab selection. The bridge remembers the last
host destination separately from the current route and ignores identical
replays; different destinations still navigate after restoration. This is host
protocol bookkeeping, not a mirror of in-app navigation. The current protocol
has no command identity, so an explicit repeat of the exact same destination
cannot be distinguished from a focus replay. A future extension protocol can
make that intent explicit and remove this compatibility bookkeeping.

Scout View does not re-post its route merely on focus. Delivered `updateRoute`
commands replace the current destination. Embedded startup mode is applied
before rendering instead of being guarded by persisted initialization flags.
Both apps attach their host-message listeners only when the VS Code API is
present. Browser-mode Scout no longer accepts navigation from arbitrary window
messages, matching Inspect's existing host boundary.

## Scope of this change

This replaces Inspect's post-startup hash restoration and temporary
`initialState` redirect, and Scout's scan/result-specific restoration effect.
It removes `rehydrated`, `hasInitializedRouting`,
`hasInitializedEmbeddedData`, and `displayedScanResult` from the live state
contracts. It covers arbitrary route destinations, including transcript and
event routes, without teaching the persistence layer each route shape.

Inspect's active log/sample identity now comes from `CurrentSelectionProvider`,
a read-only derivation of the current route and resolved configuration. The
single-sample inline view derives its sample from that log's summaries. Data
hooks, navigation, search, printing, and edit actions consume this identity;
no component writes a selected log/sample before or after navigating.
`selectedLogFile`, `selectedSampleHandle`, and `loadedLog` are removed from the
live store contract, along with their selection/unmount effects.

`highlightedSample` is separate UI memory for returning to a list. Opening a
sample remembers its row, and moving the grid highlight changes that memory;
neither operation can override the route's active data identity. Old persisted
`selectedSampleHandle` values migrate to this field. Obsolete log selection and
loaded-log snapshots are discarded during initialization.

External embedders such as Hawk call public selection hooks outside the
viewer's RouterProvider. Those hooks subscribe to the same router directly,
using `useSyncExternalStore`, and derive loaded-log status from the data cache.
They retain same-log highlighted-row previews on a sample list. An explicit
sample destination always wins, including unresolved or invalid destinations;
a stale highlight cannot substitute for it.

Remaining work includes tab preference/route mirroring, derived score state,
and the Samples grid's remembered navigation order. Those need their own
behavioral boundaries before removal. Filters, column widths, scroll, and
expansion are legitimate UI state. Non-route UI persistence remains debounced
with its existing timing limitations. Do not replace the remaining mirrors
with a broader generic mirroring abstraction.

## Verification

The acceptance pass on 2026-09-16 covers the complete suites, not just selected
navigation specs: **115 Inspect and 84 Scout Playwright tests**, `pnpm check`
(33 tasks), and `pnpm test` (all nine packages) pass.

The full Inspect suite previously caught a header-collapse leak when moving
from a deep-linked sample to its sibling. The header now resets navigation
ownership with the sample visit key. The original regression test passes
unchanged. The acceptance pass below found no further application regressions.

### Durable regression coverage

- Shared router/storage tests cover exact route/query/fragment restoration,
  immediate checkpoints, explicit URL priority, malformed checkpoints, old
  navigation snapshots being ignored, browser non-persistence, independent
  UI/route writes, and host replay filtering.
- New app-level Playwright tests run both viewers with `acquireVsCodeApi`,
  JSON-RPC HTTP transport, embedded host launch data, and panel-owned state.
  They recreate the document **without its hash** while retaining that state.
  Inspect checks epoch/tab restoration, focus replay, a different host log,
  and explicit deep-link priority. Scout checks full-view host navigation and
  single-file transcript/event routes, query parameters, and display mode.
- The test host forwards HTTP requests to the existing MSW network boundary;
  it does not replace the app's router, store, selection hooks, or API adapter.
  Scout's polling transport receives real topic-version responses from MSW.
  These tests simulate the webview contract, not VS Code's extension runtime.
- Cross-log browser navigation covers repeated sample IDs, different epochs,
  a sole inline sample, reload, Back, list highlighting, and reopening. Printing
  from the inline sample after crossing logs verifies the current log's content
  is printed and the previous log's content is absent.
- Existing complete suites cover search/find, filters, transcript navigation,
  scrolling, sibling header reset, error states, chat, and scan/dataframe views.
  Public embedding selection hooks are tested outside RouterProvider.

### Real VS Code acceptance

Tested the production builds in a separate, trusted local workspace with
copies of eval/scan files. The installed `ukaisi.inspect-ai-0.9.18` extension
contains local compiled security changes; this was **not** an untouched
Marketplace release. Python used Inspect `0.3.259.dev6+g552b4fe43.d20260831`
and Scout `0.4.46` from the Inspect development virtual environment.

| Scenario | Observed result |
| --- | --- |
| Inspect multi-sample custom editor | Epoch 3 / Messages survived hiding and full window reload. |
| Inspect sole-sample custom editor | Metadata survived recreation and full window reload independently of the multi-sample panel. |
| Multiple Inspect panels | Each retained its own log, sample, and tab across switching/restart. |
| Search after restoration | Local grep returned matching text from the restored sample. |
| Edit after restoration | Added a test tag to the disposable single-sample log; disk inspection confirmed only that log changed. |
| Scout full View | Scan, efficiency scanner, exact result, and Events tab survived full window reload and closing/reopening the workspace. |
| Inspect live eval | Six-sample mock-model eval completed successfully. Selected sample / Messages survived hiding while further samples arrived; subsequent samples remained navigable. |
| Closed workspace reopened | Inspect returned to sample 6 / Messages; Scout returned to the exact result / Events. |
| Full Inspect View | Inline sample / Messages survived full window reload. |
| Earlier production checks | Scout custom-editor result / Events recreation; full Scout transcript / Messages hide/reveal; Inspect turn 10 restoration followed by next epoch with expanded header. |

Window reload restarts the renderer and extension host. Closing/reopening the
workspace additionally exercises serialized panel restoration. The entire VS
Code application was not quit, preserving the user's other window and unsaved
work. Remote/SSH/web VS Code and other extension versions were not exercised.

### Known boundaries

A hidden full Scout View sometimes ignores the command that reveals it. This
was reproduced with the original installed frontend: hidden Transcripts →
`Scout: Validations` revealed Transcripts; repeating the command while visible
opened Validation. The extension's reveal callback can call `updateVisibleView`
before `isVisible()` becomes true. This predates the branch; no extension code
is changed here.

Inspect's host protocol cannot distinguish a deliberate repeat of the exact
same destination from a focus replay. The filter preserves in-app navigation
on focus; a future command identity is needed to distinguish those intentions.

Non-route UI persistence retains its existing debounce timing; route checkpoints
are immediate. There is deliberately no migration of old navigation snapshots,
so an older saved panel starts from its host launch destination once. Browser
sessions continue to use their URLs without persisting webview checkpoints.
