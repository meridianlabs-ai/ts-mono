# Post-Migration Code Review

Review of the chat, transcript, and timeline component migration into `@tsmono/inspect-components`.

Commits reviewed: `b3ac7bda` through `54cf26e9`.

---

## Priority 1: Bugs

### 1.1 Off-by-one in `TranscriptVirtualListComponent` — attached styling broken for item at index 1

**File:** `packages/inspect-components/src/transcript/TranscriptVirtualListComponent.tsx:146`

```ts
const previous =
  previousIndex > 0 && previousIndex <= eventNodes.length
    ? eventNodes[previousIndex]
    : undefined;
```

When `index === 1`, `previousIndex === 0`, and `0 > 0` is `false` — so `previous` is always `undefined` for the second item. This breaks the `attached` / `attachedChild` CSS classes: a tool event at position 1 following a model event at position 0 will never get the attached styling.

**Fix:** Change `previousIndex > 0` to `previousIndex >= 0`.

### 1.2 Empty `timelines[]` crashes `useActiveTimeline` via non-null assertion

**File:** `packages/inspect-components/src/transcript/timeline/hooks/useActiveTimeline.ts:51`

```ts
const active = timelines[activeIndex] ?? timelines[0]!;
```

If `timelines` is empty (e.g., during loading), `timelines[0]` is `undefined` and `!` just hides the crash. Callers receive a `Timeline` typed value that is actually `undefined`.

**Fix:** Guard early: if `timelines.length === 0`, return a sentinel/null state. Or widen the return type to `Timeline | undefined` and thread the optionality to callers.

### 1.3 `ChatViewVirtualListComponent` ignores `resolveIntoPreviousMessage`

**File:** `packages/inspect-components/src/chat/ChatViewVirtualList.tsx` (internal component)

`ChatView` respects `tools?.resolveIntoPreviousMessage` — when `false`, it maps messages without collapsing tool messages into the previous assistant message. But `ChatViewVirtualListComponent` unconditionally calls `resolveMessages(messages)`, ignoring this flag. Switching from non-virtualized to virtualized mode (triggered by `running=true` or `messages.length > 200`) silently changes rendering behavior.

**Fix:** Pass `tools?.resolveIntoPreviousMessage` to the virtualized component and respect it in the `useMemo`.

---

## Priority 2: Project Rule Violations

### 2.1 `eslint-disable react-hooks/exhaustive-deps` — file-wide in `StateEventView.tsx`

**File:** `packages/inspect-components/src/transcript/state/StateEventView.tsx:1-2`

```ts
// TODO: lint react-hooks/exhaustive-deps
/* eslint-disable react-hooks/exhaustive-deps */
```

Direct violation of the project rule: _"Never suppress `react-hooks/exhaustive-deps` as a fix."_ File-wide suppression in a state/store-related component risks stale closures in collapse/expand effects.

**Fix:** Remove the suppression; audit each hook and fix dependency arrays properly.

### 2.2 `eslint-disable react-hooks/exhaustive-deps` — per-line in `ChatViewVirtualList.tsx`

**File:** `packages/inspect-components/src/chat/ChatViewVirtualList.tsx:167-168`

```ts
// eslint-disable-next-line react-hooks/exhaustive-deps
[id, collapsedMessages, display, labels, linking, tools]
```

Same rule violation. The `renderRow` callback closes over the `item` passed by the virtualizer — `collapsedMessages` is structurally irrelevant to the callback itself.

**Fix:** Remove the suppression and correct the dependency array.

### 2.3 Blanket `/* eslint-disable */` in `tool.ts`

**File:** `packages/inspect-components/src/chat/tools/tool.ts:1`

A whole-file `/* eslint-disable */` with no justification. The file's content uses no `any` or assertions — the suppression appears left over. In a shared package, this silently permits future violations.

**Fix:** Remove the blanket disable. Add narrow per-line suppressions with justification if any specific lines need them.

---

## Priority 3: DRY / Code Sharing

### 3.1 `messagesToStr` duplicated across both apps

**Files:**
- `apps/inspect/src/app/shared/messages.ts`
- `apps/scout/src/app/utils/messages.ts`

