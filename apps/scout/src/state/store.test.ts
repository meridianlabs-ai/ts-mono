import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { isRecord } from "@tsmono/util";

import { apiScoutServer } from "../api/api-scout-server";
import { createVSCodeStore } from "../api/vscode-storage";

import {
  emptyDataframeState,
  GRID_STATE_NAME,
  type DataframeState,
} from "./dataframeState";
import { createStore } from "./store";

const kStorageKey = "inspect-scout-storage";

const createMemoryStorage = () => {
  const blobs = new Map<string, string>();
  return {
    blobs,
    storage: {
      getItem: (key: string) => blobs.get(key) ?? null,
      setItem: (key: string, value: string) => {
        blobs.set(key, value);
      },
      removeItem: (key: string) => {
        blobs.delete(key);
      },
    },
  };
};

const readPersistedState = (blobs: Map<string, string>) => {
  const raw = blobs.get(kStorageKey);
  if (raw === undefined) throw new Error("nothing persisted");
  const parsed: unknown = JSON.parse(raw);
  if (!isRecord(parsed) || !isRecord(parsed.state)) {
    throw new Error("unexpected persisted shape");
  }
  return parsed.state;
};

// Property groups are named by component ids, and transcript panels use the
// event uuid straight from the log. An id or property name that is an
// Object.prototype member must be an ordinary own entry, never a read of or
// write to the shared prototype.
describe("store properties prototype safety", () => {
  const prototypeKeys = new Set(Object.getOwnPropertyNames(Object.prototype));

  afterEach(() => {
    for (const key of Object.getOwnPropertyNames(Object.prototype)) {
      if (!prototypeKeys.has(key))
        Reflect.deleteProperty(Object.prototype, key);
    }
  });

  const actions = () => createStore(apiScoutServer()).getState();

  it.each(["__proto__", "constructor", "toString"])(
    "stores a value under id %s without touching Object.prototype",
    (id) => {
      const store = actions();

      store.setPropertyValue(id, "selectedNav", "planted-nav");

      expect(Object.hasOwn(Object.prototype, "selectedNav")).toBe(false);
      expect(store.getPropertyValue(id, "selectedNav")).toBe("planted-nav");
      expect(
        store.getPropertyValue("another-id", "selectedNav", "default")
      ).toBe("default");
    }
  );

  it.each(["bag", "__proto__", "constructor", "toString"])(
    "updates and deletes prototype-named keys in %s without losing other state",
    (bagName) => {
      const store = actions();
      store.setPropertyValue("other-bag", "keep", 42);
      store.setPropertyValue(bagName, "keep", "original");
      store.setPropertyValue(bagName, "__proto__", { version: 1 });
      store.setPropertyValue(bagName, "__proto__", { version: 2 });
      store.setPropertyValue(bagName, "constructor", "own constructor");
      store.setPropertyValue(bagName, "toString", "own toString");

      expect(store.getPropertyValue(bagName, "__proto__")).toEqual({
        version: 2,
      });
      expect(store.getPropertyValue(bagName, "keep")).toBe("original");

      store.removePropertyValue(bagName, "__proto__");
      expect(store.getPropertyValue(bagName, "__proto__", "gone")).toBe("gone");
      expect(store.getPropertyValue(bagName, "constructor")).toBe(
        "own constructor"
      );

      store.setPropertyValue(bagName, "__proto__", "restored");
      store.removeByPrefix(bagName, "__proto");
      expect(store.getPropertyValue(bagName, "__proto__", "gone")).toBe("gone");
      expect(store.getPropertyValue(bagName, "toString")).toBe("own toString");
      expect(store.getPropertyValue(bagName, "keep")).toBe("original");

      store.removeAllProperties(bagName);
      expect(store.getPropertyValue(bagName, "keep", "gone")).toBe("gone");
      expect(store.getPropertyValue("other-bag", "keep")).toBe(42);
      expect(Object.hasOwn(Object.prototype, "keep")).toBe(false);
      expect(Object.hasOwn(Object.prototype, "version")).toBe(false);
    }
  );

  it.each([false, 0, "", null, undefined])(
    "removes properties with falsy value %s and their empty group",
    (value) => {
      const store = createStore(apiScoutServer());
      for (const id of ["bag", "__proto__"]) {
        store.getState().setPropertyValue(id, "__proto__", value);
        store.getState().removePropertyValue(id, "__proto__");
        expect(Object.hasOwn(store.getState().properties, id)).toBe(false);
      }
    }
  );

  it("stores a __proto__ property inside a group as an own entry", () => {
    const store = actions();

    store.setPropertyValue("id", "__proto__", { planted_key: 1 });

    expect(Object.hasOwn(Object.prototype, "planted_key")).toBe(false);
    expect(store.getPropertyValue("id", "__proto__")).toEqual({
      planted_key: 1,
    });
  });

  it.each(["constructor", "toString", "hasOwnProperty", "__proto__"])(
    "reads an absent %s property as the default",
    (name) => {
      const store = actions();
      store.setPropertyValue("id", "other", 1);

      expect(store.getPropertyValue("id", name, "default")).toBe("default");
      expect(store.getPropertyValue(name, "other", "default")).toBe("default");
    }
  );

  it("removes properties and groups named after prototype members", () => {
    const store = actions();
    store.setPropertyValue("__proto__", "a", 1);
    store.setPropertyValue("__proto__", "b", 2);

    store.removePropertyValue("__proto__", "a");
    expect(store.getPropertyValue("__proto__", "a", "gone")).toBe("gone");
    expect(store.getPropertyValue("__proto__", "b")).toBe(2);

    store.removeByPrefix("__proto__", "b");
    expect(store.getPropertyValue("__proto__", "b", "gone")).toBe("gone");

    store.setPropertyValue("constructor", "a", 1);
    store.removeAllProperties("constructor");
    expect(store.getPropertyValue("constructor", "a", "gone")).toBe("gone");
    expect(Object.hasOwn(Object.prototype, "a")).toBe(false);
  });
});

