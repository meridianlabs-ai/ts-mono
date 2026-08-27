import { isRecord } from "@tsmono/util";

import {
  ProjectConfig,
  ProjectConfigInput,
  ValidationSetInput,
} from "../../types/api-types";

/**
 * Deep equality check for config objects using JSON serialization.
 */
export function configsEqual(
  a: Partial<ProjectConfigInput> | null,
  b: Partial<ProjectConfigInput> | null
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Check if a value is "empty" (null, undefined, or empty object/array).
 */
export function isEmpty(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "object") return Object.keys(value).length === 0;
  return false;
}

/**
 * Filter out null and undefined values from an object.
 */
export function filterNullValues<T extends Record<string, unknown>>(
  obj: T
): Partial<T> {
  const result: Partial<T> = {};
  for (const key in obj) {
    const value = obj[key];
    if (value !== null && value !== undefined) {
      result[key] = value;
    }
  }
  return result;
}

/**
 * Deep copy a config object. structuredClone is generic in the value it
 * copies, so the copy keeps its type instead of round-tripping through
 * JSON.parse's `any`.
 */
export function deepCopy<T>(obj: T): T {
  return structuredClone(obj);
}

/**
 * Clean nested config (cache/batch) for saving.
 * Handles boolean, number, object, null, and undefined values.
 */
function cleanNestedConfig(
  edited: unknown,
  original: unknown
): Record<string, unknown> | boolean | number | null | undefined {
  // Preserve boolean and number values as-is
  if (typeof edited === "boolean" || typeof edited === "number") {
    return edited;
  }

  // If edited is empty, return null if original had content
  if (!isRecord(edited)) {
    if (original !== null && original !== undefined) {
      return null;
    }
    return undefined;
  }

  const result: Record<string, unknown> = {};
  const originalObj = isRecord(original) ? original : {};

  for (const [key, value] of Object.entries(edited)) {
    const origValue = originalObj[key];
    const valueChanged = JSON.stringify(value) !== JSON.stringify(origValue);

    if (valueChanged) {
      result[key] = value;
    } else if (!isEmpty(value)) {
      result[key] = value;
    }
  }

  // If result is empty but original had content, return true (enabled state)
  if (Object.keys(result).length === 0) {
    if (original !== null && original !== undefined) {
      return true;
    }
    return undefined;
  }

  return result;
}

/**
 * Clean generate_config for saving.
 * Handles nested cache/batch configs and removes empty values.
 */
function cleanGenerateConfig(
  edited: unknown,
  original: unknown
): Record<string, unknown> | null | undefined {
  // Handle empty edited config
  if (!isRecord(edited) || Object.keys(edited).length === 0) {
    const originalHasContent =
      isRecord(original) && Object.keys(original).length > 0;
    if (originalHasContent) {
      return null;
    }
    return undefined;
  }

  const result: Record<string, unknown> = {};
  const originalObj = isRecord(original) ? original : {};

  for (const key of Object.keys(edited)) {
    const editedValue = edited[key];
    const originalValue = originalObj[key];

    // Handle nested cache/batch configs
    if (key === "cache" || key === "batch") {
      const cleanedNested = cleanNestedConfig(editedValue, originalValue);
      if (cleanedNested !== undefined) {
        result[key] = cleanedNested;
      }
      continue;
    }

    // Handle null/undefined values
    if (editedValue === null || editedValue === undefined) {
      const originalHadContent =
        originalValue !== null &&
        originalValue !== undefined &&
        (typeof originalValue !== "object" ||
          Object.keys(originalValue).length > 0);
      if (originalHadContent) {
        result[key] = null;
      }
      continue;
    }

    result[key] = editedValue;
  }

  if (Object.keys(result).length === 0) {
    return undefined;
  }

  return result;
}

/**
 * Compute the config to save by comparing edited values against original server state.
 * Only includes values that have changed or have content.
 */
