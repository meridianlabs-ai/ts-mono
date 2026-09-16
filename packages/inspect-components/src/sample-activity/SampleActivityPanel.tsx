import clsx from "clsx";
import { FC, MouseEvent as ReactMouseEvent, RefObject, useState } from "react";

import type { Event } from "@tsmono/inspect-common/types";
import { SegmentedControl } from "@tsmono/react/components";
import { useProperty } from "@tsmono/react/hooks";
import { isRecord, nullProtoRecord } from "@tsmono/util";

import { ActivityChart } from "./ActivityChart";
import {
  ActivityCategory,
  deriveActivityData,
  kActivityCategories,
} from "./activityData";
import { ActivityHistoryList } from "./ActivityHistoryList";
import styles from "./SampleActivityPanel.module.css";

/** Property bag for the Activity tab's durable UI state, keyed per sample. */
export const kSampleActivityBag = "sample-activity";

// Stable empty arrays — a fresh identity would re-render every row.
const kNoKeys: string[] = [];
const kNoCategories: ActivityCategory[] = [];
const kNoOverrides: Record<string, boolean> = {};

// ── persisted-state guards ───────────────────────────────────────────────
// The property bag holds whatever an earlier build, another surface or a
// hand-edited store wrote under these keys. A value of the wrong shape
// would throw on every mount of this sample's Activity view (and persist),
// so each read narrows an `unknown` and falls back instead of trusting the
// generic. Unknown ids are dropped rather than kept: a stale category id
// would otherwise silently filter out every row.

const kCategoryIds = new Set<string>(kActivityCategories);
const isCategory = (value: unknown): value is ActivityCategory =>
  typeof value === "string" && kCategoryIds.has(value);
const isString = (value: unknown): value is string => typeof value === "string";

const readOverrides = (raw: unknown): Record<string, boolean> | undefined => {
  if (!isRecord(raw)) return undefined;
  const entries = new Map<string, boolean>();
  for (const [id, on] of Object.entries(raw)) {
    if (typeof on === "boolean") entries.set(id, on);
  }
  return nullProtoRecord(entries);
};
const readAxis = (raw: unknown): AxisMode | undefined =>
  raw === "wall" || raw === "turns" ? raw : undefined;
const readSort = (raw: unknown): "asc" | "desc" | undefined =>
  raw === "asc" || raw === "desc" ? raw : undefined;
const readStrings = (raw: unknown): string[] | undefined =>
  Array.isArray(raw) ? raw.filter(isString) : undefined;
const readCategories = (raw: unknown): ActivityCategory[] | undefined =>
  Array.isArray(raw) ? raw.filter(isCategory) : undefined;
const readString = (raw: unknown): string | undefined =>
  typeof raw === "string" ? raw : undefined;
const readSelection = (raw: unknown): string | null | undefined =>
  typeof raw === "string" || raw === null ? raw : undefined;

/** A durable property read through a guard: malformed or absent values
 *  read as `fallback`; writes stay typed. */
const usePersisted = <T,>(
  name: string,
  scope: string,
  read: (raw: unknown) => T | undefined,
  fallback: T
): [T, (value: T) => void] => {
  const [raw, setRaw] = useProperty<unknown>(
    kSampleActivityBag,
    `${name}:${scope}`
  );
  const value = read(raw);
  return [value === undefined ? fallback : value, setRaw];
};

export interface SampleActivityPanelProps {
  events: Event[];
  startedAt?: string | null;
  completedAt?: string | null;
  workingTime?: number | null;
  totalTime?: number | null;
  /** Live sample — pending spans render open-ended to now. */
  running?: boolean;
  /** The tab's scroll container — the history list virtualizes against it. */
  scrollRef: RefObject<HTMLDivElement | null>;
  /** Durable-state scope (log + sample identity) for the property bag. */
  persistScope: string;
  /** Click-through to the Transcript via event uuid. */
  onOpenEvent?: (uuid: string, event: ReactMouseEvent) => void;
}

/** X axis: wall clock, or one equal-width column per model turn (8b). */
export type AxisMode = "wall" | "turns";

interface BandChipProps {
  label: string;
  on: boolean;
  onToggle: () => void;
}

