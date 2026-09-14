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
 * Filter out null and undefined values from an object. Own properties only:
 * for-in also walks inherited (polluted-prototype) keys, see `ownField`.
 */
export function filterNullValues<T extends Record<string, unknown>>(
  obj: T
): Partial<T> {
  const result: Partial<T> = {};
  for (const key in obj) {
    if (!Object.hasOwn(obj, key)) continue;
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
 * Own-property read. The config builders read keys that may be absent from
 * the object at hand (server responses omit unset fields; key sets are taken
 * from one object and read on another), and a plain read of an absent key
 * falls through to Object.prototype. A page-lifetime pollution of that
 * prototype must read as "unset", not as configuration the user entered.
 */
export const ownField = <T extends object, K extends keyof T>(
  obj: T,
  key: K
): T[K] | undefined => (Object.hasOwn(obj, key) ? obj[key] : undefined);

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
    const origValue = ownField(originalObj, key);
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
    const originalValue = ownField(originalObj, key);

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
 * The fields the settings editor owns. Only these are read from the server
 * config and only these can appear in the saved payload: a field the editor
 * has no control for is never the editor's to send back.
 */
const kEditableConfigKeys = [
  "transcripts",
  "filter",
  "scans",
  "max_transcripts",
  "max_processes",
  "limit",
  "shuffle",
  "tags",
  "metadata",
  "log_level",
  "model",
  "model_base_url",
  "model_args",
  "generate_config",
] as const satisfies readonly (keyof ProjectConfigInput)[];

type EditableConfigKey = (typeof kEditableConfigKeys)[number];

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

  for (const key of kEditableConfigKeys) {
    const editedValue = ownField(edited, key);
    const originalValue = ownField(original, key);

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
  const filter = ownField(result, "filter");
  return {
    ...result,
    filter: isFilter(filter) ? filter : serverConfig.filter,
  };
}

const isFilter = (value: unknown): value is string | string[] =>
  typeof value === "string" ||
  (Array.isArray(value) && value.every((entry) => typeof entry === "string"));

/**
 * Initialize edited config from server config.
 * Extracts the relevant fields for editing.
 * Optional fields are normalized to null (not undefined) for consistent
 * comparison; the required `filter` stays undefined if the server omits it.
 */
export function initializeEditedConfig(
  serverConfig: ProjectConfigInput
): Partial<ProjectConfigInput> {
  return {
    transcripts: ownField(serverConfig, "transcripts") ?? null,
    filter: ownField(serverConfig, "filter"),
    scans: ownField(serverConfig, "scans") ?? null,
    max_transcripts: ownField(serverConfig, "max_transcripts") ?? null,
    max_processes: ownField(serverConfig, "max_processes") ?? null,
    limit: ownField(serverConfig, "limit") ?? null,
    shuffle: ownField(serverConfig, "shuffle") ?? null,
    tags: ownField(serverConfig, "tags") ?? null,
    metadata: ownField(serverConfig, "metadata") ?? null,
    log_level: ownField(serverConfig, "log_level") ?? null,
    model: ownField(serverConfig, "model") ?? null,
    model_base_url: ownField(serverConfig, "model_base_url") ?? null,
    model_args: ownField(serverConfig, "model_args") ?? null,
    generate_config: ownField(serverConfig, "generate_config") ?? null,
  } satisfies Record<EditableConfigKey, unknown>;
}

/**
 * The editor state to show after a save round-trip: the persisted config from
 * the server's response, with any fields the user edited while the save was
 * in flight (changed relative to the snapshot that was saved) layered back on
 * top so those keystrokes aren't discarded.
 */
export function mergeInFlightEdits(
  persisted: Partial<ProjectConfigInput>,
  current: Partial<ProjectConfigInput>,
  savedSnapshot: Partial<ProjectConfigInput>
): Partial<ProjectConfigInput> {
  const merged: Partial<ProjectConfigInput> = { ...persisted };
  // Widened views for by-name access; writes stay keyed by `current`'s own
  // keys, so the shape holds.
  const mergedRecord: Record<string, unknown> = merged;
  const currentRecord: Record<string, unknown> = current;
  const snapshotRecord: Record<string, unknown> = savedSnapshot;
  for (const key of Object.keys(currentRecord)) {
    const changedSinceSave =
      JSON.stringify(currentRecord[key]) !==
      JSON.stringify(ownField(snapshotRecord, key));
    if (changedSinceSave) {
      mergedRecord[key] = currentRecord[key];
    }
  }
  return merged;
}

type ValidationPredicate = NonNullable<ValidationSetInput["predicate"]>;

// `satisfies` ties this to the generated union: regenerating the schema with
// a new or renamed predicate errors here until the map is updated, so valid
// predicates can't silently start converting to null.
const kValidationPredicates = {
  gt: true,
  gte: true,
  lt: true,
  lte: true,
  eq: true,
  ne: true,
  contains: true,
  startswith: true,
  endswith: true,
  icontains: true,
  iequals: true,
} satisfies Record<ValidationPredicate, true>;

const isValidationPredicate = (value: unknown): value is ValidationPredicate =>
  typeof value === "string" && Object.hasOwn(kValidationPredicates, value);

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
