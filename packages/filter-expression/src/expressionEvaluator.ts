/**
 * Tree-walking evaluator for sample filter expressions, a drop-in for
 * filtrex 3.1's `compileExpression` that never generates or evaluates
 * code, so it runs under a Content-Security-Policy without 'unsafe-eval'.
 *
 * Semantics, coercions, error classes and messages follow filtrex's
 * `filtrex.mjs`, `utils.mjs` and `errors.mjs`, quirks included.
 */
import {
  ArithmeticOperator,
  ExpressionNode,
  parseExpression,
  RelationalOperator,
  SymbolRef,
  SymbolType,
} from "./expressionParser";

/** Runtime error: a function that is neither built in nor supplied. */
export class UnknownFunctionError extends ReferenceError {
  readonly I18N_STRING = "UNKNOWN_FUNCTION";
  readonly functionName: string;

  constructor(functionName: string) {
    super(`Unknown function: ${functionName}()`);
    this.functionName = functionName;
  }
}

/** Runtime error: a property missing from the data and the constants. */
export class UnknownPropertyError extends ReferenceError {
  readonly I18N_STRING = "UNKNOWN_PROPERTY";
  readonly propertyName: string;

  constructor(propertyName: string) {
    super(`Property “${propertyName}” does not exist.`);
    this.propertyName = propertyName;
  }
}

/** Runtime error: an operator or keyword received the wrong type. */
export class UnexpectedTypeError extends TypeError {
  readonly I18N_STRING = "UNEXPECTED_TYPE";
  readonly expectedType: string;
  readonly recievedType: string;

  constructor(expected: string, got: string) {
    super(`Expected a ${expected}, but got a ${got} instead.`);
    this.expectedType = expected;
    this.recievedType = got;
  }
}

export type FilterFunction = (...args: never[]) => unknown;

/** Resolves a symbol; `get` throws `UnknownPropertyError` if `obj` lacks it. */
export type CustomProp = (
  name: string,
  get: (name: string) => unknown,
  obj: unknown,
  type: SymbolType
) => unknown;

export interface CompileFilterOptions {
  extraFunctions?: Record<string, FilterFunction>;
  /** Values for unquoted symbols, checked before the data. */
  constants?: Record<string, unknown>;
  customProp?: CustomProp;
}

const hasOwnProperty = (obj: unknown, name: string): obj is object =>
  (typeof obj === "object" || typeof obj === "function") &&
  obj !== null &&
  Object.prototype.hasOwnProperty.call(obj, name);

const ownProperty = (obj: unknown, name: string): unknown => {
  if (hasOwnProperty(obj, name)) {
    const value: unknown = Reflect.get(obj, name);
    return value;
  }
  throw new UnknownPropertyError(name);
};

// Coercions, as filtrex's utils.mjs. Note that `unbox` maps every object
// other than a boxed primitive (null included) to undefined, so type
// errors report arrays, objects and null as "undefined".
const unbox = (value: unknown): unknown => {
  if (typeof value !== "object") return value;
  if (
    value instanceof Number ||
    value instanceof String ||
    value instanceof Boolean
  ) {
    return value.valueOf();
  }
  return undefined;
};

const unwrap = (value: unknown): unknown => {
  if (Array.isArray(value) && value.length === 1) {
    const only: unknown = value[0];
    return unbox(only);
  }
  return unbox(value);
};

const prettyType = (raw: unknown): string => {
  const value = unwrap(raw);
  if (value === undefined) return "undefined";
  if (value === true) return "true";
  if (value === false) return "false";
  if (typeof value === "number") return "number";
  if (typeof value === "string") return "text";
  if (typeof value !== "function") return "unknown type";
  return "object";
};

const num = (raw: unknown): number => {
  const value = unwrap(raw);
  if (typeof value === "number") return value;
  throw new UnexpectedTypeError("number", prettyType(raw));
};

const str = (raw: unknown): string => {
  const value = unwrap(raw);
  if (typeof value === "string") return value;
  throw new UnexpectedTypeError("text", prettyType(raw));
};

const numstr = (raw: unknown): number | string => {
  const value = unwrap(raw);
  if (typeof value === "string" || typeof value === "number") return value;
  throw new UnexpectedTypeError("text or number", prettyType(raw));
};

const bool = (raw: unknown): boolean => {
  const value = unwrap(raw);
  if (typeof value === "boolean") return value;
  throw new UnexpectedTypeError(
    "logical value (“true” or “false”)",
    prettyType(raw)
  );
};

const arr = (value: unknown): unknown[] => {
  if (value === undefined || value === null) {
    throw new UnexpectedTypeError("list", prettyType(value));
  }
  return Array.isArray(value) ? value : [value];
};

const isSubset = (a: unknown, b: unknown): boolean => {
  const setA = arr(a);
  const setB = arr(b);
  return setA.every((value) => setB.includes(value));
};

const arithmetic = (
  op: ArithmeticOperator,
  a: unknown,
  b: unknown
): number | string => {
  switch (op) {
    case "+": {
      const left = numstr(a);
      const right = numstr(b);
      return typeof left === "number" && typeof right === "number"
        ? left + right
        : String(left) + String(right);
    }
    // filtrex's `-` is also its unary minus, keyed on a missing second
    // operand, so `x - y` negates x when y is undefined.
    case "-":
      return b === undefined ? -num(a) : num(a) - num(b);
    case "*":
      return num(a) * num(b);
    case "/":
      return num(a) / num(b);
    case "^":
      return Math.pow(num(a), num(b));
    case "mod":
    case "%": {
      const left = num(a);
      const right = num(b);
      return ((left % right) + right) % right;
    }
  }
};

