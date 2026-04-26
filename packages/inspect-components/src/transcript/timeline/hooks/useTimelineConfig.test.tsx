// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { useCallback, useState, type PropsWithChildren } from "react";
import { describe, expect, it } from "vitest";

import {
  ComponentStateProvider,
  type ComponentStateHooks,
} from "@tsmono/react/state";

import { defaultMarkerConfig } from "../markers";

import { useTimelineConfig } from "./useTimelineConfig";

// =============================================================================
// Reactive in-memory ComponentStateProvider for testing
// =============================================================================

/**
 * Creates a wrapper component with a reactive in-memory store that triggers
 * re-renders when values change (mirroring real Zustand-backed behaviour).
 *
 * State is kept in a `useState` Map so reads during render are lint-safe
 * (no ref reads during render).
 */
function InMemoryStateWrapper({ children }: PropsWithChildren) {
  const [store, setStore] = useState(
    () => new Map<string, Map<string, unknown>>()
  );

  const getPropertyBag = useCallback(
    (id: string): Map<string, unknown> => {
      let bag = store.get(id);
      if (!bag) {
        bag = new Map();
        store.set(id, bag);
      }
      return bag;
    },
    [store]
  );

  const hooks: ComponentStateHooks = {
    useValue: (id: string, prop: string, defaultValue?: unknown): unknown => {
      const bag = getPropertyBag(id);
      return bag.has(prop) ? bag.get(prop) : defaultValue;
    },
    useSetValue: () => (id: string, prop: string, value: unknown) => {
      getPropertyBag(id).set(prop, value);
      setStore((prev) => new Map(prev));
    },
    useRemoveValue: () => (id: string, prop: string) => {
      getPropertyBag(id).delete(prop);
      setStore((prev) => new Map(prev));
    },
    useEntries: (id: string): Record<string, unknown> | undefined => {
      const bag = store.get(id);
      if (!bag) return undefined;
      return Object.fromEntries(bag);
    },
    useRemoveAll: () => (id: string) => {
      store.delete(id);
      setStore((prev) => new Map(prev));
    },
    useRemoveByPrefix: () => (id: string, prefix: string) => {
      const bag = store.get(id);
      if (!bag) return;
      for (const key of [...bag.keys()]) {
        if (key.startsWith(prefix)) bag.delete(key);
      }
      setStore((prev) => new Map(prev));
    },
  };

  return (
    <ComponentStateProvider hooks={hooks}>{children}</ComponentStateProvider>
  );
}

// =============================================================================
// useTimelineConfig hook
// =============================================================================

