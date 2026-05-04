import { FilterAst } from "./filterAst";
import { FilterVarMapping, SampleFilterRegistry } from "./filterRegistry";

type FilterType = "text" | "number";

interface SimpleCondition {
  type: string;
  filter?: string | number;
  filterTo?: string | number;
}

interface ColumnEntry {
  filterType: FilterType;
  type?: string;
  filter?: string | number;
  filterTo?: string | number;
  operator?: "AND" | "OR";
  conditions?: SimpleCondition[];
}

export type FilterModel = Record<string, ColumnEntry>;

interface PredicateResult {
  colId: string;
  filterType: FilterType;
  condition: SimpleCondition;
}

const REGEX_META = ".*+?^${}()|[]\\";

// Match the synthesizer's style: regex metachars are wrapped as `[X]`,
// literal backslash is written as `\\`. We don't accept bare `\X` for
// metachars because filtrex's lexer rejects them anyway.
const META_FOR_CLASS = ".*+?^${}()|[]";

/** Walk top-level `and` nodes, collecting leaf predicates. */
const collectAndPredicates = (ast: FilterAst): FilterAst[] => {
  if (ast.kind === "binary" && ast.op === "and") {
    return [
      ...collectAndPredicates(ast.left),
      ...collectAndPredicates(ast.right),
    ];
  }
  return [ast];
};

/** Try to interpret a `~=` regex literal as `^prefix`, `suffix$`, both, or
 *  plain `contains`. Returns `null` if the regex contains real metachars
 *  beyond the optional anchors. */
const parseRegexLiteral = (
  raw: string
): { anchor: "start" | "end" | "both" | "none"; literal: string } | null => {
  let s = raw;
  let anchorStart = false;
  let anchorEnd = false;
  if (s.startsWith("^")) {
    anchorStart = true;
    s = s.slice(1);
  }
  // Trailing `$` is an anchor unless escaped (`\$`).
  if (s.endsWith("$") && !s.endsWith("\\$")) {
    anchorEnd = true;
    s = s.slice(0, -1);
  }

  let literal = "";
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    // `[X]` character-class shorthand for a literal regex metachar.
    if (
      ch === "[" &&
      i + 2 < s.length &&
      s[i + 2] === "]" &&
      META_FOR_CLASS.includes(s[i + 1])
    ) {
      literal += s[i + 1];
      i += 3;
      continue;
    }
    // `\\` for a literal backslash.
    if (ch === "\\" && i + 1 < s.length && s[i + 1] === "\\") {
      literal += "\\";
      i += 2;
      continue;
    }
    if (REGEX_META.includes(ch)) return null; // unescaped metachar
    literal += ch;
    i++;
  }

  if (anchorStart && anchorEnd) return { anchor: "both", literal };
  if (anchorStart) return { anchor: "start", literal };
  if (anchorEnd) return { anchor: "end", literal };
  return { anchor: "none", literal };
};

/** Walk past a leading `not` to surface the inner predicate plus the
 *  effective negation count (parity). */
const stripNot = (ast: FilterAst): { negated: boolean; inner: FilterAst } => {
  let negated = false;
  let inner = ast;
  while (inner.kind === "unary" && inner.op === "not") {
    negated = !negated;
    inner = inner.arg;
  }
  return { negated, inner };
};

const opposite: Record<string, string> = {
  equals: "notEqual",
  notEqual: "equals",
  contains: "notContains",
  notContains: "contains",
  blank: "notBlank",
  notBlank: "blank",
};

/** Map a leaf predicate to a single-column condition. Returns null when
 *  the predicate isn't round-trippable. */
const predicateToCondition = (
  ast: FilterAst,
  registry: SampleFilterRegistry
): PredicateResult | null => {
  const { negated, inner } = stripNot(ast);
  const result = predicateToConditionInner(inner, registry);
  if (!result) return null;
  if (!negated) return result;
  const flipped = opposite[result.condition.type];
  if (!flipped) return null; // can't negate this operator
  return {
    ...result,
    condition: { ...result.condition, type: flipped },
  };
};

/** The non-negated portion of `predicateToCondition`. */
const predicateToConditionInner = (
  ast: FilterAst,
  registry: SampleFilterRegistry
): PredicateResult | null => {
  // 1. xxx_contains("literal") -> { contains, filter: literal }
  if (ast.kind === "call" && ast.args.length === 1) {
    const fn = ast.fn;
    const arg = ast.args[0];
    if (arg.kind !== "str") return null;
    const colId = colIdForContainsFn(fn, registry);
    if (!colId) return null;
    const mapping = registry.byColId.get(colId)!;
    // The synthesizer regex-escapes the value before emitting; reverse
    // that here so the FilterModel round-trips to the user's input. If
    // the literal isn't a plain regex-escaped string, skip.
    const parsed = parseRegexLiteral(arg.value);
    if (!parsed || parsed.anchor !== "none") return null;
    return {
      colId,
      filterType: filterTypeFor(mapping),
      condition: { type: "contains", filter: parsed.literal },
    };
  }

  // 2. var BINARY_OP literal
  if (ast.kind === "binary") {
    return binaryToCondition(ast, registry);
  }

  return null;
};