describe("dataframe state lifetime", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const dataframe: DataframeState = {
    ...emptyDataframeState,
    sorting: [{ id: "value", desc: true }],
    columnOrder: ["value", "transcript_id"],
    columnSizing: { value: 120 },
    columnPinning: { start: ["value"], end: [] },
    columnFilters: {
      value: {
        columnId: "value",
        filterType: "number",
        spec: { operator: ">", value: "0" },
      },
    },
    scroll: { top: 8500, left: 100 },
  };

  it("restores current dataframe state when VS Code recreates the webview", () => {
    let webviewState: unknown;
    const vscode = {
      getState: () => webviewState,
      setState: (state: unknown) => {
        webviewState = structuredClone(state);
      },
      postMessage: () => {},
    };
    const api = { ...apiScoutServer(), storage: createVSCodeStore(vscode) };
    const original = createStore(api);
    original.getState().setGridState(GRID_STATE_NAME, dataframe);
    original.getState().setSelectedResultRow(5);
    vi.runAllTimers();

    const restored = createStore(api);
    expect(restored.getState().gridStates[GRID_STATE_NAME]).toEqual(dataframe);
    expect(restored.getState().selectedResultRow).toBe(5);
    restored.getState().setGridState(GRID_STATE_NAME, (previous) => ({
      ...previous,
      sorting: [],
    }));
    expect(restored.getState().gridStates[GRID_STATE_NAME]?.sorting).toEqual(
      []
    );
    vi.runAllTimers();
  });

  it("starts fresh when the normal browser store is recreated", () => {
    const api = apiScoutServer();
    const original = createStore(api);
    original.getState().setGridState(GRID_STATE_NAME, dataframe);
    original.getState().setSelectedResultRow(5);
    vi.runAllTimers();

    const recreated = createStore(api);
    expect(recreated.getState().gridStates[GRID_STATE_NAME]).toBeUndefined();
    expect(recreated.getState().selectedResultRow).toBeUndefined();
  });
});

describe("persisted state", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  // The keys written to storage are the contract with VS Code webview state
  // (the browser build uses NoPersistence); a slice refactor must not move
  // them.
  const kPersistedKeys = [
    "gridStates",
    "highlightLabeled",
    "properties",
    "scansTableState",
    "scopedErrors",
    "searchPanelStates",
    "transcriptCollapsedEvents",
    "transcriptState",
    "transcriptsTableState",
    "validationCaseSelection",
    "visibleScannerResultsCount",
  ];

  it("persists exactly the contracted keys, one action per slice", () => {
    const { blobs, storage } = createMemoryStorage();
    const store = createStore({ ...apiScoutServer(), storage });
    const state = store.getState();

    state.setShowFind(true);
    state.setHasInitializedRouting(true);
    state.setSelectedScanLocation("scans/one");
    state.setVisibleScanJobCount(3);
    state.setSelectedScanner("scanner-a");
    state.setVisibleScannerResults([]);
    state.setPropertyValue("panel", "open", true);
    state.setTranscriptsDir("transcripts/dir");
    state.setSelectedTranscriptTab("events");
    state.setSelectedValidationSetUri("validation://set");
    vi.runAllTimers();

    const persisted = readPersistedState(blobs);
    expect(Object.keys(persisted).sort()).toEqual(
      [
        ...kPersistedKeys,
        "selectedScanLocation",
        "selectedScanner",
        "selectedTranscriptTab",
        "selectedValidationSetUri",
        "showFind",
        "transcriptsDir",
        "visibleScanJobCount",
      ].sort()
    );
    expect(persisted.selectedScanner).toBe("scanner-a");
    expect(persisted.properties).toEqual({ panel: { open: true } });
  });
});