describe("useTimelineConfig", () => {
  it("returns default values on initial render", () => {
    const { result } = renderHook(() => useTimelineConfig(), {
      wrapper: InMemoryStateWrapper,
    });

    expect(result.current.markerKinds).toEqual(defaultMarkerConfig.kinds);
    expect(result.current.markerDepth).toBe(defaultMarkerConfig.depth);
    expect(result.current.includeUtility).toBe(false);
    expect(result.current.showBranches).toBe(false);
    expect(result.current.isDefault).toBe(true);
  });

  it("setMarkerKinds updates marker kinds", () => {
    const { result } = renderHook(() => useTimelineConfig(), {
      wrapper: InMemoryStateWrapper,
    });

    act(() => {
      result.current.setMarkerKinds(["error"]);
    });

    expect(result.current.markerKinds).toEqual(["error"]);
    expect(result.current.isDefault).toBe(false);
  });

  it("toggleMarkerKind adds and removes kinds", () => {
    const { result } = renderHook(() => useTimelineConfig(), {
      wrapper: InMemoryStateWrapper,
    });

    const initialKinds = [...result.current.markerKinds];
    const kindToToggle = initialKinds[0]!;

    // Remove
    act(() => {
      result.current.toggleMarkerKind(kindToToggle);
    });
    expect(result.current.markerKinds).not.toContain(kindToToggle);

    // Add back
    act(() => {
      result.current.toggleMarkerKind(kindToToggle);
    });
    expect(result.current.markerKinds).toContain(kindToToggle);
  });

  it("setIncludeUtility updates utility flag", () => {
    const { result } = renderHook(() => useTimelineConfig(), {
      wrapper: InMemoryStateWrapper,
    });

    act(() => {
      result.current.setIncludeUtility(true);
    });

    expect(result.current.includeUtility).toBe(true);
    expect(result.current.agentConfig.includeUtility).toBe(true);
    expect(result.current.isDefault).toBe(false);
  });

  it("setShowBranches updates branches flag", () => {
    const { result } = renderHook(() => useTimelineConfig(), {
      wrapper: InMemoryStateWrapper,
    });

    act(() => {
      result.current.setShowBranches(true);
    });

    expect(result.current.showBranches).toBe(true);
    expect(result.current.agentConfig.showBranches).toBe(true);
  });

  it("forkRelative defaults to true when showBranches is enabled", () => {
    const { result } = renderHook(() => useTimelineConfig(), {
      wrapper: InMemoryStateWrapper,
    });

    act(() => {
      result.current.setShowBranches(true);
    });

    expect(result.current.forkRelative).toBe(true);
  });

  it("resetToDefaults restores all settings", () => {
    const { result } = renderHook(() => useTimelineConfig(), {
      wrapper: InMemoryStateWrapper,
    });

    act(() => {
      result.current.setMarkerKinds(["error"]);
      result.current.setIncludeUtility(true);
      result.current.setShowBranches(true);
    });

    expect(result.current.isDefault).toBe(false);

    act(() => {
      result.current.resetToDefaults();
    });

    expect(result.current.isDefault).toBe(true);
    expect(result.current.markerKinds).toEqual(defaultMarkerConfig.kinds);
    expect(result.current.includeUtility).toBe(false);
    expect(result.current.showBranches).toBe(false);
  });

  it("markerConfig reflects current kinds and depth", () => {
    const { result } = renderHook(() => useTimelineConfig(), {
      wrapper: InMemoryStateWrapper,
    });

    act(() => {
      result.current.setMarkerKinds(["error"]);
      result.current.setMarkerDepth("children");
    });

    expect(result.current.markerConfig).toEqual({
      kinds: ["error"],
      depth: "children",
    });
  });

  it("branchesPresent flips showBranches default on", () => {
    const { result } = renderHook(
      () => useTimelineConfig({ branchesPresent: true }),
      { wrapper: InMemoryStateWrapper }
    );

    expect(result.current.showBranches).toBe(true);
    // forkRelative auto-follows when showBranches is on.
    expect(result.current.forkRelative).toBe(true);
    // No user override yet — config is still considered default.
    expect(result.current.isDefault).toBe(true);
  });

  it("explicit user toggle wins over branchesPresent", () => {
    const { result } = renderHook(
      ({ branchesPresent }: { branchesPresent: boolean }) =>
        useTimelineConfig({ branchesPresent }),
      {
        wrapper: InMemoryStateWrapper,
        initialProps: { branchesPresent: true },
      }
    );

    // Auto-default is on.
    expect(result.current.showBranches).toBe(true);

    // User explicitly turns branches off — sticks even though branchesPresent.
    act(() => {
      result.current.setShowBranches(false);
    });

    expect(result.current.showBranches).toBe(false);
    expect(result.current.isDefault).toBe(false);
  });

  it("branchesPresent does not flip showBranches when sample has no branches", () => {
    const { result } = renderHook(
      () => useTimelineConfig({ branchesPresent: false }),
      { wrapper: InMemoryStateWrapper }
    );

    expect(result.current.showBranches).toBe(false);
    expect(result.current.forkRelative).toBe(false);
    expect(result.current.isDefault).toBe(true);
  });
});