const compare = (op: RelationalOperator, a: unknown, b: unknown): boolean => {
  switch (op) {
    case "==":
      return a === b;
    case "!=":
      return a !== b;
    case "<":
      return num(a) < num(b);
    case "<=":
      return num(a) <= num(b);
    case ">=":
      return num(a) >= num(b);
    case ">":
      return num(a) > num(b);
    case "~=":
      return new RegExp(str(b)).test(str(a));
  }
};

// Shared across compiled expressions, like filtrex's module-level counter.
const kMaxDeprecationWarnings = 3;
const deprecationWarnings = { ternary: 0, modulo: 0 };
const kDeprecationMessages = {
  ternary:
    "The use of ? and : as conditional operators has been deprecated " +
    "in Filtrex v3 in favor of the if..then..else ternary operator. " +
    "See issue #34 for more information.",
  modulo:
    "The use of '%' as a modulo operator has been deprecated in Filtrex v3 " +
    "in favor of the 'mod' operator. You can use it like this: '3 mod 2 == 1'. " +
    "See issue #48 for more information.",
};

const warnDeprecated = <T>(cause: "ternary" | "modulo", value: T): T => {
  if (deprecationWarnings[cause]++ < kMaxDeprecationWarnings) {
    console.warn(kDeprecationMessages[cause]);
  }
  return value;
};

const kBuiltinFunctions: Record<string, FilterFunction> = {
  abs: Math.abs,
  ceil: Math.ceil,
  floor: Math.floor,
  log: Math.log,
  log2: Math.log2,
  log10: Math.log10,
  max: Math.max,
  min: Math.min,
  round: Math.round,
  sqrt: Math.sqrt,
  exists: (v: unknown) => v !== undefined && v !== null,
  empty: (v: unknown) =>
    v === undefined ||
    v === null ||
    v === "" ||
    (Array.isArray(v) && v.length === 0),
};

interface Scope {
  data: unknown;
  functions: Record<string, FilterFunction | undefined>;
  constants: Record<string, unknown>;
  resolve: (name: string, obj: unknown, type: SymbolType) => unknown;
}

const property = (
  scope: Scope,
  { name, type }: SymbolRef,
  obj: unknown
): unknown => {
  if (type === "unescaped" && hasOwnProperty(scope.constants, name)) {
    return scope.constants[name];
  }
  return scope.resolve(name, obj, type);
};

const call = (scope: Scope, name: string, args: unknown[]): unknown => {
  const fn: unknown = hasOwnProperty(scope.functions, name)
    ? scope.functions[name]
    : undefined;
  if (typeof fn !== "function") throw new UnknownFunctionError(name);
  const result: unknown = Reflect.apply(fn, scope.functions, args);
  return result;
};

// Operands evaluate left to right before their operator applies, as they
// do as arguments in filtrex's generated code; that order decides which
// error a faulty expression reports.
const evaluate = (node: ExpressionNode, scope: Scope): unknown => {
  switch (node.kind) {
    case "number":
    case "string":
      return node.value;
    case "group":
      return evaluate(node.inner, scope);
    case "tuple":
      return node.items.map((item) => evaluate(item, scope));
    case "property": {
      const obj = node.object ? evaluate(node.object, scope) : scope.data;
      return property(scope, node.symbol, obj);
    }
    case "call": {
      const args = node.args.map((arg) => evaluate(arg, scope));
      return call(scope, node.symbol.name, args);
    }
    case "negate":
      return -num(evaluate(node.arg, scope));
    case "not":
      return !bool(evaluate(node.arg, scope));
    case "arithmetic": {
      const left = evaluate(node.left, scope);
      const right = evaluate(node.right, scope);
      const value = arithmetic(node.op, left, right);
      return node.op === "%" ? warnDeprecated("modulo", value) : value;
    }
    case "logical":
      return node.op === "and"
        ? bool(evaluate(node.left, scope)) && bool(evaluate(node.right, scope))
        : bool(evaluate(node.left, scope)) || bool(evaluate(node.right, scope));
    case "in": {
      const left = evaluate(node.left, scope);
      const right = evaluate(node.right, scope);
      return isSubset(left, right) !== node.negated;
    }
    case "relation": {
      let previous = evaluate(node.first, scope);
      let result = true;
      for (const { op, operand } of node.rest) {
        const next = evaluate(operand, scope);
        result = compare(op, previous, next);
        if (!result) return result;
        previous = next;
      }
      return result;
    }
    case "conditional": {
      const value = bool(evaluate(node.test, scope))
        ? evaluate(node.consequent, scope)
        : evaluate(node.alternate, scope);
      return node.deprecatedTernary ? warnDeprecated("ternary", value) : value;
    }
  }
};

/**
 * Compile a filter expression. Malformed input throws (see
 * `parseExpression`); the returned function never throws, returning any
 * error raised while evaluating instead, as filtrex's does.
 */
export const compileFilterExpression = (
  expression: string,
  options: CompileFilterOptions = {}
): ((data: unknown) => unknown) => {
  const tree = parseExpression(expression);

  const functions: Record<string, FilterFunction | undefined> = {
    ...kBuiltinFunctions,
  };
  const extraFunctions = options.extraFunctions ?? {};
  for (const name of Object.keys(extraFunctions)) {
    functions[name] = extraFunctions[name];
  }
  const constants = options.constants ?? {};
  const customProp = options.customProp;
  const resolve = (name: string, obj: unknown, type: SymbolType): unknown =>
    customProp
      ? customProp(name, (key) => ownProperty(obj, key), obj, type)
      : ownProperty(obj, name);

  return (data: unknown): unknown => {
    try {
      return evaluate(tree, { data, functions, constants, resolve });
    } catch (error) {
      return error;
    }
  };
};
