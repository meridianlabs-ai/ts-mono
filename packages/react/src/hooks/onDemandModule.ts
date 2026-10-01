import { useEffect, useState } from "react";

/**
 * A module loaded on first use and then cached. A failed load (e.g. a
 * transient chunk-load error) is not cached, so the next use retries.
 */
export interface OnDemandModule<T> {
  load: () => Promise<T>;
  /** The module if it has loaded, else undefined. */
  loaded: () => T | undefined;
}

export const onDemandModule = <T>(
  importer: () => Promise<T>
): OnDemandModule<T> => {
  let value: T | undefined;
  let pending: Promise<T> | null = null;
  return {
    loaded: () => value,
    load: () => {
      if (!pending) {
        const loading = importer().then((module) => {
          value = module;
          return module;
        });
        loading.catch(() => {
          if (pending === loading) {
            pending = null;
          }
        });
        pending = loading;
      }
      return pending;
    },
  };
};

/**
 * `module` once loaded (immediately, if it already has), else undefined.
 * Starts loading when `enabled`.
 */
export const useOnDemandModule = <T>(
  module: OnDemandModule<T>,
  enabled = true
): T | undefined => {
  const [value, setValue] = useState<T | undefined>(() => module.loaded());
  useEffect(() => {
    if (!enabled || value !== undefined) {
      return;
    }
    let cancelled = false;
    module
      .load()
      .then((loaded) => {
        if (!cancelled) {
          setValue(() => loaded);
        }
      })
      .catch((error: unknown) => {
        console.error("Unable to load module", error);
      });
    return () => {
      cancelled = true;
    };
  }, [module, enabled, value]);
  return value;
};