Near-identical implementations of `messagesToStr`, `messageToStr`, `textFromContent`, and `betterContentText`. Both used from "Copy Transcript" toolbar buttons. The inspect version also has type assertions (`message as ChatMessageAssistant`) that violate the project's "no type assertions" rule.

**Fix:** Move into `packages/inspect-components/src/chat/` and export from the package. Remove both app-local copies. Use the scout version's control-flow narrowing pattern (no type assertions).

### 3.2 Timeline build logic duplicated in 3 places

**Files:**
- `packages/inspect-components/src/transcript/timeline/hooks/useTranscriptTimeline.ts` (canonical)
- `apps/scout/src/app/timeline/hooks/useTranscriptTimeline.ts` (scout wrapper)
- `apps/scout/src/app/timeline/components/TimelineEventsView.tsx:95-103`

The `buildTimeline` + `convertServerTimeline` computation is memoized separately at each call site. The root cause is that `useActiveTimelineSearchParams` needs the timelines array before `useTranscriptTimeline` builds it internally.

**Fix:** Extract a `useTimelinesArray(events, serverTimelines)` hook so both the URL-param adapter and the orchestrator share a single memoized computation. Or allow `TranscriptLayout` to accept pre-built timelines.

### 3.3 `setSelectedOutlineId` null-guard pattern duplicated in both apps

**Files:**
- `apps/inspect/src/app/samples/transcript/TranscriptPanel.tsx:168-177`
- `apps/scout/src/app/timeline/components/TimelineEventsView.tsx:136-145`

Both wrap `set` + `clear` store actions into a single `(id: string | null) => void` callback to match the outline interface. This is a direct consequence of the type mismatch in Priority 5.3.

**Fix:** Resolves automatically when the `setSelectedId` type is corrected (see 5.3).

---

## Priority 4: Dead Code / Cleanup

### 4.1 Dead `toolMessages` prop on `ChatMessage`

**File:** `packages/inspect-components/src/chat/ChatMessage.tsx:23-36`

