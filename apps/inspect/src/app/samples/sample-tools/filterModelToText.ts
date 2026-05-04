import { FilterVarMapping, SampleFilterRegistry } from "./filterRegistry";

/** ag-grid filter shape — kept loose because the same JSON travels
 *  between this synthesizer, ag-grid's `setFilterModel`, and the
 *  recognizer in `astToFilterModel.ts`. The conditional logic below
 *  narrows by `type` at runtime. */
interface SimpleCondition {
  filterType?: string;
  type?: string;
  filter?: string | number | null;
  filterTo?: string | number | null;
}

interface CombinedCondition {
  filterType?: string;
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

  // `None` is filtrex's null sentinel (registered in
  // `filterExpressionConstants` in filters.ts) — emitting `null` would
  // resolve as an unbound identifier and error.
  if (t === "blank") return `${v} == None`;
  if (t === "notBlank") return `${v} != None`;

  // Number-style operators (also valid for string equals/notEqual).
  if (mapping.kind === "number") {
    const f = cond.filter;
    // Reject NaN / Infinity — ag-grid emits NaN when the user is mid-type
    // (e.g. "I" parses as NaN), and `var == NaN` is invalid filtrex.
    if (typeof f !== "number" || !Number.isFinite(f)) return null;
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
        if (typeof to !== "number" || !Number.isFinite(to)) return null;
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
    // OR isn't currently round-trippable through the AST recognizer
    // (top-level conjunction only). Skip the column rather than emit
    // text the recognizer would reject — that previously caused the
    // text→model effect to clear the entire grid filter.
    if (filter.operator === "OR") return null;
    const parts = conditions
      .map((c) => conditionToFiltrex(mapping, c))
      .filter((p): p is string => p !== null);
    if (parts.length === 0) return null;
    if (parts.length === 1) return parts[0];
    return `(${parts.join(" and ")})`;
  }

  return conditionToFiltrex(mapping, filter);
};

/**
 * Convert an ag-grid `FilterModel` into a filtrex expression suitable for
 * the toolbar text filter.
 *
 * Three return values, each with distinct semantics for the caller:
 *  - `""`     — the model is empty (no column filters); callers should
 *               clear the text.
 *  - `null`   — the model has entries but *none* are representable in the
 *               DSL; callers should leave the text alone.
 *  - string   — the synthesized filtrex expression.
 *
 * Columns that aren't in the registry or use unsupported operators are
 * skipped — the intent is best-effort surfacing of column filters.
 */
export const filterModelToText = (
  model: Record<string, AnyColumnFilter> | null | undefined,
  registry: SampleFilterRegistry
): string | null => {
  if (!model || Object.keys(model).length === 0) return "";
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
