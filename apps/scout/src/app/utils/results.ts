import {
  isArrayValue,
  isBooleanValue,
  isNumberValue,
  isObjectValue,
  isStringValue,
  ScanResultSummary,
  SortColumn,
} from "../types";

export interface IdentifierInfo {
  taskSet?: string;
  id: string | number;
  secondaryId?: string | number;
  epoch?: number;
}

export const resultIdentifierStr = (
  summary?: ScanResultSummary
): string | undefined => {
  const identifier = resultIdentifier(summary);
  if (!identifier) {
    return undefined;
  }
  if (identifier.secondaryId || identifier.epoch) {
    const id: string[] = [];
    if (identifier.taskSet) {
      id.push(identifier.taskSet);
    }
    id.push(String(identifier.id));

    const result: string[] = [id.join("/")];
    if (identifier.secondaryId) {
      result.push(String(identifier.secondaryId));
    }
    if (identifier.epoch) {
      result.push(`(${String(identifier.epoch)})`);
    }
    return result.join(" ");
  }
};

export const resultIdentifier = (
  summary?: ScanResultSummary
): IdentifierInfo => {
  if (!summary) {
    return {
      id: "unknown",
    };
  }
  if (summary.inputType === "transcript") {
    // Look in the metadata for a sample identifier
    const sampleIdentifier = getSampleIdentifier(summary);
    if (sampleIdentifier) {
      return sampleIdentifier;
    }
  } else if (summary.inputType === "message") {
    const sampleIdentifier = getSampleIdentifier(summary);
    return {
      id: summary.transcriptSourceId,
      secondaryId: sampleIdentifier ? sampleIdentifier.id : undefined,
      epoch: sampleIdentifier ? sampleIdentifier.epoch : undefined,
    };
  } else if (summary.inputType === "event") {
    const sampleIdentifier = getSampleIdentifier(summary);
    return {
      id: summary.transcriptSourceId,
      secondaryId: sampleIdentifier ? sampleIdentifier.id : undefined,
      epoch: sampleIdentifier ? sampleIdentifier.epoch : undefined,
    };
  }

  return {
    id: summary.transcriptSourceId,
  };
};

const getSampleIdentifier = (
  summary: ScanResultSummary
): IdentifierInfo | undefined => {
  const id = summary.transcriptTaskId;
  const epoch = summary.transcriptTaskRepeat;

  if (id && epoch) {
    const taskSet = summary.transcriptTaskSet;
    return {
      id,
      epoch,
      taskSet,
    };
  }
  return undefined;
};

export const resultLog = (summary: ScanResultSummary): string | undefined => {
  if (summary.inputType === "transcript") {
    return summary.transcriptMetadata["log"] as string;
  }
  return undefined;
};

/**
 * Stringify a ScanResultSummary value for text search.
 * Handles all valueType variants so search covers the displayed result content.
 */
export const stringifyValue = (s: ScanResultSummary): string => {
  if (s.value === null || s.value === undefined) return "";
  if (isStringValue(s)) return s.value;
  if (isNumberValue(s) || isBooleanValue(s)) return String(s.value);
  if (isArrayValue(s)) return s.value.map(String).join(" ");
  if (isObjectValue(s)) {
    return Object.entries(s.value)
      .map(([k, v]) => `${k} ${v !== null && v !== undefined ? String(v) : ""}`)
      .join(" ");
  }
  return String(s.value);
};

// Type-aware comparison for ScanResultSummary values.
// Uses valueType to compare numerics, booleans, strings, arrays, and objects correctly.
// Nulls always sort last.
export const sortValue = (
  a: ScanResultSummary,
  b: ScanResultSummary
): number => {
  // Nulls sort last (after all other types)
  if (a.value === null || a.value === undefined || a.valueType === "null") {
    if (b.value === null || b.value === undefined || b.valueType === "null") {
      return 0;
    }
    return 1;
  }
  if (b.value === null || b.value === undefined || b.valueType === "null") {
    return -1;
  }

  // Same type: compare natively
  if (a.valueType === b.valueType) {
    if (isNumberValue(a) && isNumberValue(b)) {
      return a.value - b.value;
    }
    if (isBooleanValue(a) && isBooleanValue(b)) {
      return (a.value ? 1 : 0) - (b.value ? 1 : 0);
    }
    if (isStringValue(a) && isStringValue(b)) {
      return a.value.localeCompare(b.value);
    }
    if (isArrayValue(a) && isArrayValue(b)) {
      return (
        a.value.length - b.value.length ||
        String(a.value).localeCompare(String(b.value))
      );
    }
    if (isObjectValue(a) && isObjectValue(b)) {
      return JSON.stringify(a.value).localeCompare(JSON.stringify(b.value));
    }
  }

  // Different types: fall back to string comparison
  return String(a.value).localeCompare(String(b.value));
};

// Sorts scan results by multiple columns and directions.
// Applies sorting rules in order, falling back to the next rule if values are equal.
export const sortByColumns = (
  a: ScanResultSummary,
  b: ScanResultSummary,
  sortColumns: SortColumn[]
): number => {
  for (const sortCol of sortColumns) {
    let comparison = 0;

    switch (sortCol.column.toLowerCase()) {
      case "id": {
        const identifierA = resultIdentifier(a);
        const identifierB = resultIdentifier(b);

        if (
          typeof identifierA.id === "number" &&
          typeof identifierB.id === "number"
        ) {
          comparison = identifierA.id - identifierB.id;
        } else {
          comparison = String(identifierA.id).localeCompare(
            String(identifierB.id)
          );
        }

        if (comparison === 0 && identifierA.epoch && identifierB.epoch) {
          comparison = identifierA.epoch - identifierB.epoch;
        }
        break;
      }
      case "explanation": {
        const explA = a.explanation || "";
        const explB = b.explanation || "";
        comparison = explA.localeCompare(explB);
        break;
      }
      case "label": {
        const labelA = a.label || "";
        const labelB = b.label || "";
        comparison = labelA.localeCompare(labelB);
        break;
      }
      case "value": {
        comparison = sortValue(a, b);
        break;
      }
      case "error": {
        const errorA = a.scanError || "";
        const errorB = b.scanError || "";
        comparison = errorA.localeCompare(errorB);
        break;
      }
      case "validation": {
        const validationA = a.validationResult ? 1 : 0;
        const validationB = b.validationResult ? 1 : 0;
        comparison = validationA - validationB;
        break;
      }
      default:
        // Unknown column, skip
        continue;
    }

    // Apply direction (asc or desc)
    if (comparison !== 0) {
      return sortCol.direction === "asc" ? comparison : -comparison;
    }
  }

  // All comparisons are equal
  return 0;
};
