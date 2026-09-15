/**
 * Column sizing strategy registry.
 */

import { defaultStrategy } from "./defaultStrategy";
import { fitContentStrategy } from "./fitContentStrategy";
import { ColumnSizingStrategyKey, SizingStrategy } from "./types";

/**
 * Registry of all available sizing strategies.
 */
export const sizingStrategies: Record<ColumnSizingStrategyKey, SizingStrategy> =
  {
    default: defaultStrategy,
    "fit-content": fitContentStrategy,
  };

/**
 * Get a sizing strategy by key.
 * Falls back to default strategy if key is not found.
 */
export function getSizingStrategy(
  key: ColumnSizingStrategyKey
): SizingStrategy {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- persisted store state (#555): the key is read back from a table-state blob an older build wrote, so it may name a strategy this build no longer registers
  return sizingStrategies[key] ?? sizingStrategies.default;
}
