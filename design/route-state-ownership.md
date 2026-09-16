# Route ownership and VS Code restoration

The router owns the current destination in both viewers. A VS Code snapshot
is a checkpoint used to construct that router after the webview is recreated;
it is not a second live navigation model. Browser sessions do not read or write
these checkpoints.

## Ownership

| State | Owner | Lifetime |
| --- | --- | --- |
| Current path, route query parameters, route fragment | React Router | Current page |
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
reads Inspect's previous raw JSON string as the legacy `app-storage` entry.

Restoration happens before router creation and before route-dependent views
mount. Precedence is an explicit nonempty URL hash, the current webview route
checkpoint, a compatible legacy checkpoint, then the embedded launch route.
Without any of these, normal index routing applies. A fresh browser page has
no webview checkpoint and starts from its URL or launch parameters.

Inspect's legacy checkpoint is `app.urlHash`. Scout's legacy checkpoint is
reconstructed from `selectedScanLocation` and `displayedScanResult`, using the
saved scan directory when present. Compatibility readers accept unknown data
and ignore malformed snapshots. These legacy values never drive subsequent
navigation.

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

It deliberately does not yet remove every route-to-store mirror. Inspect's
selected log/sample and tab fields still feed live consumers. Some also encode
valid UI memory: a highlighted row after closing detail, or the selected sample
shown inline for a one-sample log. Those consumers need to be separated before
deleting their writers. Non-route UI persistence is still debounced and has its
existing timing limitations.

The next ownership change should make active log/sample consumers derive their
identity from routing, give last-selection memory an explicit separate name,
and derive the one-sample fallback from loaded data. Query ownership and UI
state reset boundaries should follow that identity. Do not replace these
remaining mirrors with a broader generic mirroring abstraction.

## Verification

Automated checks include actual hash-router recreation, immediate checkpoints,
query/fragment preservation, explicit deep-link priority, browser non-persistence,
legacy migration, independent UI/route writes, and host replay handling.
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
this is a suspected extension-side visibility race. Comparison with the prior
installed frontend was interrupted by the Mac locking, so its baseline status
is not yet confirmed. No extension code is changed here. Restart/deserialization
of full View panels was not manually tested.
