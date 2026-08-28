import { isRecord } from "@tsmono/util";

export function printCircularReferences(obj: Record<string, unknown>): void {
  const seenObjects = new WeakMap<object, string>();

  function detect(value: unknown, path: string = ""): void {
    // Only proceed if value is an object (not null)
    if (value !== null && typeof value === "object") {
      // Check if we've seen this object before
      if (seenObjects.has(value)) {
        console.log(
          `Circular reference detected at path: ${seenObjects.get(value)}`
        );
        return;
      }

      // Store the current path for this object
      seenObjects.set(value, path);

      // Recursively check all properties
      for (const [key, entry] of Object.entries(value)) {
        detect(entry, `${path}.${key}`);
      }
    }
  }

  detect(obj, "root");
}

export function findDifferences(
  obj1: unknown,
  obj2: unknown,
  path = ""
): string[] {
  // Helper to build a readable path string
  const makePath = (parent: string, key: string | number, isIndex = false) =>
    parent
      ? isIndex
        ? `${parent}[${key}]`
        : `${parent}.${key}`
      : isIndex
        ? `[${key}]`
        : `${key}`;

  // Primitive / simple equality check (Object.is handles NaN)
  if (Object.is(obj1, obj2)) return [];

  // Primitives or null → direct difference
  if (
    obj1 === null ||
    obj2 === null ||
    typeof obj1 !== "object" ||
    typeof obj2 !== "object"
  ) {
    return [
      `${path || "<root>"}: ${JSON.stringify(obj1)} → ${JSON.stringify(obj2)}`,
    ];
  }

  // --- Arrays --------------------------------------------------------------
  const arr1 = Array.isArray(obj1) ? obj1 : null;
  const arr2 = Array.isArray(obj2) ? obj2 : null;
  if (arr1 || arr2) {
    if (!arr1 || !arr2) {
      return [`${path || "<root>"}: one is an array, the other is not`];
    }

    const diff: string[] = [];
    const maxLen = Math.max(arr1.length, arr2.length);

    if (arr1.length !== arr2.length) {
      diff.push(
        `${path || "<root>"}: array length ${arr1.length} vs ${arr2.length}`
      );
    }

    for (let i = 0; i < maxLen; i++) {
      diff.push(...findDifferences(arr1[i], arr2[i], makePath(path, i, true)));
    }
    return diff;
  }

  // --- Plain objects -------------------------------------------------------
  // Both are non-null objects and neither is an array by this point.
  if (!isRecord(obj1) || !isRecord(obj2)) {
    return [
      `${path || "<root>"}: ${JSON.stringify(obj1)} → ${JSON.stringify(obj2)}`,
    ];
  }
  const allKeys = new Set([...Object.keys(obj1), ...Object.keys(obj2)]);

  const diff: string[] = [];

  for (const key of allKeys) {
    const has1 = Object.hasOwn(obj1, key);
    const has2 = Object.hasOwn(obj2, key);
    const newPath = makePath(path, key);

    if (!has1) {
      diff.push(`${newPath}: property missing in first object`);
    } else if (!has2) {
      diff.push(`${newPath}: property missing in second object`);
    } else {
      diff.push(...findDifferences(obj1[key], obj2[key], newPath));
    }
  }

  return diff;
}