const colIdForContainsFn = (
  fn: string,
  registry: SampleFilterRegistry
): string | null => {
  for (const [colId, mapping] of registry.byColId) {
    if (mapping.containsFn === fn) return colId;
  }
  return null;
};

const filterTypeFor = (m: FilterVarMapping): FilterType =>
  m.kind === "number" ? "number" : "text";

const binaryToCondition = (
  ast: Extract<FilterAst, { kind: "binary" }>,
  registry: SampleFilterRegistry
): PredicateResult | null => {
  // Only handle `var op literal` (or `var op None`).
  if (ast.left.kind !== "var") return null;
  const colId = registry.byVariable.get(ast.left.name);
  if (!colId) return null;
  const mapping = registry.byColId.get(colId)!;

  // var == None / var != None  ->  blank / notBlank
  if (ast.right.kind === "const" && ast.right.name === "None") {
    if (ast.op === "==") {
      return {
        colId,
        filterType: filterTypeFor(mapping),
        condition: { type: "blank" },
      };
    }
    if (ast.op === "!=") {
      return {
        colId,
        filterType: filterTypeFor(mapping),
        condition: { type: "notBlank" },
      };
    }
    return null;
  }

  // var ~= "regex"  ->  contains / startsWith / endsWith / equals
  if (ast.op === "~=" && ast.right.kind === "str") {
    if (mapping.kind !== "string") return null;
    const parsed = parseRegexLiteral(ast.right.value);
    if (!parsed) return null;
    let type: string;
    switch (parsed.anchor) {
      case "both":
        type = "equals";
        break;
      case "start":
        type = "startsWith";
        break;
      case "end":
        type = "endsWith";
        break;
      case "none":
        type = "contains";
        break;
    }
    return {
      colId,
      filterType: "text",
      condition: { type, filter: parsed.literal },
    };
  }

  // Numeric comparators
  if (mapping.kind === "number" && ast.right.kind === "num") {
    const opMap: Record<string, string> = {
      "==": "equals",
      "!=": "notEqual",
      "<": "lessThan",
      "<=": "lessThanOrEqual",
      ">": "greaterThan",
      ">=": "greaterThanOrEqual",
    };
    const type = opMap[ast.op];
    if (!type) return null;
    return {
      colId,
      filterType: "number",
      condition: { type, filter: ast.right.value },
    };
  }

  // String equals/notEqual
  if (mapping.kind === "string" && ast.right.kind === "str") {
    if (ast.op === "==") {
      return {
        colId,
        filterType: "text",
        condition: { type: "equals", filter: ast.right.value },
      };
    }
    if (ast.op === "!=") {
      return {
        colId,
        filterType: "text",
        condition: { type: "notEqual", filter: ast.right.value },
      };
    }
  }

  return null;
};

/** Detect the inRange pattern: `>= a` AND `<= b` on the same numeric
 *  column. Returns the equivalent simple condition or null. */
const tryInRange = (conds: SimpleCondition[]): SimpleCondition | null => {
  if (conds.length !== 2) return null;
  const [a, b] = conds;
  let lower: number | undefined;
  let upper: number | undefined;
  for (const c of [a, b]) {
    if (c.type === "greaterThanOrEqual" && typeof c.filter === "number") {
      lower = c.filter;
    } else if (c.type === "lessThanOrEqual" && typeof c.filter === "number") {
      upper = c.filter;
    }
  }
  if (lower === undefined || upper === undefined) return null;
  return { type: "inRange", filter: lower, filterTo: upper };
};

/**
 * Try to express the AST as an ag-grid `FilterModel`. The recognized
 * subset is a top-level conjunction of column predicates — anything
 * else (`or`, arithmetic, function calls outside `xxx_contains`,
 * unsupported operators) returns `null`, signaling to the caller that
 * the text is "expression-only".
 */
export const astToFilterModel = (
  ast: FilterAst,
  registry: SampleFilterRegistry
): FilterModel | null => {
  const predicates = collectAndPredicates(ast);

  const perColumn = new Map<
    string,
    { filterType: FilterType; conditions: SimpleCondition[] }
  >();

  for (const pred of predicates) {
    const result = predicateToCondition(pred, registry);
    if (!result) return null;
    let entry = perColumn.get(result.colId);
    if (!entry) {
      entry = { filterType: result.filterType, conditions: [] };
      perColumn.set(result.colId, entry);
    }
    if (entry.filterType !== result.filterType) return null;
    entry.conditions.push(result.condition);
  }

  const model: FilterModel = {};
  for (const [colId, entry] of perColumn) {
    if (entry.conditions.length === 1) {
      model[colId] = { filterType: entry.filterType, ...entry.conditions[0] };
    } else if (entry.conditions.length === 2) {
      const range = tryInRange(entry.conditions);
      if (range) {
        model[colId] = { filterType: entry.filterType, ...range };
      } else {
        model[colId] = {
          filterType: entry.filterType,
          operator: "AND",
          conditions: entry.conditions,
        };
      }
    } else {
      // ag-grid combined filters cap at 2 conditions per column.
      return null;
    }
  }

  return model;
};
