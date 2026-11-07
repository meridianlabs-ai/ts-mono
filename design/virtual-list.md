# VirtualList

`VirtualList` (`packages/react/src/virtual/`) is the shared virtualizer for
chat, transcript and scout result lists. It wraps `@tanstack/react-virtual`
and adds scaled scrolling, live-follow, state restoration and find
integration. It replaced `react-virtuoso`, which is no longer a dependency.

## Why scaled scrolling

Browsers cap an element's height (~33.5M px in Chromium, ~17.9M px in
Firefox). A virtualizer that sizes one tall spacer to the sum of item heights
silently clamps past that, and the end of the list becomes unreachable. Chat
and transcript views hit this at roughly 67,000 items.

## Two coordinate spaces

- **Content space**: the real total height, the sum of measured item heights.
  It can be billions of pixels.
- **Spacer space**: what the browser scrolls. It is clamped to
  `SAFE_MAX_SPACER` (16M px, below Firefox's cap).

`scale = contentTotal / SAFE_MAX_SPACER` when content exceeds the cap, else 1.
The math lives in `scale-coordinate-space.ts`, which is unit-tested.

TanStack works entirely in content space:

- A custom `observeElementOffset` multiplies the browser's `scrollTop` by
  `scale` before reporting it to the virtualizer.
- A custom `scrollToFn` divides by `scale` before writing `scrollTop`.
- The padding divs above and below the rendered band are scaled into spacer
  space (each chunk capped at 5M px). That padding is what the user scrolls
  through.
- Items in the rendered band keep their natural heights and content-space
  gaps, so adjacent rows never overlap. An earlier design compressed item
  *positions* instead, which produced overlap.

When `scale === 1` the hot path is a plain TanStack virtualizer.

At `scale > 10` the native scrollbar is a coarse navigator, and smooth
scrolling is forced to instant because the animation runs in spacer space and
would blur across many items per pixel. Keyboard navigation, find and
`scrollToIndex` still work.

## Live-follow

- With `live`, the list follows output while the user is within 30px of the
  bottom; scrolling further away stops following, and scrolling back resumes
  it. The bottom check uses spacer-space DOM values only, so it is correct at
  any scale.
- The follow state is persisted per `persistenceKey`. The initial value on
  mount: a `follow=1` URL param forces it on; a deep-link (nav-owned) mount
  forces it off even over a persisted `true`, so the landing isn't yanked to
  the tail; otherwise the persisted value, else `live`.
- When `live` flips false→true, follow re-arms unless the user has scrolled.
- `scrollToTopOnFinish` (default `false`) scrolls to the top when `live` turns
  false while following.

## State restoration

Snapshots are stored per `persistenceKey` through `useProperty` (Zustand
`persist`, which reaches `vscodeApi.setState` in VS Code) as
`{ version: 1, scrollOffset, totalCount }`. `scrollOffset` is in content
space so it survives scale changes. A snapshot with a different `version` is
discarded. If `totalCount` differs from the current data length, the restored
offset is clamped to the current content. `persistScroll={false}` turns
snapshots off. Keys must be per-sample (e.g. `chat-${sampleId}`), or scroll
position leaks between samples.

## Find integration

Lists register with `ExtendedFindContext` under their `persistenceKey`
(`findScope: "none"` opts out). Matching scans the in-memory data, and
scroll-to-match goes through `scrollToIndex`, so it works at any scale.

## Testing

- Scale math: `__tests__/scale-coordinate-space.test.ts`; find match
  counting: `__tests__/count-matches.test.ts`.
- Component behavior: `VirtualList.test.tsx`.
- E2E: `apps/inspect/e2e/chat-virtualization.spec.ts`.

## Not built

- A jump-to-index control for extreme scales.
- Re-quantizing `scale` only on ≥10% growth with top-item anchoring.
  `shouldRequantize` exists, but the component recomputes `scale` directly.
