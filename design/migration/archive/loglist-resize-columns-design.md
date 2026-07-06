# DataGrid: user-resizable columns

**Date:** 2026-07-01
**Status:** Implemented — the column-resizing half (plan Tasks 1–5) landed; e2e + manual sweep outstanding (see `loglist-resize-columns-plan.md`). Auto-fit-to-grid-width stays deferred.
**Related:** `design/migration/loglistgrid-tanstack.md` (Phase 6 — Layout fit). This spec covers the **column-resizing** half of Phase 6; **auto-fit-to-grid-width** stays deferred.

## Context & goal

The shared inspect `DataGrid` (`apps/inspect/src/app/shared/data-grid/`) currently renders **fixed column widths** (`column.size`) with horizontal scroll and no resizing. On main (AG grid) users can drag column dividers to resize. This spec adds user-draggable resizing to the DataGrid — benefiting both the log list and the samples grid — while keeping the fixed-width + horizontal-scroll model (auto-fit is a separate, deferred effort).

The resize handle must not conflict with the **rotated (compact score) headers**. On main, each column's resize hit-zone is a full-height vertical band at its right edge; in the tall rotated-header row that band runs the full height and overlaps the neighbouring 45° labels, creating a dead-zone where clicks that look like they should hit a label instead grab the resize handle. We fix that.

## Decisions

1. **Layout model:** keep fixed widths + horizontal scroll. Auto-fit-to-grid-width deferred.
2. **Handle placement (Option A — "grab the divider"):** the resize grabber is confined to the **bottom divider band** at each column's right edge — the same short strip where the divider line now sits (see the tall-mode divider work in `DataGrid.module.css`). In normal mode that's effectively the full (short) header height; in tall/rotated mode it's the bottom ~24px strip, leaving the angled labels above fully clickable.
3. **Persistence:**
   - **Log list:** store-backed per `scopeKey` — extend `LogListGridState` with `columnSizing`, mirroring how `sorting`/`columnFilters` already persist via `gridStateByScope`.
   - **Samples grid:** session-local (component state) for now. See "Follow-up" — full store-backed samples grid-state (widths + sort + filter, matching main) is the next focused effort.

> **Note on what "persist" means here.** The zustand store's persistence backend (`client/storage/index.ts`) is **VS Code-only** (`vscodeApi.getState/setState`); in a plain browser it's `undefined`, so nothing in the store survives a page reload. What store-backed state buys in *both* environments is surviving **in-session navigation** (scope/folder/tab switches). So log-list widths will survive scope switches everywhere and reloads in VS Code; samples widths (session-local) reset whenever the grid remounts.

## Design

### 1. DataGrid engine (`DataGrid.tsx`)

Enable TanStack's native column sizing:

- `useReactTable`: `enableColumnResizing: true`, `columnResizeMode: "onChange"` (live drag), controlled `columnSizing` state via a new optional prop + `onColumnSizingChange` callback so callers persist.
- Widths already render from `header.getSize()` / `cell.column.getSize()`, which TanStack updates during a drag, so the fixed-width layout updates live. Each column's existing `minSize`/`maxSize` is respected by TanStack.
- New props (all optional, controlled like `sorting`):
  - `columnSizing?: Record<string, number>`
  - `onColumnSizingChange?: (sizing: Record<string, number>) => void`
  - When `onColumnSizingChange` is omitted, the grid still resizes using internal state (samples grid can pass local state; a fully-uncontrolled fallback is acceptable).

### 2. The resize handle (Option A)

A per-column grabber rendered inside each **resizable** header cell:

- Absolutely positioned at the cell's **right edge**, `bottom: 0`, height = the divider band: full header height in normal mode, `~24px` in tall/rotated mode (reuse the `anyRotated` signal already in `DataGrid`).
- ~8px hit width (centered on the edge), `cursor: col-resize`; invisible at rest, subtle line on hover; optional guide line while actively dragging (`table.getState().columnSizingInfo.isResizingColumn`).
- Wired to `header.getResizeHandler()` on `onMouseDown`/`onTouchStart`. `onClick`/`onMouseDown` call `stopPropagation()` so a drag never triggers the header's sort handler.
- **Rotated headers:** the outer `.headerCellRotated` is `pointer-events: none`, so the handle is a sibling of `.rotatedLabel` with `pointer-events: auto`, pinned bottom-right. It sits *below* the diagonal label (which keeps owning sort + filter), so labels stay fully clickable.

### 3. CSS (`DataGrid.module.css`)

- `.resizeHandle` — right-edge, bottom-anchored, transparent, `cursor: col-resize`, hover shows a 1px accent line; a `.resizeHandleTall` (or reuse of the tall-mode signal) clamps the height to the ~24px divider band so it aligns with the shortened divider.
- Optional `.resizing` guide-line style keyed off `columnSizingInfo`.

### 4. Non-resizable columns

Mark fixed presentational columns `enableResizing: false` (TanStack native) so they render no handle:
- Log list: `type` (icon column, already min=max=32).
- Samples: `sampleStatus` and `displayIndex`.

### 5. Persistence wiring

- **Log list:** add `columnSizing?: Record<string, number>` to `LogListGridState` (`app/types.ts`). `LogListGrid` reads persisted sizing for the active `scopeKey` from `gridStateByScope`, passes it as controlled `columnSizing`, and on change calls `setGridState(scopeKey, { ...prev, columnSizing })` — the same path `sorting`/`columnFilters` already use in `LogListGrid`/`LogsPanel`.
- **Samples grid:** `SamplesGrid` holds `columnSizing` in local `useState` and passes it down; no store wiring in this cut.

### 6. Interaction details

- Live resize (`onChange`), respecting min/max.
- Handle drag never sorts (stopPropagation).
- Double-click-to-autofit-content: **deferred** (YAGNI).

## Testing

- **Unit (`DataGrid`):** handle renders for resizable columns and is absent when `enableResizing: false`; invoking the resize handler updates `columnSizing` / fires `onColumnSizingChange`. (jsdom lacks layout, so assert wiring, not pixel drag.)
- **e2e:** drag a header divider and assert the column width changes; for the log list, assert width survives a scope switch (in-session persistence). Keep `top-level-views.spec.ts` and the samples e2e green.

## Files touched

- `apps/inspect/src/app/shared/data-grid/DataGrid.tsx` + `DataGrid.module.css` — resize wiring + handle + CSS.
- `apps/inspect/src/app/log-list/grid/columns/hooks.tsx` — `type` → `enableResizing: false`.
- `apps/inspect/src/app/shared/samples-grid/columns.tsx` — `sampleStatus`/`displayIndex` → `enableResizing: false`.
- `apps/inspect/src/app/types.ts` — `LogListGridState.columnSizing`.
- `apps/inspect/src/app/log-list/grid/LogListGrid.tsx` + `log-list/LogsPanel.tsx` — thread persisted `columnSizing`.
- `apps/inspect/src/app/shared/samples-grid/SamplesGrid.tsx` — local `columnSizing` state.

## Deferred / follow-ups

- **Auto-fit-to-grid-width** (Phase 6's other half) + user-resize-override suppression.
- **Store-backed samples grid-state** — widths + sort + filter persisted per scope via `useSamplesView` (single-log) / `useSampleGridState` (cross-log), matching main. Lands widths, sort, and filter together coherently.
- **Double-click divider → autofit-to-content.**
