import { FilterVarMapping, SampleFilterRegistry } from "./filterRegistry";

/** ag-grid filter operator names (subset we round-trip). */
type SimpleType =
  | "equals"
  | "notEqual"
  | "lessThan"
  | "lessThanOrEqual"
  | "greaterThan"
  | "greaterThanOrEqual"
  | "inRange"
  | "blank"
  | "notBlank"
  | "contains"
  | "notContains"
  | "startsWith"
  | "endsWith";

interface SimpleCondition {
  filterType?: "text" | "number" | "date";
  type?: SimpleType;
  filter?: string | number | null;
  filterTo?: string | number | null;
}

interface CombinedCondition {
  filterType?: "text" | "number" | "date";
  operator?: "AND" | "OR";
  conditions?: SimpleCondition[];
  // Legacy ag-grid shape:
  condition1?: SimpleCondition;
  condition2?: SimpleCondition;
}

type AnyColumnFilter = SimpleCondition & CombinedCondition;

const REGEX_META = /[.*+?^${}()|[\]\\]/g;
const regexEscape = (s: string): string => s.replace(REGEX_META, "\\$&");

const stringLiteral = (s: string): string => JSON.stringify(s);

const numberLiteral = (n: number): string => String(n);

/** Convert a single ag-grid simple condition into a filtrex predicate
 *  (string), or `null` if we can't represent it. */
const conditionToFiltrex = (
  mapping: FilterVarMapping,
  cond: SimpleCondition
): string | null => {
  const v = mapping.variable;
  const t = cond.type;
  if (!t) return null;

  if (t === "blank") return `${v} == null`;
  if (t === "notBlank") return `${v} != null`;

  // Number-style operators (also valid for string equals/notEqual).
  if (mapping.kind === "number") {
    const f = cond.filter;
    if (typeof f !== "number") return null;
    switch (t) {
      case "equals":
        return `${v} == ${numberLiteral(f)}`;
      case "notEqual":
        return `${v} != ${numberLiteral(f)}`;
      case "lessThan":
        return `${v} < ${numberLiteral(f)}`;
      case "lessThanOrEqual":
        return `${v} <= ${numberLiteral(f)}`;
      case "greaterThan":
        return `${v} > ${numberLiteral(f)}`;
      case "greaterThanOrEqual":
        return `${v} >= ${numberLiteral(f)}`;
      case "inRange": {
        const to = cond.filterTo;
        if (typeof to !== "number") return null;
        return `(${v} >= ${numberLiteral(f)} and ${v} <= ${numberLiteral(to)})`;
      }
      default:
        return null;
    }
  }

  // String column.
  const f = cond.filter;
  if (typeof f !== "string") return null;

  switch (t) {
    case "equals":
      return `${v} == ${stringLiteral(f)}`;
    case "notEqual":
      return `${v} != ${stringLiteral(f)}`;
    case "contains":
      return mapping.containsFn
        ? `${mapping.containsFn}(${stringLiteral(regexEscape(f))})`
        : `${v} ~= ${stringLiteral(regexEscape(f))}`;
    case "notContains":
      return mapping.containsFn
        ? `not ${mapping.containsFn}(${stringLiteral(regexEscape(f))})`
        : `not (${v} ~= ${stringLiteral(regexEscape(f))})`;
    case "startsWith":
      return `${v} ~= ${stringLiteral("^" + regexEscape(f))}`;
    case "endsWith":
      return `${v} ~= ${stringLiteral(regexEscape(f) + "$")}`;
    default:
      return null;
  }
};

/** Convert a full per-column filter (simple OR combined) to a filtrex
 *  predicate. */
const columnFilterToFiltrex = (
  mapping: FilterVarMapping,
  filter: AnyColumnFilter
): string | null => {
  // Combined: prefer the modern `conditions` array; fall back to
  // condition1/condition2 for older shapes.
  const conditions =
    filter.conditions ??
    [filter.condition1, filter.condition2].filter(
      (c): c is SimpleCondition => !!c
    );

  if (conditions.length > 0 && filter.operator) {
    const parts = conditions
      .map((c) => conditionToFiltrex(mapping, c))
      .filter((p): p is string => p !== null);
    if (parts.length === 0) return null;
    if (parts.length === 1) return parts[0];
    const joiner = filter.operator === "OR" ? " or " : " and ";
    return `(${parts.join(joiner)})`;
  }

  return conditionToFiltrex(mapping, filter);
};

/**
 * Convert an ag-grid `FilterModel` into a filtrex expression suitable for
 * the toolbar text filter.
 *
 * Returns `null` when the model contains *only* unrepresentable columns
 * (so callers can leave the text filter alone). Columns that exist but
 * aren't in the registry, or use unsupported operators, are skipped — the
 * intent is best-effort surfacing of column filters in the DSL.
 */
export const filterModelToText = (
  model: Record<string, AnyColumnFilter> | null | undefined,
  registry: SampleFilterRegistry
): string | null => {
  if (!model) return null;
  const parts: string[] = [];
  for (const [colId, filter] of Object.entries(model)) {
    const mapping = registry.byColId.get(colId);
    if (!mapping) continue;
    const text = columnFilterToFiltrex(mapping, filter);
    if (text !== null) parts.push(text);
  }
  if (parts.length === 0) return null;
  if (parts.length === 1) return parts[0];
  return parts.join(" and ");
};
