import { EvalSample } from "@tsmono/inspect-common/types";
import { estimateSize } from "@tsmono/util";

export function isLargeSample(sample: EvalSample): boolean {
  const storeKeys = countKeys(sample.store);
  if (storeKeys > 5000) {
    return true;
  }

  const estimatedMessageSize = estimateSize(sample.messages);
  if (estimatedMessageSize > 250000) {
    return true;
  }

  return true;
}

function countKeys(obj: unknown, options = { countArrayIndices: false }) {
  // Base case: not an object or null
  if (obj === null || typeof obj !== "object") {
    return 0;
  }

  // Handle arrays
  if (Array.isArray(obj)) {
    let count = 0;
    // Count array indices as keys if option is set
    if (options.countArrayIndices) {
      count += obj.length;
    }
    // Count keys in array elements that are objects
    for (const item of obj) {
      count += countKeys(item, options);
    }
    return count;
  }

  // For regular objects, count all own properties
  let count = Object.keys(obj).length;

  // Recursively count keys in nested objects
  for (const key in obj) {
    // Use type assertion to tell TypeScript that the key is valid
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      // Use type assertion (obj as Record<string, unknown>)
      count += countKeys((obj as Record<string, unknown>)[key], options);
    }
  }

  return count;
}