export function computeConfigToSave(
  edited: Partial<ProjectConfigInput>,
  original: Partial<ProjectConfigInput>,
  serverConfig: ProjectConfigInput
): ProjectConfigInput {
  const result: Record<string, unknown> = {};

  const allKeys = new Set([
    ...Object.keys(edited),
    ...Object.keys(serverConfig),
  ]);

  for (const key of allKeys) {
    const editedValue = configField(edited, key);
    const originalValue = configField(original, key);

    // Handle generate_config specially
    if (key === "generate_config") {
      const cleanedGenConfig = cleanGenerateConfig(editedValue, originalValue);
      if (cleanedGenConfig !== undefined) {
        result[key] = cleanedGenConfig;
      }
      continue;
    }

    const valueChanged =
      JSON.stringify(editedValue) !== JSON.stringify(originalValue);

    if (valueChanged) {
      result[key] = editedValue;
    } else if (!isEmpty(editedValue)) {
      result[key] = editedValue;
    }
  }

  // `filter` is the config's one required field; everything else is optional,
  // so the assembled record is a ProjectConfigInput once filter is pinned.
  // Two paths leave it unset: unchanged-and-empty (dropped by the loop) and
  // cleared in the editor (the change survives as undefined). Either way the
  // server's own value stands — a required field can't be cleared, so an
  // emptied filter reverts on save rather than producing an invalid config.
  const filter = result["filter"];
  return {
    ...result,
    filter: isFilter(filter) ? filter : serverConfig.filter,
  };
}

const isFilter = (value: unknown): value is string | string[] =>
  typeof value === "string" ||
  (Array.isArray(value) && value.every((entry) => typeof entry === "string"));

/**
 * Reads a config field by name. The key set is the union of the edited and
 * server configs' keys, which the declared interface can't index.
 */
const configField = (
  config: Partial<ProjectConfigInput>,
  key: string
): unknown => (isRecord(config) ? config[key] : undefined);

/**
 * Initialize edited config from server config.
 * Extracts the relevant fields for editing.
 * All fields are normalized to null (not undefined) for consistent comparison.
 */
export function initializeEditedConfig(
  serverConfig: ProjectConfigInput
): Partial<ProjectConfigInput> {
  return {
    transcripts: serverConfig.transcripts ?? null,
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    filter: serverConfig.filter ?? null,
    scans: serverConfig.scans ?? null,
    max_transcripts: serverConfig.max_transcripts ?? null,
    max_processes: serverConfig.max_processes ?? null,
    limit: serverConfig.limit ?? null,
    shuffle: serverConfig.shuffle ?? null,
    tags: serverConfig.tags ?? null,
    metadata: serverConfig.metadata ?? null,
    log_level: serverConfig.log_level ?? null,
    model: serverConfig.model ?? null,
    model_base_url: serverConfig.model_base_url ?? null,
    model_args: serverConfig.model_args ?? null,
    generate_config: serverConfig.generate_config ?? null,
  };
}

const kValidationPredicates = [
  "gt",
  "gte",
  "lt",
  "lte",
  "eq",
  "ne",
  "contains",
  "startswith",
  "endswith",
  "icontains",
  "iequals",
] as const;

type ValidationPredicate = (typeof kValidationPredicates)[number];

const isValidationPredicate = (value: unknown): value is ValidationPredicate =>
  kValidationPredicates.some((predicate) => predicate === value);

/**
 * The config the server hands out and the config we PUT back are the same
 * shape but for one field: a validation set's `predicate` is an open string
 * coming out and a closed union going in. Checking it is what makes this a
 * conversion rather than an assertion; a predicate the server invented that
 * we can't send back falls to the schema default.
 */
export function asConfigInput(config: ProjectConfig): ProjectConfigInput {
  const { validation, ...rest } = config;
  if (!validation) {
    return { ...rest, validation };
  }
  const converted: Record<string, string | ValidationSetInput> = {};
  for (const [name, set] of Object.entries(validation)) {
    converted[name] =
      typeof set === "string"
        ? set
        : {
            ...set,
            predicate: isValidationPredicate(set.predicate)
              ? set.predicate
              : null,
          };
  }
  return { ...rest, validation: converted };
}