const BandChip: FC<BandChipProps> = ({ label, on, onToggle }) => (
  <button
    type="button"
    className={clsx(styles.bandChip, on && styles.bandChipOn)}
    onClick={onToggle}
  >
    {on ? <i className="bi bi-check" aria-hidden="true" /> : null}
    {label}
  </button>
);

interface AxisToggleProps {
  mode: AxisMode;
  onChange: (mode: AxisMode) => void;
}

const kAxisSegments = [
  { id: "wall", label: "Wall clock" },
  { id: "turns", label: "Turns" },
];

// The wrapper only adds the group label and right-aligns the shared control.
const AxisToggle: FC<AxisToggleProps> = ({ mode, onChange }) => (
  <div className={styles.axisToggle} role="group" aria-label="X axis">
    <SegmentedControl
      segments={kAxisSegments}
      selectedId={mode}
      onSegmentChange={(id) => {
        const next = readAxis(id);
        if (next) onChange(next);
      }}
    />
  </div>
);

// Durable UI state (band overrides, filters, search, sort, selection) lives
// in the property bag keyed per sample — the tab unmounts on tab switches.
// Keying the body per sample resets the transient state (hover links,
// popovers, window filter) when the sample in view changes.
export const SampleActivityPanel: FC<SampleActivityPanelProps> = (props) => (
  <SampleActivityPanelBody key={props.persistScope} {...props} />
);

