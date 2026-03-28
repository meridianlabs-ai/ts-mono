import { createContext, FC, ReactNode, useContext } from "react";
import { StateSnapshot } from "react-virtuoso";

/**
 * Primitive state hooks that each host app must implement.
 *
 * Shared hooks in `@tsmono/react` compose these primitives to build
 * higher-level hooks like `useProperty` and `useCollapsedState`.
 * Each method here is a React hook — it internally subscribes to the
 * app's store and returns reactive values.
 *
 * Adding a new member causes compile errors in both apps until they
 * supply an implementation (same enforcement pattern as ComponentIcons).
 */
export interface ComponentStateHooks {
  // Property bag (persistent key-value UI state)
  usePropertyValue: (
    id: string,
    prop: string,
    defaultValue?: unknown
  ) => unknown;
  useSetPropertyValue: () => (id: string, prop: string, value: unknown) => void;
  useRemovePropertyValue: () => (id: string, prop: string) => void;

  // Collapsed state (simple boolean by scope+id)
  useCollapsedValue: (id: string, scope?: string) => boolean | undefined;
  useSetCollapsed: () => (scope: string, id: string, value: boolean) => void;

  // Collapsed ID buckets (Record<string, boolean> by bucket key)
  useCollapsedIds: (key: string) => Record<string, boolean> | undefined;
  useCollapseId: () => (key: string, id: string, value: boolean) => void;
  useClearCollapsedIds: () => (key: string) => void;

  // Scroll positions (imperative — used in effects, not render)
  useGetScrollPosition: () => (key: string) => number | undefined;
  useSetScrollPosition: () => (key: string, position: number) => void;

  // Virtuoso list state
  useListPosition: (key: string) => StateSnapshot | undefined;
  useSetListPosition: () => (key: string, state: StateSnapshot) => void;
  useClearListPosition: () => (key: string) => void;

  // Visible ranges
  useVisibleRanges: () => Record<
    string,
    { startIndex: number; endIndex: number }
  >;
  useSetVisibleRange: () => (
    key: string,
    value: { startIndex: number; endIndex: number }
  ) => void;
}

const ComponentStateContext = createContext<ComponentStateHooks | null>(null);

export const ComponentStateProvider: FC<{
  hooks: ComponentStateHooks;
  children: ReactNode;
}> = ({ hooks, children }) => (
  <ComponentStateContext.Provider value={hooks}>
    {children}
  </ComponentStateContext.Provider>
);

export const useComponentStateHooks = (): ComponentStateHooks => {
  const hooks = useContext(ComponentStateContext);
  if (!hooks) {
    throw new Error(
      "useComponentStateHooks must be used within a ComponentStateProvider"
    );
  }
  return hooks;
};
