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

Automated checks include actual hash-router recreation, immediate checkpoints,
query/fragment preservation, explicit deep-link priority, browser non-persistence,
old-navigation snapshot reset, independent UI/route writes, and host replay handling.
`pnpm check` and `pnpm test` pass. Browser navigation regression suites passed:
20 Inspect cases (top-level views, message deep links, log-location trust) and
10 Scout cases (application navigation, scans, scan and transcript detail).

Manual testing with production builds in VS Code 0.9.18 extension:

- Inspect custom editor: existing saved Task tab restored; navigated to sample
  1, epoch 2, Messages; hid and reopened; epoch and tab restored.
- Scout custom editor: opened a scan and result, selected Events; hid and
  reopened; result and tab restored.
- Full Inspect View: opened a one-sample evaluation, selected Messages; hid and
  reopened; inline sample and tab remained selected.
- Full Scout View: opened a transcript, selected Messages; hid and reopened;
  transcript and tab remained selected. A visible-panel `Scout: Scans` command
  navigated away from the transcript correctly.

A `Scout: Validations` command sent while full Scout View was hidden revealed
the panel but left its Scans destination unchanged. The extension's reveal path
calls `updateVisibleView` immediately and checks `isVisible()` before posting;
this is a suspected extension-side visibility race. Reproduced with the prior
installed frontend after restoring its original assets: from hidden Transcripts,
`Scout: Validations` revealed the panel but left it on Transcripts; repeating the
command while visible navigated to Validation. This behavior predates this
branch. No extension code is changed here. Restart/deserialization of full View
panels was not manually tested.

### Active selection follow-up

The route-derived Inspect selection change passes `pnpm check`, `pnpm test`
(including 1,414 Inspect tests), and 30 Inspect browser cases. Added coverage
checks route changes and Back across logs/epochs, a one-sample inline view,
reload without a store selection, return-to-list highlighting and reopening,
legacy UI-state migration, and all three public embedding selection hooks
outside RouterProvider. Existing deep-link, transcript, and log-location trust
regressions also pass.

With the production build and installed VS Code extension, manually verified:

- Multi-sample custom editor: opened epoch 2, chose Messages, hid/revealed the
  editor (webview reconstruction), retained epoch/tab, then advanced to epoch 3.
- Single-sample custom editor: derived and displayed the inline sample, chose
  Messages, hid/revealed, and retained the inline sample and tab.
- Full Inspect View: navigated from workspace Tasks into a one-sample log,
  opened its focused turn, hid/revealed the retained panel, and exited focus
  mode back to the transcript.

Scout code is unchanged in this follow-up. Temporary test panels were closed
and the original installed Inspect frontend assets restored and byte-verified.
Full VS Code application restart remains outside the manual coverage above.

### Removal of old navigation migration

Old UI snapshots no longer provide a restoration destination. Removed both
app-specific readers and the shared router's `legacyPath` option. Tests cover
starting from the host launch route when only an old snapshot exists, along
with the existing exact-location recreation and explicit deep-link priority
checks. UI preference storage and highlighted-row compatibility are separate
from route restoration and remain unchanged.

After removal, `pnpm check` and `pnpm test` pass. The production Inspect build
also restored epoch 3 and Messages after hiding/revealing its VS Code custom
editor. Original installed frontend assets were restored and byte-verified.
