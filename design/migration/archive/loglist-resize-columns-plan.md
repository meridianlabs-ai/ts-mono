# Resizable DataGrid Columns — Implementation Plan

> **Status: Tasks 1–5 landed** on `loglist-tanstack-phase1` (resize engine + regular-header handle, rotated-header handle, non-resizable presentational columns, log-list per-scope width persistence, samples session-local width state). **Outstanding: Task 6 (drag-resize e2e) and Task 7 (manual parity sweep)** — tracked in `merge-punchlist.md` §2. Unchecked `- [ ]` boxes for Tasks 1–5 are stale, not pending.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add user-draggable column resizing to the shared inspect `DataGrid`, with the resize handle confined to the bottom divider band so it never conflicts with the angled score-headers, plus per-scope width persistence for the log list.

**Architecture:** Enable TanStack Table's native column sizing (`enableColumnResizing` + live `onChange` mode + controlled `columnSizing`) in the shared `DataGrid`. Render a per-column resize handle at each column's right edge, bottom-anchored to the divider band (full height in normal mode, the ~24px baseline strip in tall/rotated mode). The log list persists widths per `scopeKey` through the existing `gridStateByScope` store; the samples grid keeps widths in local component state for now.

**Tech Stack:** React 19, TypeScript, `@tanstack/react-table` 8.21, CSS modules, Vitest + `@testing-library/react` (unit), Playwright (e2e).

**Spec:** `design/migration/loglist-resize-columns-design.md`

---

## File structure

- `apps/inspect/src/app/shared/data-grid/DataGrid.tsx` — resize engine wiring + handle rendering (regular + rotated headers). *(modify)*
- `apps/inspect/src/app/shared/data-grid/DataGrid.module.css` — `.resizeHandle` + variants. *(modify)*
- `apps/inspect/src/app/shared/data-grid/DataGrid.resize.test.tsx` — unit tests for handle presence / `enableResizing`. *(create)*
- `apps/inspect/src/app/shared/samples-grid/columns.tsx` — mark `sampleStatus` / `displayIndex` non-resizable. *(modify)*
- `apps/inspect/src/app/shared/samples-grid/columns.test.tsx` — assert non-resizable columns. *(modify)*
- `apps/inspect/src/app/log-list/grid/columns/hooks.tsx` — mark `type` non-resizable. *(modify)*
- `apps/inspect/src/app/types.ts` — `LogListGridState.columnSizing`. *(modify)*
- `apps/inspect/src/app/log-list/grid/LogListGrid.tsx` — thread persisted `columnSizing`. *(modify)*
- `apps/inspect/src/app/shared/samples-grid/SamplesGrid.tsx` — local `columnSizing` state. *(modify)*
- `apps/inspect/e2e/top-level-views.spec.ts` — drag-resize + persistence e2e. *(modify)*

All commands run from `apps/inspect/` unless noted. Unit tests: `pnpm test`. Typecheck: `pnpm typecheck`. Lint one file: `node ./node_modules/eslint/bin/eslint.js -f stylish <path>`. e2e: `pnpm exec playwright test e2e/top-level-views.spec.ts`.

---

## Task 1: DataGrid resize engine + regular-header handle

**Files:**
- Modify: `apps/inspect/src/app/shared/data-grid/DataGrid.tsx`
- Modify: `apps/inspect/src/app/shared/data-grid/DataGrid.module.css`
- Test: `apps/inspect/src/app/shared/data-grid/DataGrid.resize.test.tsx` (create)

- [ ] **Step 1: Write the failing test**

Create `apps/inspect/src/app/shared/data-grid/DataGrid.resize.test.tsx`:

```tsx
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";

import type { ExtendedColumnDef } from "./columnTypes";
import { DataGrid } from "./DataGrid";

// Vitest globals aren't enabled in this app, so RTL's automatic afterEach
// cleanup never fires. Run it explicitly.
afterEach(cleanup);

interface Row {
  id: string;
  name: string;
}

const rows: Row[] = [{ id: "1", name: "alpha" }];

const columns: ExtendedColumnDef<Row>[] = [
  {
    id: "icon",
    header: "",
    size: 32,
    enableResizing: false,
    accessorFn: (r) => r.id,
    cell: ({ getValue }) => <div>{getValue<string>()}</div>,
  },
  {
    id: "name",
    header: "Name",
    size: 200,
    accessorFn: (r) => r.name,
    cell: ({ getValue }) => <div>{getValue<string>()}</div>,
  },
];

describe("DataGrid column resizing", () => {
  test("renders a resize handle only for resizable columns", () => {
    render(
      <DataGrid<Row>
        data={rows}
        columns={columns}
        getRowId={(r) => r.id}
        onRowActivate={() => {}}
      />
    );
    const handles = screen.getAllByRole("separator");
    expect(handles).toHaveLength(1);
    expect(screen.getByLabelText("Resize name")).toBeInTheDocument();
    expect(screen.queryByLabelText("Resize icon")).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test -- DataGrid.resize`
Expected: FAIL — no elements with role `separator` (handle not implemented yet).

- [ ] **Step 3: Add the sizing props + engine wiring**

In `DataGrid.tsx`, extend the `@tanstack/react-table` import to include `ColumnSizingState`:

```tsx
import {
  ColumnDef,
  ColumnSizingState,
  flexRender,
  getCoreRowModel,
  Header,
  OnChangeFn,
  SortingState,
  useReactTable,
  VisibilityState,
} from "@tanstack/react-table";
```

Add two props to `DataGridProps<TRow>` (next to `sorting`/`onSortingChange`):

```tsx
  /** Controlled column widths (keyed by column id). */
  columnSizing?: ColumnSizingState;
  onColumnSizingChange?: (sizing: ColumnSizingState) => void;
```

Add `columnSizing` and `onColumnSizingChange` to the destructured params (next to `sorting`, `onSortingChange`).

Just below the existing `handleSortingChange` `useCallback`, add an internal-fallback handler:

```tsx
  // Column sizing is controlled by the caller when `onColumnSizingChange` is
  // provided (log list persists per scope; samples keeps it in local state);
  // otherwise the grid manages it internally so resizing still works.
  const [internalSizing, setInternalSizing] = useState<ColumnSizingState>({});
  const effectiveSizing = columnSizing ?? internalSizing;
  const handleColumnSizingChange: OnChangeFn<ColumnSizingState> = useCallback(
    (updater) => {
      const next =
        typeof updater === "function" ? updater(effectiveSizing) : updater;
      if (onColumnSizingChange) onColumnSizingChange(next);
      else setInternalSizing(next);
    },
    [effectiveSizing, onColumnSizingChange]
  );
```

In the `useReactTable({...})` call, add resizing options and the sizing state:

```tsx
  const table = useReactTable({
    data,
    columns: columns as ColumnDef<TRow>[],
    getCoreRowModel: getCoreRowModel(),
    getRowId,
    manualSorting: true,
    enableMultiSort: true,
    enableSortingRemoval: true,
    enableColumnResizing: true,
    columnResizeMode: "onChange",
    state: {
      columnVisibility: columnVisibility ?? {},
      sorting: sorting ?? [],
      columnSizing: effectiveSizing,
    },
    onSortingChange: handleSortingChange,
    onColumnSizingChange: handleColumnSizingChange,
  });
```

Update the component doc comment that still says resizing is "layered on in later phases" — change that clause to "Sorting, filtering, keyboard navigation, and column resizing are wired; find and auto-fit are layered on later."

- [ ] **Step 4: Render the handle in the regular header cell**

In the regular (non-rotated) header render — the `<div ... role="columnheader">` block — add the handle as the **last child**, immediately after the `{filterControl && ( ... )}` block and before the cell's closing `</div>`:

```tsx
                    {header.column.getCanResize() && (
                      <div
                        role="separator"
                        aria-orientation="vertical"
                        aria-label={`Resize ${header.column.id}`}
                        className={clsx(
                          styles.resizeHandle,
                          anyRotated && styles.resizeHandleTall,
                          header.column.getIsResizing() &&
                            styles.resizeHandleActive
                        )}
                        onMouseDown={header.getResizeHandler()}
                        onTouchStart={header.getResizeHandler()}
                      />
                    )}
```