const SampleActivityPanelBody: FC<SampleActivityPanelProps> = ({
  events,
  startedAt,
  completedAt,
  workingTime,
  totalTime,
  running = false,
  scrollRef,
  persistScope,
  onOpenEvent,
}) => {
  // `now` deliberately defaults to the latest event timestamp inside the
  // derivation: live samples re-render as polling delivers new events, so
  // the open edge advances with the data (and render stays pure).
  const data = deriveActivityData({
    events,
    startedAt,
    completedAt,
    workingTime,
    totalTime,
    running,
  });

  // ── band picker (curated default-on set, handoff decision 1) ─────────
  const [bandOverrides, setBandOverrides] = usePersisted(
    "bands",
    persistScope,
    readOverrides,
    kNoOverrides
  );
  const bandOn = (id: string, fallback: boolean): boolean =>
    bandOverrides[id] ?? fallback;
  const toggleBand = (id: string, fallback: boolean) => {
    setBandOverrides({ ...bandOverrides, [id]: !bandOn(id, fallback) });
  };

  // X axis (handoff 8a/8b): wall clock by default; Turns tiles one column
  // per model turn. Persisted beside the band overrides.
  const [axisMode, setAxisMode] = usePersisted(
    "axis",
    persistScope,
    readAxis,
    "wall"
  );
  // Turns without a single turn (zero-ModelEvent sample) has nothing to
  // tile — the chart falls back to the wall clock.
  const turnsMode = axisMode === "turns" && data.turns.length > 0;

  // Default-on set (handoff 8a): activity, context, token burn, markers;
  // working/waiting is the opt-in band. No working clock (mid-vintage
  // logs) → no working band at all; an all-zero clock would render the
  // whole run as waiting. Waiting has no extent on the Turns axis, so the
  // band and its chip hide there regardless of the override; the override
  // is kept so Wall clock restores the previous state.
  const showModelTool = bandOn("modelTool", true) && data.agentRows.length > 0;
  const showContext = bandOn("context", true) && data.contextSeries.length > 0;
  const showTokens = bandOn("tokens", true) && data.tokenSeries.length > 0;
  const showMarkers = bandOn("markers", true) && data.markers.length > 0;
  const showWorking =
    bandOn("working", false) && data.hasWorkingSignal && !turnsMode;

  // Agent gutter checkboxes (handoff 10a) — hidden conversation ids. Ids
  // no conversation in this sample carries are stale and drop out.
  const [storedHiddenIds, setHiddenAgentIds] = usePersisted(
    "agents",
    persistScope,
    readStrings,
    kNoKeys
  );
  const hiddenAgentIds = storedHiddenIds.filter((id) =>
    data.agentRows.some((row) => row.id === id)
  );
  const toggleAgent = (id: string) => {
    setHiddenAgentIds(
      hiddenAgentIds.includes(id)
        ? hiddenAgentIds.filter((existing) => existing !== id)
        : [...hiddenAgentIds, id]
    );
  };

  // ── history filters (array, not Set — store persistence) ─────────────
  const [categoryList, setCategoryList] = usePersisted(
    "filters",
    persistScope,
    readCategories,
    kNoCategories
  );
  const selectedCategories = new Set(categoryList);
  const toggleCategory = (category: ActivityCategory | "all") => {
    if (category === "all") {
      setCategoryList([]);
      return;
    }
    setCategoryList(
      categoryList.includes(category)
        ? categoryList.filter((existing) => existing !== category)
        : [...categoryList, category]
    );
  };

  const [search, setSearch] = usePersisted(
    "search",
    persistScope,
    readString,
    ""
  );
  // Time sort: descending by default while the sample is running so new
  // events land at the top. The default is frozen at first view (a sample
  // completing mid-view must not flip the list under the user).
  const [timeSort, setTimeSort] = usePersisted(
    "sort",
    persistScope,
    readSort,
    undefined
  );
  const [initialRunning] = useState(running);
  const timeDescending = timeSort ? timeSort === "desc" : initialRunning;

  const [selectedKey, setSelectedKey] = usePersisted(
    "selected",
    persistScope,
    readSelection,
    null
  );

  // Bidirectional glyph ↔ row hover link (transient).
  const [hoverLink, setHoverLink] = useState<{
    source: "marker" | "row";
    keys: string[];
  } | null>(null);

  if (!data.window) {
    return null;
  }

  return (
    <div className={styles.container}>
      <div className={styles.pickerRow}>
        <span className={styles.caption}>Activity</span>
        {data.agentRows.length > 0 && (
          <BandChip
            label="Model & tool activity"
            on={showModelTool}
            onToggle={() => toggleBand("modelTool", true)}
          />
        )}
        {data.contextSeries.length > 0 && (
          <BandChip
            label="Context size"
            on={showContext}
            onToggle={() => toggleBand("context", true)}
          />
        )}
        {data.tokenSeries.length > 0 && (
          <BandChip
            label="Token burn"
            on={showTokens}
            onToggle={() => toggleBand("tokens", true)}
          />
        )}
        {data.markers.length > 0 && (
          <BandChip
            label="Markers"
            on={showMarkers}
            onToggle={() => toggleBand("markers", true)}
          />
        )}
        {data.hasWorkingSignal && !turnsMode && (
          <BandChip
            label="Working time"
            on={bandOn("working", false)}
            onToggle={() => toggleBand("working", false)}
          />
        )}
        {showWorking && (
          <span className={styles.legend}>
            <span className={styles.legendSwatch} /> working time · gap =
            waiting
          </span>
        )}
        <AxisToggle mode={axisMode} onChange={setAxisMode} />
      </div>
      <ActivityChart
        data={data}
        window={data.window}
        showWorking={showWorking}
        showMarkers={showMarkers}
        showTokens={showTokens}
        showContext={showContext}
        showModelTool={showModelTool}
        hiddenAgentIds={hiddenAgentIds}
        onToggleAgent={toggleAgent}
        axisMode={turnsMode ? "turns" : "wall"}
        selectedKey={selectedKey}
        hoveredRowKey={
          hoverLink?.source === "row" ? (hoverLink.keys[0] ?? null) : null
        }
        onHoverMarker={(keys) =>
          setHoverLink(
            keys && keys.length > 0 ? { source: "marker", keys } : null
          )
        }
        onOpenEvent={onOpenEvent}
      />
      <ActivityHistoryList
        rows={data.rows}
        scrollRef={scrollRef}
        persistenceKey={`sample-activity-history:${persistScope}`}
        selectedCategories={selectedCategories}
        onToggleCategory={toggleCategory}
        search={search}
        onSearchChange={setSearch}
        timeDescending={timeDescending}
        onToggleTimeSort={() => setTimeSort(timeDescending ? "asc" : "desc")}
        selectedKey={selectedKey}
        onSelectKey={setSelectedKey}
        washKeys={hoverLink?.source === "marker" ? hoverLink.keys : kNoKeys}
        onHoverRow={(key) =>
          setHoverLink(key !== null ? { source: "row", keys: [key] } : null)
        }
        onOpenEvent={onOpenEvent}
      />
    </div>
  );
};
