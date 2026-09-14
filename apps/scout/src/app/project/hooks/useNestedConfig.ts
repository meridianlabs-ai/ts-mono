import { useCallback, useMemo } from "react";

import { filterNullValues, ownField } from "../configUtils";

/**
 * The nested-config editors send a patch: the fields the user touched merged
 * over whatever the parent config already held. The generated API type
 * describes a whole CachePolicy/BatchConfig with no type for "the parts of
 * one", and the server fills the rest on PUT.
 */
const asNestedConfig = <T extends Record<string, unknown>>(
  patch: Partial<T>
): T =>
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- config patch boundary: see above
  patch as T;

/**
 * Hook for managing nested config sections like cache and batch.
 *
 * These configs can be:
 * - null/undefined (disabled)
 * - true (enabled with defaults)
 * - number (for batch: simple size value)
 * - object (enabled with specific settings)
 *
 * @param configValue The current config value (from parent generate_config)
 * @param updateParent Function to update the parent config with new nested value
 */
export function useNestedConfig<T extends Record<string, unknown>>(
  configValue: T | boolean | number | null | undefined,
  updateParent: (value: T | boolean | null) => void
) {
  const enabled =
    configValue !== null && configValue !== undefined && configValue !== false;

  const config: Partial<T> = useMemo(() => {
    if (typeof configValue === "object" && configValue !== null) {
      return { ...configValue }; // Shallow copy
    }
    return {};
  }, [configValue]);

  const setEnabled = useCallback(
    (newEnabled: boolean) => {
      if (newEnabled) {
        updateParent(true);
      } else {
        updateParent(null);
      }
    },
    [updateParent]
  );

  const updateConfig = useCallback(
    (updates: Partial<T>) => {
      const existingConfig =
        typeof configValue === "object" && configValue !== null
          ? filterNullValues(configValue)
          : {};
      updateParent(
        asNestedConfig<T>({
          ...existingConfig,
          ...updates,
        })
      );
    },
    [configValue, updateParent]
  );

  return {
    enabled,
    config,
    setEnabled,
    updateConfig,
  };
}

/**
 * Hook specifically for batch config which can also be a simple number (size).
 */
export function useBatchConfig<T extends Record<string, unknown>>(
  configValue: T | boolean | number | null | undefined,
  updateParent: (value: T | boolean | null) => void
) {
  const base = useNestedConfig(configValue, updateParent);

  const simpleBatchSize = typeof configValue === "number" ? configValue : null;

  const updateConfig = useCallback(
    (updates: Partial<T>) => {
      const existingConfig: Partial<T> =
        typeof configValue === "object" && configValue !== null
          ? filterNullValues(configValue)
          : {};
      const size =
        typeof configValue === "number"
          ? configValue
          : ownField(existingConfig, "size");
      updateParent(
        asNestedConfig<T>({
          ...(size !== undefined ? { size } : {}),
          ...existingConfig,
          ...updates,
        })
      );
    },
    [configValue, updateParent]
  );

  const currentBatchSize = useMemo(() => {
    if (typeof configValue === "object" && configValue !== null) {
      const size = configValue.size;
      return typeof size === "number" ? size : undefined;
    }
    return simpleBatchSize ?? undefined;
  }, [configValue, simpleBatchSize]);

  return {
    ...base,
    updateConfig,
    currentBatchSize,
  };
}
