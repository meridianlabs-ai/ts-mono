import { useSyncExternalStore } from "react";

import { ComponentStateHooks } from "../state/ComponentStateContext";

const getKey = (id: string, prop: string) => `${id}::${prop}`;

// Minimal Map-backed ComponentStateHooks, for components that only need their
// useProperty reads and writes to round-trip. Writes do not re-render.
export function makeStateHooks(): ComponentStateHooks {
  const store = new Map<string, unknown>();
  return {
    useValue: (id: string, prop: string, defaultValue?: unknown) =>
      store.has(getKey(id, prop)) ? store.get(getKey(id, prop)) : defaultValue,
    useSetValue: () => (id: string, prop: string, value: unknown) => {
      store.set(getKey(id, prop), value);
    },
    useRemoveValue: () => (id: string, prop: string) => {
      store.delete(getKey(id, prop));
    },
    useEntries: () => undefined,
    useRemoveAll: () => () => {},
    useRemoveByPrefix: () => () => {},
  };
}

// Reactive variant: like production (zustand-selector adapters in both apps), a
// set re-renders every subscribed component. The non-reactive version above
// cannot exercise an effect whose own setProperty call re-runs it; this one can.
// Also returns the backing Map so tests can seed and assert on stored values.
export function makeReactiveStateStore(): {
  hooks: ComponentStateHooks;
  store: Map<string, unknown>;
} {
  const store = new Map<string, unknown>();
  const listeners = new Set<() => void>();
  let version = 0;
  const subscribe = (cb: () => void) => {
    listeners.add(cb);
    return () => {
      listeners.delete(cb);
    };
  };
  const emit = () => {
    version++;
    listeners.forEach((l) => l());
  };
  // Stable action references, like zustand store actions in production — an
  // unstable setter would churn effect deps on every re-render and mask the
  // very re-run behavior this harness exists to exercise.
  const setValue = (id: string, prop: string, value: unknown) => {
    const key = getKey(id, prop);
    if (!store.has(key) || store.get(key) !== value) {
      store.set(key, value);
      emit();
    }
  };
  const removeValue = (id: string, prop: string) => {
    if (store.delete(getKey(id, prop))) emit();
  };
  const hooks: ComponentStateHooks = {
    useValue: (id: string, prop: string, defaultValue?: unknown) => {
      useSyncExternalStore(subscribe, () => version);
      return store.has(getKey(id, prop))
        ? store.get(getKey(id, prop))
        : defaultValue;
    },
    useSetValue: () => setValue,
    useRemoveValue: () => removeValue,
    useEntries: () => undefined,
    useRemoveAll: () => () => {},
    useRemoveByPrefix: () => () => {},
  };
  return { hooks, store };
}

export function makeReactiveStateHooks(): ComponentStateHooks {
  return makeReactiveStateStore().hooks;
}