- [ ] **Step 5: Add the handle CSS**

Append to `DataGrid.module.css`:

```css
/* Column resize handle. A wide, invisible hit-strip straddling the column's
 * right edge; a subtle accent line shows on hover / while dragging. The strip
 * sits above cell content (z-index) and never triggers a sort (it is a sibling
 * of .headerContent, so its clicks don't reach the sort handler). */
.resizeHandle {
  position: absolute;
  top: 0;
  bottom: 0;
  right: -3px;
  width: 7px;
  cursor: col-resize;
  z-index: 2;
  touch-action: none;
  user-select: none;
}

.resizeHandle::after {
  content: "";
  position: absolute;
  top: 25%;
  bottom: 25%;
  left: 3px;
  width: 1px;
  background: var(--bs-primary);
  opacity: 0;
  transition: opacity 120ms ease;
}

.resizeHandle:hover::after,
.resizeHandleActive::after {
  opacity: 1;
}

/* Tall (rotated) mode: confine the hit-zone + accent line to the bottom
 * divider band so it stays off the angled labels above. */
.resizeHandleTall {
  top: auto;
  height: 24px;
}
.resizeHandleTall::after {
  top: 2px;
  bottom: 2px;
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `pnpm test -- DataGrid.resize`
Expected: PASS (1 separator, labelled "Resize name"; none for "icon").

- [ ] **Step 7: Typecheck + lint**

Run: `pnpm typecheck`
Run: `node ./node_modules/eslint/bin/eslint.js -f stylish src/app/shared/data-grid/DataGrid.tsx`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add apps/inspect/src/app/shared/data-grid/DataGrid.tsx \
        apps/inspect/src/app/shared/data-grid/DataGrid.module.css \
        apps/inspect/src/app/shared/data-grid/DataGrid.resize.test.tsx
git commit -m "viewer(data-grid): add column resize engine + regular-header handle"
```

---

## Task 2: Resize handle for rotated headers

**Files:**
- Modify: `apps/inspect/src/app/shared/data-grid/DataGrid.tsx` (the `RotatedHeaderCell` component)
- Modify: `apps/inspect/src/app/shared/data-grid/DataGrid.module.css`
- Test: `apps/inspect/src/app/shared/data-grid/DataGrid.resize.test.tsx`

- [ ] **Step 1: Add a failing test for the rotated handle**

Add to `DataGrid.resize.test.tsx` (inside the existing `describe`):

```tsx
  test("renders a resize handle for a rotated (compact score) header", () => {
    const rotatedCols: ExtendedColumnDef<Row>[] = [
      {
        id: "score",
        header: "Score",
        size: 40,
        meta: { rotateHeader: true },
        accessorFn: (r) => r.name,
        cell: ({ getValue }) => <div>{getValue<string>()}</div>,
      },
    ];
    render(
      <DataGrid<Row>
        data={rows}
        columns={rotatedCols}
        getRowId={(r) => r.id}
        onRowActivate={() => {}}
      />
    );
    expect(screen.getByLabelText("Resize score")).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test -- DataGrid.resize`
Expected: FAIL — "Resize score" not found (rotated cell has no handle yet).

- [ ] **Step 3: Render the handle in `RotatedHeaderCell`**

In the `RotatedHeaderCell` component, add the handle as the **last child** of the outer `<div ... role="columnheader">`, immediately after the `<span ref={setAnchorEl} className={styles.rotatedFilterAnchor} aria-hidden="true" />`:

```tsx
      {header.column.getCanResize() && (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label={`Resize ${header.column.id}`}
          className={clsx(
            styles.resizeHandle,
            styles.resizeHandleRotated,
            header.column.getIsResizing() && styles.resizeHandleActive
          )}
          onMouseDown={header.getResizeHandler()}
          onTouchStart={header.getResizeHandler()}
        />
      )}
```

- [ ] **Step 4: Add the rotated-handle CSS**

Append to `DataGrid.module.css`:

```css
/* Rotated header cells are pointer-events: none; re-enable it on the handle
 * and pin it to the cell's bottom-right corner (below the diagonal label), so
 * resizing lives in the divider band and the angled label stays clickable. */
.resizeHandleRotated {
  top: auto;
  bottom: 0;
  height: 24px;
  pointer-events: auto;
}
.resizeHandleRotated::after {
  top: 2px;
  bottom: 2px;
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm test -- DataGrid.resize`
Expected: PASS (both tests green).

- [ ] **Step 6: Typecheck + lint**

Run: `pnpm typecheck`
Run: `node ./node_modules/eslint/bin/eslint.js -f stylish src/app/shared/data-grid/DataGrid.tsx`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add apps/inspect/src/app/shared/data-grid/DataGrid.tsx \
        apps/inspect/src/app/shared/data-grid/DataGrid.module.css \
        apps/inspect/src/app/shared/data-grid/DataGrid.resize.test.tsx
git commit -m "viewer(data-grid): add resize handle to rotated headers (off the labels)"
```

---

## Task 3: Mark presentational columns non-resizable

**Files:**
- Modify: `apps/inspect/src/app/shared/samples-grid/columns.tsx`
- Modify: `apps/inspect/src/app/shared/samples-grid/columns.test.tsx`
- Modify: `apps/inspect/src/app/log-list/grid/columns/hooks.tsx`

- [ ] **Step 1: Write the failing test**

Add to `apps/inspect/src/app/shared/samples-grid/columns.test.tsx` (new `describe` at the end of the file):

```tsx
describe("buildSampleColumns non-resizable columns", () => {
  it("marks the status-icon and index columns non-resizable", () => {
    const cols = buildSampleColumns({ viewMode: "grid", multiLog: true });
    expect(cols.find((c) => c.id === "sampleStatus")?.enableResizing).toBe(
      false
    );
    expect(cols.find((c) => c.id === "displayIndex")?.enableResizing).toBe(
      false
    );
    // A normal text column stays resizable (undefined => default true).
    expect(cols.find((c) => c.id === "sampleId")?.enableResizing).not.toBe(
      false
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test -- samples-grid/columns`
Expected: FAIL — `sampleStatus`/`displayIndex` `enableResizing` is `undefined`, not `false`.

- [ ] **Step 3: Mark the samples columns non-resizable**

In `apps/inspect/src/app/shared/samples-grid/columns.tsx`:

In the `displayIndex` column def (the `multiLog` `#` column), add `enableResizing: false` next to its existing `enableSorting: false`:

```tsx
      enableSorting: false,
      enableResizing: false,
```

In the `sampleStatus` column def, add `enableResizing: false` next to its existing `enableSorting: false`:

```tsx
    enableSorting: false,
    enableResizing: false,
```

- [ ] **Step 4: Mark the log-list `type` column non-resizable**

In `apps/inspect/src/app/log-list/grid/columns/hooks.tsx`, in the `type` column def (the icon column with `size: 32`), add `enableResizing: false` (place it just after `maxSize: 32,`):

```tsx
        id: "type",
        header: "",
        size: 32,
        minSize: 32,
        maxSize: 32,
        enableResizing: false,
        meta: { align: "center" },
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm test -- samples-grid/columns`
Expected: PASS.

- [ ] **Step 6: Typecheck + lint**

Run: `pnpm typecheck`
Run: `node ./node_modules/eslint/bin/eslint.js -f stylish src/app/shared/samples-grid/columns.tsx src/app/log-list/grid/columns/hooks.tsx`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add apps/inspect/src/app/shared/samples-grid/columns.tsx \
        apps/inspect/src/app/shared/samples-grid/columns.test.tsx \
        apps/inspect/src/app/log-list/grid/columns/hooks.tsx
git commit -m "viewer(data-grid): make icon/index columns non-resizable"
```

---

## Task 4: Log-list per-scope width persistence

**Files:**
- Modify: `apps/inspect/src/app/types.ts`
- Modify: `apps/inspect/src/app/log-list/grid/LogListGrid.tsx`

- [ ] **Step 1: Extend `LogListGridState`**

In `apps/inspect/src/app/types.ts`, add `columnSizing` to the `LogListGridState` interface:

```tsx
export interface LogListGridState {
  sorting: SortingState;
  /** Active per-column filters, keyed by column id. */
  columnFilters?: Record<string, ColumnFilter>;
  /** User-resized column widths, keyed by column id. */
  columnSizing?: Record<string, number>;
}
```

- [ ] **Step 2: Read persisted sizing in `LogListGrid`**

In `apps/inspect/src/app/log-list/grid/LogListGrid.tsx`, just after the `columnFilters` memo (the `const columnFilters = useMemo(...)` block), add:

```tsx
  // Per-scope persisted column widths.
  const columnSizing = useMemo(
    () => (scopeKey ? gridStateByScope[scopeKey]?.columnSizing : undefined),
    [gridStateByScope, scopeKey]
  );
```

- [ ] **Step 3: Preserve `columnSizing` in the existing handlers + add its own**

Replace `handleSortingChange` and `handleColumnFilterChange` so they carry `columnSizing` through (recall `setGridState` replaces the whole `LogListGridState`), and add `handleColumnSizingChange`:

```tsx
  const handleSortingChange = useCallback(
    (next: SortingState) => {
      if (scopeKey)
        setGridState(scopeKey, {
          sorting: next,
          columnFilters,
          columnSizing,
        });
    },
    [scopeKey, setGridState, columnFilters, columnSizing]
  );

  const handleColumnFilterChange = useCallback(
    (
      columnId: string,
      filterType: FilterType,
      condition: SimpleCondition | null
    ) => {
      if (!scopeKey) return;
      const next: Record<string, ColumnFilter> = { ...columnFilters };
      if (condition === null) {
        delete next[columnId];
      } else {
        next[columnId] = { columnId, filterType, condition };
      }
      setGridState(scopeKey, { sorting, columnFilters: next, columnSizing });
    },
    [scopeKey, setGridState, sorting, columnFilters, columnSizing]
  );

  const handleColumnSizingChange = useCallback(
    (next: Record<string, number>) => {
      if (scopeKey)
        setGridState(scopeKey, { sorting, columnFilters, columnSizing: next });
    },
    [scopeKey, setGridState, sorting, columnFilters]
  );
```

- [ ] **Step 4: Pass sizing to the DataGrid**

In the `<DataGrid ...>` JSX, add the two sizing props (next to `onColumnFilterChange`):

```tsx
          columnSizing={columnSizing}
          onColumnSizingChange={handleColumnSizingChange}
```

- [ ] **Step 5: Typecheck + lint**

Run: `pnpm typecheck`
Run: `node ./node_modules/eslint/bin/eslint.js -f stylish src/app/types.ts src/app/log-list/grid/LogListGrid.tsx`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/inspect/src/app/types.ts apps/inspect/src/app/log-list/grid/LogListGrid.tsx
git commit -m "viewer(log-list): persist column widths per scope"
```

---

## Task 5: Samples grid session-local width state

**Files:**
- Modify: `apps/inspect/src/app/shared/samples-grid/SamplesGrid.tsx`

- [ ] **Step 1: Add local sizing state**

In `apps/inspect/src/app/shared/samples-grid/SamplesGrid.tsx`, extend the `@tanstack/react-table` type import to include `ColumnSizingState`:

```tsx
import type { ColumnSizingState, SortingState } from "@tanstack/react-table";
```

Next to the existing `const [sorting, setSorting] = useState<SortingState>(...)`, add:

```tsx
  const [columnSizing, setColumnSizing] = useState<ColumnSizingState>({});
```

- [ ] **Step 2: Pass sizing to the DataGrid**

In the `<DataGrid ...>` JSX, add (next to `onColumnFilterChange`):

```tsx
      columnSizing={columnSizing}
      onColumnSizingChange={setColumnSizing}
```

- [ ] **Step 3: Typecheck + lint**

Run: `pnpm typecheck`
Run: `node ./node_modules/eslint/bin/eslint.js -f stylish src/app/shared/samples-grid/SamplesGrid.tsx`
Expected: no errors.

- [ ] **Step 4: Run the full unit suite**

Run: `pnpm test`
Expected: all green (previously 454 + new resize/columns tests).

- [ ] **Step 5: Commit**

```bash
git add apps/inspect/src/app/shared/samples-grid/SamplesGrid.tsx
git commit -m "viewer(samples): keep resized column widths for the session"
```

---

## Task 6: e2e — drag resize + persistence across navigation

**Files:**
- Modify: `apps/inspect/e2e/top-level-views.spec.ts`

- [ ] **Step 1: Write the drag-resize e2e**

Append to `apps/inspect/e2e/top-level-views.spec.ts` (the file already defines `setupHandlers`, `taskCell`, and imports `expect, test`). Add a helper + two tests at the end:

```ts
// Drag a column's resize separator by `dx` px.
async function dragResize(
  page: Parameters<Parameters<typeof test>[2]>[0]["page"],
  columnId: string,
  dx: number
) {
  const handle = page.getByLabel(`Resize ${columnId}`);
  const box = await handle.boundingBox();
  if (!box) throw new Error(`no resize handle for ${columnId}`);
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + dx, cy, { steps: 8 });
  await page.mouse.up();
}

test("resizes a column by dragging its divider", async ({ page, network }) => {
  setupHandlers(network);
  await page.goto("/");
  const header = page.locator(
    '[role="columnheader"]:has([aria-label="Resize task"])'
  );
  await expect(header).toBeVisible();
  const before = (await header.boundingBox())!.width;
  await dragResize(page, "task", 120);
  const after = (await header.boundingBox())!.width;
  expect(after).toBeGreaterThan(before + 60);
});

test("keeps a resized width after navigating into a log and back", async ({
  page,
  network,
}) => {
  setupHandlers(network);
  await page.goto("/");
  const header = page.locator(
    '[role="columnheader"]:has([aria-label="Resize task"])'
  );
  await expect(header).toBeVisible();
  await dragResize(page, "task", 120);
  const resized = (await header.boundingBox())!.width;

  // Into a log and back — the grid remounts on the same scope and should
  // re-read the persisted width from the store (in-memory within the session).
  await taskCell(page, "task-alpha").click();
  await expect(page).toHaveURL(/#\/tasks\/.+/);
  await page.goBack();

  const restored = (await header.boundingBox())!.width;
  expect(Math.abs(restored - resized)).toBeLessThan(3);
});
```

- [ ] **Step 2: Run the e2e**

Run: `pnpm exec playwright test e2e/top-level-views.spec.ts`
Expected: all tests pass, including the two new ones. (If Chromium is missing: `pnpm exec playwright install chromium`.)

- [ ] **Step 3: Commit**

```bash
git add apps/inspect/e2e/top-level-views.spec.ts
git commit -m "viewer(data-grid): e2e for column resize + width persistence"
```

---

## Task 7: Manual verification & parity sweep

No code — verify against the running app (branch on `:5173`, main on `:5174`) and confirm:

- [ ] Drag a divider on the log-list (Tasks) view — width changes live; release keeps it; switching folder scope and back keeps it.
- [ ] On the samples grid with compact/rotated score headers: the resize handle sits in the bottom divider band; the angled labels above remain fully clickable (sort still fires when you click a label); resizing a score column works.
- [ ] Non-resizable columns (`type`, `sampleStatus`, `#`) show no resize cursor / handle.
- [ ] Reload in a plain browser resets widths to defaults (expected — persistence is VS Code-only), while in-session navigation preserves log-list widths.
- [ ] Run `pnpm typecheck && pnpm lint && pnpm format:check && pnpm test` — all clean.

---

## Self-review notes

- **Spec coverage:** engine (T1) · Option-A handle regular (T1) + rotated (T2) · non-resizable columns (T3) · log-list persistence (T4) · samples session-local (T5) · testing unit (T1–T3) + e2e (T6) + manual (T7). Auto-fit / store-backed samples / double-click-autofit remain deferred per spec.
- **Type consistency:** `ColumnSizingState` (= `Record<string, number>`) used in DataGrid props and SamplesGrid; `LogListGridState.columnSizing` typed `Record<string, number>` (assignable to the prop). `handleColumnSizingChange` signatures match the `onColumnSizingChange?: (sizing: ColumnSizingState) => void` prop.
- **No placeholders:** every step has concrete code/commands.
