import {
  createContext,
  FC,
  ReactNode,
  useContext,
  useMemo,
  useState,
} from "react";

export interface FindTarget {
  /** The current search term. Lower-cased comparisons are the consumer's responsibility. */
  term: string;
}

interface FindTargetContextValue {
  target: FindTarget | null;
  setTarget: (target: FindTarget | null) => void;
}

const FindTargetContext = createContext<FindTargetContextValue | null>(null);

/** Returns the active find target, or null. Consumers: ExpandablePanel and
 *  any other UI that should react to find navigation. */
export const useFindTarget = (): FindTarget | null =>
  useContext(FindTargetContext)?.target ?? null;

/** Returns the setter. Consumer: FindBand (sets the term, clears on close). */
export const useFindTargetSetter = (): ((
  target: FindTarget | null
) => void) => {
  const ctx = useContext(FindTargetContext);
  // No-op when no provider — keeps consumers safe in environments without one.
  return ctx?.setTarget ?? (() => {});
};

interface FindTargetProviderProps {
  /** Controlled value. When provided, overrides internal state — useful for tests. */
  value?: FindTarget | null;
  children: ReactNode;
}

export const FindTargetProvider: FC<FindTargetProviderProps> = ({
  value,
  children,
}) => {
  const [internal, setInternal] = useState<FindTarget | null>(null);
  const target = value !== undefined ? value : internal;
  const ctxValue = useMemo<FindTargetContextValue>(
    () => ({ target, setTarget: setInternal }),
    [target]
  );
  return (
    <FindTargetContext.Provider value={ctxValue}>
      {children}
    </FindTargetContext.Provider>
  );
};