`ChatMessageProps` declares `toolMessages: ChatMessageTool[]` as required, but the component never references it (it's not even destructured). Tool output rendering happens in `ChatMessageRow` via `ToolCallView`.

**Fix:** Remove `toolMessages` from the interface and all call sites.

### 4.2 Dead `eventsListRef` in inspect's `TranscriptPanel`

**File:** `apps/inspect/src/app/samples/transcript/TranscriptPanel.tsx:190,276`

`eventsListRef` is created and passed to `TranscriptLayout` but never read. `onNavigateToEvent` is never wired, so outline clicks that fall back to the imperative scroll path silently no-op. Scout handles this correctly.

**Fix:** Either wire `onNavigateToEvent` to `eventsListRef.current?.scrollToEvent(eventId)`, or remove the ref if URL-based navigation is the sole intended mechanism in inspect.

### 4.3 Dead `breadcrumbs` / `onBreadcrumbSelect` in `TimelineHeaderProps`

**File:** `packages/inspect-components/src/transcript/timeline/components/TimelineSwimLanes.tsx`

Neither `TranscriptLayout` nor any consumer populates `breadcrumbs` or `onBreadcrumbSelect` in the `header` prop. Breadcrumbs are computed internally in `TimelineSwimLanes`.

**Fix:** Remove the vestigial fields from `TimelineHeaderProps`.

### 4.4 `TranscriptVirtualList` is a thin memo wrapper that adds no value

**File:** `packages/inspect-components/src/transcript/TranscriptVirtualList.tsx:70-95`

`TranscriptVirtualListInner` does nothing but forward all props to `TranscriptVirtualListComponent`. The two interfaces (`TranscriptVirtualListProps` and `TranscriptVirtualListComponentProps`) are defined separately and can silently drift. Every new prop must be added to both.

**Fix:** Replace with `memo(TranscriptVirtualListComponent)` + `displayName`. Or consolidate the two prop interfaces.

---

## Priority 5: Props API Improvements

### 5.1 `EventPanelCallbacks` prop-drilled through 5 layers — use context

**Files:** `types.ts`, `TranscriptViewNodes.tsx`, `TranscriptVirtualList.tsx`, `TranscriptVirtualListComponent.tsx`, individual event views, `EventPanel.tsx`

`onCollapse`, `getCollapsed`, `getEventUrl`, and `linkingEnabled` are threaded through five component layers unchanged. The data is read-only (two getters + a boolean) and changes only when the parent store changes. This is the strongest candidate for a `TranscriptCallbackContext` in the entire package.

**Impact:** Eliminates boilerplate props from ~15 component signatures.

### 5.2 `scope` parameter on collapse callbacks is leaked implementation detail

**Files:** `TranscriptLayout.tsx`, `TranscriptViewNodes.tsx`

`onCollapse(scope, nodeId, collapsed)` and `onSetCollapsedEvents(scope, ids)` both expose a `scope: string` that the component itself produces. The caller adds no information — both apps forward the scope to their stores unchanged. The component knows whether it's collapsing a transcript node or an outline node.

**Fix:** Remove `scope` from the callback signatures. Provide two separate callbacks (`onTranscriptCollapse`, `onOutlineCollapse`) or internalize scope handling.

### 5.3 `setSelectedId: (id: string | null) => void` type mismatch

**Files:** `TranscriptLayout.tsx:82` vs `TranscriptOutline.tsx:68`

`TranscriptLayoutOutlineProps.setSelectedId` accepts `string | null`, but `TranscriptOutline` only ever calls it with a non-null `string`. This forces both apps to implement null-dispatch wrappers.

**Fix:** Change to `setSelectedId?: (id: string) => void` and add a separate `clearSelectedId?: () => void`.

### 5.4 `swimlaneHeaderExtras` wrapper object with one field

**File:** `packages/inspect-components/src/transcript/TranscriptLayout.tsx:107`

```ts
swimlaneHeaderExtras?: { onScrollToTop?: () => void };
```

A bag-of-one. Only scout passes it. No other "extras" exist or are planned.

**Fix:** Flatten to `onScrollToTop?: () => void` on `TranscriptLayoutProps`.

### 5.5 `collapsed?: boolean` is a three-state via optionality

**File:** `packages/inspect-components/src/transcript/TranscriptLayout.tsx:127`

`undefined` = no-op, `true` = collapse all, `false` = expand all. This is invisible in the type signature.

**Fix:** Use an explicit union: `bulkCollapse?: "collapse" | "expand"` (omit for no-op), or document the three-state contract.

### 5.6 `className: string | string[]` throughout

Non-standard union. React convention is `className?: string`. While `clsx()` normalizes internally, the public type should match convention.

**Fix:** Accept `string` only in public interfaces. Callers can compose with `clsx()` on their side.

### 5.7 `useTranscriptTimeline` positional parameter signature

**File:** `packages/inspect-components/src/transcript/timeline/hooks/useTranscriptTimeline.ts`

```ts
function useTranscriptTimeline(
  events, markerConfig, timelineOptions, serverTimelines, props
)
```

Five positional arguments with defaults and optionals in the middle. Hard to call correctly.

**Fix:** Single options object: `useTranscriptTimeline({ events, markerConfig?, timelineOptions?, ... })`.

### 5.8 Getter functions instead of values for collapse and URL state

`getCollapsed: (id: string) => boolean` and `getEventUrl: (id: string) => string | undefined` in `EventPanelCallbacks`. Function-over-value prevents clean hook dependency arrays and is non-idiomatic for React props. Would be resolved by the context approach in 5.1 — context values can be functions without the same prop-drilling downsides.

### 5.9 Naming inconsistencies in chat option types

| Current | Suggested | Reason |
|---------|-----------|--------|
| `ChatViewToolOptions.getCustomView` | `renderToolCall` | render prop convention |
| `ChatViewLabelOptions.values` | `messageLabels` | more descriptive |
| `ChatViewToolOptions.resolveIntoPreviousMessage` | `collapseToolMessages` | more concise |
| `ChatViewLinkingOptions.getUrl` | `getMessageUrl` | more specific |
| `topOffset` (chat) vs `offsetTop` (transcript) | pick one | inconsistent naming |

### 5.10 `id` required in `ChatViewVirtualList` but optional in `ChatView`

**Files:** `ChatViewVirtualList.tsx:32` vs `ChatView.tsx:17`

Asymmetric sibling API. Since `id` is used for DOM accessibility IDs in `ChatView`, it should probably be required in both.

---

## Priority 6: Performance

### 6.1 `maxlabelLen` computed inside every `ChatMessageRow` render

**File:** `packages/inspect-components/src/chat/ChatMessageRow.tsx:58-63`

```ts
// TODO: don't do this for every row
const maxlabelLen = labelValues
  ? Object.values(labelValues).reduce(...) : 3;
```

O(n labels) per O(n messages) = O(n^2). `labelValues` is the same object for every row.

**Fix:** Compute once in `ChatView` / `ChatViewVirtualListComponent` and pass `maxLabelLength` as a number prop.

### 6.2 `arraysEqual` in `useTimelineConfig` allocates on every render

**File:** `packages/inspect-components/src/transcript/timeline/hooks/useTimelineConfig.ts:59-64`

Two spread+sort operations per render to compare short `MarkerKind[]` arrays. Minor but pointless allocation.

**Fix:** Use Set-based comparison or type-specific helper without allocation.

### 6.3 `TimelineSwimLanes.header` object not memoized

**File:** `packages/inspect-components/src/transcript/TranscriptLayout.tsx:482-503`

`TranscriptLayout` constructs the `header` prop as an inline object literal in JSX on every render. This contains nested objects (`minimap`, `timelineConfig`, `timelineSelector`). `TimelineSwimLanes` receives a new object reference each render.

**Fix:** Memoize the `header` object or restructure to pass individual props.

---

## Priority 7: Test Coverage

### 7.1 Shared timeline hooks have no dedicated tests

**Missing tests for:**
- `useActiveTimeline` — empty timelines crash (1.2), index clamping, `setActive` out-of-range
- `useTimelineConfig` — smart defaults, `resetToDefaults`
- `useTranscriptTimeline` — branch scroll targets, `highlightedKeys`

Pure algorithmic modules (`core`, `markers`, `swimlaneRows`, etc.) are well covered. The hook integration layer is not.

### 7.2 `resolveIntoPreviousMessage: false` path has no test

The divergence between `ChatView` and `ChatViewVirtualListComponent` (bug 1.3) would be caught by a test that renders both paths with `resolveIntoPreviousMessage: false`.

---

## Priority 8: Design Observations (Non-Blocking)

### 8.1 `outlineAgentName` is presentation state in the data hook

**File:** `packages/inspect-components/src/transcript/timeline/hooks/useTranscriptTimeline.ts:284-292`

This display-layer string couples the data hook to knowledge of how the outline header renders. If the two apps need different labeling, they must both change the shared hook.

**Suggestion:** Expose `selectedRowName` or let each app derive the label from `state.rows` + `state.selected`.

### 8.2 Scout scanner `TranscriptPanel` bypasses `TranscriptLayout` entirely

**File:** `apps/scout/src/app/scannerResult/transcript/TranscriptPanel.tsx`

Uses `TranscriptViewNodes` directly — no swimlanes, outline, sticky scroll, or empty-state display. This may be intentional for the lightweight scanner context, but the decision is undocumented.

**Suggestion:** Add a comment explaining the intentional divergence.

### 8.3 `EventNodeContext` is a heterogeneous bag of per-app fields

**File:** `packages/inspect-components/src/transcript/types.ts:140-143`

`hasToolEvents` is set by scout; `turnInfo` is set by inspect. Neither app sets both. As new per-app context needs arise, this type will accumulate unrelated fields.

**Suggestion:** Consider discriminated union or per-app extension interface.

### 8.4 `useTimelineConfig` is not scoped — all samples share the same persistent state

All calls to `useTimelineConfig` read/write the same `useProperty("timeline", ...)` keys regardless of which sample or timeline is active. If a user enables "show branches" for one sample, it applies everywhere. This may be intentional (global preference), but it's worth documenting.

### 8.5 Inconsistent `display` options between apps

**File:** `apps/scout/src/app/transcript/TranscriptBody.tsx:304-315`

Inspect configures `ChatViewVirtualList` with `display={{ indented: true, unlabeledRoles: ["assistant"], formatDateTime }}`. Scout omits `display` entirely, resulting in different visual rendering of the Messages tab. If intentional, worth a comment.
