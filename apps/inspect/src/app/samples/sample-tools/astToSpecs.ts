import type {
  ColumnFilter,
  FilterSpec,
  UiOperator,
} from "@tsmono/inspect-components/columnFilter";

import { FilterAst, parseFilter } from "./filterAst";
import { FilterVarKind, SampleFilterSpecRegistry } from "./filterSpecRegistry";

interface PredicateResult {
  colId: string;
  kind: FilterVarKind;
  spec: FilterSpec;
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
    const ch = s[i] ?? "";
    const next = s[i + 1] ?? "";
    // `[X]` character-class shorthand for a literal regex metachar.
    if (
      ch === "[" &&
      i + 2 < s.length &&
      s[i + 2] === "]" &&
      META_FOR_CLASS.includes(next)
    ) {
      literal += next;
      i += 3;
      continue;
    }
    // `\\` for a literal backslash.
    if (ch === "\\" && next === "\\") {
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

const opposite: Partial<Record<UiOperator, UiOperator>> = {
  "=": "!=",
  "!=": "=",
  contains: "does not contain",
  "does not contain": "contains",
  "is blank": "is not blank",
  "is not blank": "is blank",
};

const colIdForContainsFn = (
  fn: string,
  registry: SampleFilterSpecRegistry
): string | null => {
  for (const [colId, mapping] of registry.byColId) {
    if (mapping.containsFn === fn) return colId;
  }
  return null;
};

const binaryToSpec = (
  ast: Extract<FilterAst, { kind: "binary" }>,
  registry: SampleFilterSpecRegistry
): PredicateResult | null => {
  // Only handle `var op literal` (or `var op None`).
  if (ast.left.kind !== "var") return null;
  const colId = registry.byVariable.get(ast.left.name);
  if (!colId) return null;
  const mapping = registry.byColId.get(colId);
  if (!mapping) return null;

  // var == None / var != None  ->  is blank / is not blank
  if (ast.right.kind === "const" && ast.right.name === "None") {
    if (ast.op === "==") {
      return {
        colId,
        kind: mapping.kind,
        spec: { operator: "is blank", value: "" },
      };
    }
    if (ast.op === "!=") {
      return {
        colId,
        kind: mapping.kind,
        spec: { operator: "is not blank", value: "" },
      };
    }
    return null;
  }

  // var ~= "regex"  ->  contains / starts with / ends with / =
  if (ast.op === "~=" && ast.right.kind === "str") {
    if (mapping.kind !== "string") return null;
    const parsed = parseRegexLiteral(ast.right.value);
    if (!parsed) return null;
    let operator: UiOperator;
    switch (parsed.anchor) {
      case "both":
        operator = "=";
        break;
      case "start":
        operator = "starts with";
        break;
      case "end":
        operator = "ends with";
        break;
      case "none":
        operator = "contains";
        break;
    }
    return {
      colId,
      kind: mapping.kind,
      spec: { operator, value: parsed.literal },
    };
  }

  // Numeric comparators
  if (mapping.kind === "number" && ast.right.kind === "num") {
    const opMap: Partial<Record<string, UiOperator>> = {
      "==": "=",
      "!=": "!=",
      "<": "<",
      "<=": "<=",
      ">": ">",
      ">=": ">=",
    };
    const operator = opMap[ast.op];
    if (!operator) return null;
    return {
      colId,
      kind: mapping.kind,
      spec: { operator, value: String(ast.right.value) },
    };
  }

  // String equals/notEqual
  if (mapping.kind === "string" && ast.right.kind === "str") {
    if (ast.op === "==") {
      return {
        colId,
        kind: mapping.kind,
        spec: { operator: "=", value: ast.right.value },
      };
    }
    if (ast.op === "!=") {
      return {
        colId,
        kind: mapping.kind,
        spec: { operator: "!=", value: ast.right.value },
      };
    }
  }

  return null;
};

/** The non-negated portion of `predicateToSpec`. */
const predicateToSpecInner = (
  ast: FilterAst,
  registry: SampleFilterSpecRegistry
): PredicateResult | null => {
  // 1. xxx_contains("literal") -> { contains, value: literal }
  if (ast.kind === "call" && ast.args.length === 1) {
    const fn = ast.fn;
    const arg = ast.args[0];
    if (!arg || arg.kind !== "str") return null;
    const colId = colIdForContainsFn(fn, registry);
    if (!colId) return null;
    const mapping = registry.byColId.get(colId);
    if (!mapping) return null;
    // The synthesizer regex-escapes the value before emitting; reverse
    // that here so the spec round-trips to the user's input. If the
    // literal isn't a plain regex-escaped string, skip.
    const parsed = parseRegexLiteral(arg.value);
    if (!parsed || parsed.anchor !== "none") return null;
    return {
      colId,
      kind: mapping.kind,
      spec: { operator: "contains", value: parsed.literal },
    };
  }

  // 2. var BINARY_OP literal
  if (ast.kind === "binary") {
    return binaryToSpec(ast, registry);
  }

  return null;
};

/** Map a leaf predicate to a single-column spec. Returns null when the
 *  predicate isn't round-trippable. */
const predicateToSpec = (
  ast: FilterAst,
  registry: SampleFilterSpecRegistry
): PredicateResult | null => {
  const { negated, inner } = stripNot(ast);
  const result = predicateToSpecInner(inner, registry);
  if (!result) return null;
  if (!negated) return result;
  const flipped = opposite[result.spec.operator];
  if (!flipped) return null; // can't negate this operator
  return {
    ...result,
    spec: { ...result.spec, operator: flipped },
  };
};

/** Detect the between pattern: `>= a` AND `<= b` on the same numeric
 *  column. Returns the equivalent single spec or null. */
const tryBetween = (specs: FilterSpec[]): FilterSpec | null => {
  if (specs.length !== 2) return null;
  const [a, b] = specs;
  if (!a || !b) return null;
  let lower: string | undefined;
  let upper: string | undefined;
  for (const s of [a, b]) {
    if (s.operator === ">=") lower = s.value;
    else if (s.operator === "<=") upper = s.value;
  }
  if (lower === undefined || upper === undefined) return null;
  return { operator: "between", value: lower, value2: upper };
};

/**
 * Try to express the AST as per-column filter specs. The recognized
 * subset is a top-level conjunction of column predicates — anything
 * else (`or`, arithmetic, function calls outside `xxx_contains`,
 * unsupported operators) returns `null`, signaling to the caller that
 * the text is "expression-only".
 */
export function astToSpecs(
  ast: FilterAst,
  registry: SampleFilterSpecRegistry
): Record<string, ColumnFilter> | null {
  const predicates = collectAndPredicates(ast);

  const perColumn = new Map<string, { kind: FilterVarKind; specs: FilterSpec[] }>();

  for (const pred of predicates) {
    const result = predicateToSpec(pred, registry);
    if (!result) return null;
    let column = perColumn.get(result.colId);
    if (!column) {
      column = { kind: result.kind, specs: [] };
      perColumn.set(result.colId, column);
    }
    if (column.kind !== result.kind) return null;
    column.specs.push(result.spec);
  }

  const specs: Record<string, ColumnFilter> = {};
  for (const [colId, column] of perColumn) {
    const filterType = column.kind === "number" ? "number" : "string";
    if (column.specs.length === 1) {
      const [spec] = column.specs;
      if (!spec) return null;
      specs[colId] = { columnId: colId, filterType, spec };
    } else if (column.specs.length === 2) {
      // Only the >=/<= pair folds back into a single condition — the
      // popover holds one condition per column, unlike main's ag-grid
      // combined AND filter (see plan's "accepted parity loss").
      const between = tryBetween(column.specs);
      if (!between) return null;
      specs[colId] = { columnId: colId, filterType, spec: between };
    } else {
      // ≥3 predicates on one column can't be represented in the popover.
      return null;
    }
  }

  return specs;
}

/** Parse + recognize in one step. `""`/whitespace → `{}`. Parse error or
 *  unrepresentable expression → null. */
export function parseFilterSpecs(
  text: string,
  registry: SampleFilterSpecRegistry
): Record<string, ColumnFilter> | null {
  if (text.trim() === "") return {};
  const { ast } = parseFilter(text);
  if (!ast) return null;
  return astToSpecs(ast, registry);
}
