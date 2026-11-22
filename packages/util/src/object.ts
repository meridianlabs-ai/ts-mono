export const printObject = (val: object, size: number = 50): string => {
  const open = "{";
  const close = "}";
  const ellipsis = "…";
  const separator = ", ";
  const kvSeparator = ": ";

  let remainingSize = size - open.length - close.length;

  const entries = Object.entries(val);
  const headItems: string[] = [];
  const tailItems: string[] = [];

  let headIdx = 0;
  let tailIdx = entries.length - 1;

  while (headIdx <= tailIdx) {
    const headPair = `${entries[headIdx]?.[0]}${kvSeparator}${JSON.stringify(entries[headIdx]?.[1])}`;
    const tailPair = `${entries[tailIdx]?.[0]}${kvSeparator}${JSON.stringify(entries[tailIdx]?.[1])}`;

    // If we're at the same entry (middle of odd-length object)
    if (headIdx === tailIdx) {
      if (headPair.length <= remainingSize) {
        headItems.push(headPair);
      } else {
        headItems.push(ellipsis);
      }
      break;
    }

    // Try to fit both head and tail entries (with separator between them)
    const bothSize = headPair.length + tailPair.length + separator.length;

    if (bothSize <= remainingSize) {
      headItems.push(headPair);
      tailItems.unshift(tailPair);
      remainingSize -= bothSize;
      headIdx++;
      tailIdx--;
    } else if (
      headPair.length + separator.length + ellipsis.length <=
      remainingSize
    ) {
      // Can't fit both, but can fit head item plus ellipsis
      headItems.push(headPair);
      headItems.push(ellipsis);
      break;
    } else {
      // Can't even fit head item
      headItems.push(ellipsis);
      break;
    }
  }

  // If the first entry is too large, middle truncate it
  if (headItems.length === 0 && entries.length > 0) {
    const firstPair = `${entries[0]?.[0]}${kvSeparator}${JSON.stringify(entries[0]?.[1])}`;
    const truncateSize = remainingSize - ellipsis.length - separator.length;
    if (truncateSize > 0) {
      headItems.push(firstPair.slice(0, truncateSize) + ellipsis);
      headItems.push(ellipsis);
    } else {
      headItems.push(ellipsis);
    }
  }

  const allItems = [...headItems, ...tailItems];
  return open + allItems.join(separator) + close;
};

/**
 * Own-property read of a string-keyed record. Plain indexing walks the
 * prototype chain, so a key taken from untrusted data (a log's uuid, score
 * name, attachment id, ...) that happens to be `constructor`, `toString` or
 * `__proto__` resolves to a builtin instead of "absent"; this returns
 * `undefined` for any key the record does not own.
 */
export const getOwn = <T>(
  record: Readonly<Record<string, T>> | undefined,
  key: string
): T | undefined =>
  record !== undefined && Object.hasOwn(record, key) ? record[key] : undefined;

/**
 * Record with a null prototype built from a Map. `Object.fromEntries` alone
 * only makes *present* keys own properties; an absent prototype-named key
 * would still resolve through Object.prototype at read sites, and a present
 * `__proto__` key could not be assigned onto a plain object at all.
 */
export const nullProtoRecord = <T>(
  entries: ReadonlyMap<string, T>
): Record<string, T> => {
  // setPrototypeOf rather than Object.create + assign: fromEntries already
  // gives a correctly typed record, and Object.create returns `any`.
  const record = Object.fromEntries(entries);
  Object.setPrototypeOf(record, null);
  return record;
};

/**
 * zustand-persist `merge` that fills the keys an older build's blob lacks.
 * The default merge is shallow, so a persisted slice replaces the current
 * one wholesale and any key added since comes back undefined. Plain objects
 * merge recursively; a value the blob does have wins, including legacy keys
 * a slice migration still reads. Where the current value is an object or
 * array, a persisted value of another kind (`null`, a string) can't be
 * state this build reads, so the current value replaces it.
 */
export const fillPersistedDefaults = <T>(persisted: unknown, current: T): T =>
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- persisted webview/store state (#555): the blob is whatever an older build wrote; every key T declares is filled from `current`
  fillMissing(persisted, current) as T;

const fillMissing = (persisted: unknown, current: unknown): unknown => {
  if (Array.isArray(current)) {
    return Array.isArray(persisted) ? persisted : current;
  }
  if (!isPlainObject(current)) {
    return persisted === undefined ? current : persisted;
  }
  if (!isPlainObject(persisted)) return current;
  const merged: Record<string, unknown> = { ...persisted };
  for (const key of Object.keys(current)) {
    merged[key] = fillMissing(persisted[key], current[key]);
  }
  return merged;
};

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (typeof value !== "object" || value === null) return false;
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
};
