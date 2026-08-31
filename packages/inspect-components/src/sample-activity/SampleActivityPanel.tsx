import clsx from "clsx";
import {
  FC,
  MouseEvent as ReactMouseEvent,
  RefObject,
  useRef,
  useState,
} from "react";

import type { Event } from "@tsmono/inspect-common/types";
import { useProperty } from "@tsmono/react/hooks";

import { ActivityChart } from "./ActivityChart";
import {
  ActivityCategory,
  deriveActivityData,
  rowHaystack,
  TimeWindow,
} from "./activityData";
import {
  ActivityHistoryList,
  type ActivityHistoryListHandle,
} from "./ActivityHistoryList";
import styles from "./SampleActivityPanel.module.css";

/** Property bag for the Activity tab's durable UI state, keyed per sample. */
export const kSampleActivityBag = "sample-activity";

// Stable empty arrays — a fresh identity would re-render every row.
const kNoKeys: string[] = [];
const kNoCategories: ActivityCategory[] = [];

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
  const [bandOverrides, setBandOverrides] = useProperty<
    Record<string, boolean>
  >(kSampleActivityBag, `bands:${persistScope}`, { defaultValue: {} });
  const bandOn = (id: string, fallback: boolean): boolean =>
    bandOverrides[id] ?? fallback;
  const toggleBand = (id: string, fallback: boolean) => {
    setBandOverrides({ ...bandOverrides, [id]: !bandOn(id, fallback) });
  };

  // No working clock (mid-vintage logs) → no working band at all; an
  // all-zero clock would render the whole run as waiting.
  const showWorking = bandOn("working", true) && data.hasWorkingSignal;
  const showMarkers = bandOn("markers", true) && data.markers.length > 0;
  const showTokens = bandOn("tokens", true) && data.tokenSeries.length > 0;
  const showContext = bandOn("context", false) && data.contextSeries.length > 0;
  const showModelTool = bandOn("modelTool", false) && data.agentRows.length > 0;

  // ── history filters (array, not Set — store persistence) ─────────────
  const [categoryList, setCategoryList] = useProperty<ActivityCategory[]>(
    kSampleActivityBag,
    `filters:${persistScope}`,
    { defaultValue: kNoCategories }
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

  const [search, setSearch] = useProperty<string>(
    kSampleActivityBag,
    `search:${persistScope}`,
    { defaultValue: "" }
  );
  // Time sort: descending by default while the sample is running so new
  // events land at the top. The default is frozen at first view (a sample
  // completing mid-view must not flip the list under the user).
  const [timeSort, setTimeSort] = useProperty<"asc" | "desc">(
    kSampleActivityBag,
    `sort:${persistScope}`
  );
  const [initialRunning] = useState(running);
  const timeDescending = timeSort ? timeSort === "desc" : initialRunning;

  const [selectedKey, setSelectedKey] = useProperty<string | null>(
    kSampleActivityBag,
    `selected:${persistScope}`,
    { defaultValue: null }
  );

  // Bidirectional glyph ↔ row hover link (transient).
  const [hoverLink, setHoverLink] = useState<{
    source: "marker" | "row";
    keys: string[];
  } | null>(null);
  // Dense-band bin click narrows the list to the bin's window (transient).
  const [windowFilter, setWindowFilter] = useState<TimeWindow | null>(null);

  const listRef = useRef<ActivityHistoryListHandle | null>(null);

  // Glyph click → select + scroll to its history row, clearing any filter
  // that would hide it: the category filter widens to include the row, a
  // non-matching search is dropped, and a window filter that excludes the
  // row is cleared.
  const selectMarker = (key: string | null) => {
    setSelectedKey(key);
    if (key === null) return;
    const row = data.rows.find((r) => r.key === key);
    if (row) {
      if (categoryList.length > 0 && !categoryList.includes(row.category)) {
        setCategoryList([...categoryList, row.category]);
      }
      const query = search.trim().toLowerCase();
      if (query !== "" && !rowHaystack(row).toLowerCase().includes(query)) {
        setSearch("");
      }
      if (
        windowFilter !== null &&
        (row.time < windowFilter.start || row.time > windowFilter.end)
      ) {
        setWindowFilter(null);
      }
    }
    listRef.current?.scrollToKey(key);
  };

  if (!data.window) {
    return null;
  }

  return (
    <div className={styles.container}>
      <div className={styles.pickerRow}>
        <span className={styles.caption}>Activity</span>
        {data.hasWorkingSignal && (
          <BandChip
            label="Working / waiting"
            on={showWorking}
            onToggle={() => toggleBand("working", true)}
          />
        )}
        {data.markers.length > 0 && (
          <BandChip
            label="Markers"
            on={showMarkers}
            onToggle={() => toggleBand("markers", true)}
          />
        )}
        {data.tokenSeries.length > 0 && (
          <BandChip
            label="Token burn"
            on={showTokens}
            onToggle={() => toggleBand("tokens", true)}
          />
        )}
        {data.contextSeries.length > 0 && (
          <BandChip
            label="Context size"
            on={showContext}
            onToggle={() => toggleBand("context", false)}
          />
        )}
        {data.agentRows.length > 0 && (
          <BandChip
            label="Model & tool activity"
            on={showModelTool}
            onToggle={() => toggleBand("modelTool", false)}
          />
        )}
        {data.hasWorkingSignal && (
          <span className={styles.legend}>
            <span className={styles.legendSwatch} /> working · gap = waiting
          </span>
        )}
      </div>
      <ActivityChart
        data={data}
        window={data.window}
        showWorking={showWorking}
        showMarkers={showMarkers}
        showTokens={showTokens}
        showContext={showContext}
        showModelTool={showModelTool}
        selectedKey={selectedKey}
        onSelectMarker={selectMarker}
        hoveredRowKey={
          hoverLink?.source === "row" ? (hoverLink.keys[0] ?? null) : null
        }
        onHoverMarker={(keys) =>
          setHoverLink(
            keys && keys.length > 0 ? { source: "marker", keys } : null
          )
        }
        onOpenEvent={onOpenEvent}
        onFilterWindow={setWindowFilter}
      />
      <ActivityHistoryList
        ref={listRef}
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
        windowFilter={windowFilter}
        onClearWindowFilter={() => setWindowFilter(null)}
      />
    </div>
  );
};
