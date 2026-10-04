import { compileExpression } from "filtrex";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  compileFilterExpression,
  CompileFilterOptions,
  UnknownPropertyError,
} from "./expressionEvaluator";
import {
  kCorpus,
  kCorpusChunks,
  kHandPickedExpressions,
} from "./expressionTestCorpus";

const kData: Record<string, unknown> = {
  a: 1,
  b: 2,
  c: 3,
  d: 4,
  s: "str",
  t: true,
  f: false,
  n: null,
  u: undefined,
  one: [1],
  arr: [1, 2],
  empty_arr: [],
  nan: NaN,
  inf: Infinity,
  obj: { x: 1, "a.b": 2, valueOf: 5 },
  wrap: { obj: { x: 7 } },
  "obj.x": 9,
  "quoted name": "q",
  epoch: 2,
  has_error: false,
  tokens: 150,
  duration: 1.2,
  input: "the input",
  target: "the target",
  error: null,
  id: 1,
  uuid: "abc",
  other: 9,
  "grader.epoch": 99,
  "graderA.score": 0.7,
  "scorer.metric": 0.3,
  metadata: { nested: { value: 5 } },
};

// Mirrors the options `filterExpression` in filters.ts passes.
const sampleLikeOptions = (): CompileFilterOptions => {
  const inputContains = (regex: string): boolean =>
    new RegExp(regex, "i").test("the input");
  const sampleVariables = new Set(["epoch", "has_error", "input", "metadata"]);
  return {
    extraFunctions: {
      input_contains: inputContains,
      target_contains: inputContains,
      is_nan: (value: unknown) =>
        typeof value === "number" && Number.isNaN(value),
    },
    constants: { True: true, False: false, None: null },
    customProp: (name, get) => {
      if (sampleVariables.has(name)) return get(name);
      if (name.startsWith("metadata.")) {
        return name === "metadata.nested.value" ? 5 : undefined;
      }
      // An errored sample's scores resolve to undefined.
      return name === "c" ? undefined : get(name);
    },
  };
};

type Outcome =
  | { compileError: string; message: string }
  | { value: unknown }
  | {
      error: string;
      message: string;
      propertyName: unknown;
      functionName: unknown;
    };

const thrownOutcome = (error: unknown): Outcome => {
  if (!(error instanceof Error)) return { compileError: "thrown", message: "" };
  const syntax = /^(Parse|Lexical) error/.test(error.message);
  return {
    compileError: error.constructor.name,
    message: syntax
      ? error.message.split("\n").slice(0, 3).join("\n")
      : error.message,
  };
};

const resultOutcome = (result: unknown): Outcome =>
  result instanceof Error
    ? {
        error: result.constructor.name,
        message: result.message,
        propertyName: Reflect.get(result, "propertyName"),
        functionName: Reflect.get(result, "functionName"),
      }
    : { value: result };

type Compile = (
  expression: string,
  options: CompileFilterOptions | undefined
) => (data: unknown) => unknown;

const filtrex: Compile = (expression, options) => {
  const fn = compileExpression(expression, options);
  return (data) => {
    const result: unknown = fn(data);
    return result;
  };
};

const ours: Compile = compileFilterExpression;

const outcome = (
  compile: Compile,
  expression: string,
  options: CompileFilterOptions | undefined
): Outcome => {
  let fn: (data: unknown) => unknown;
  try {
    fn = compile(expression, options);
  } catch (error) {
    return thrownOutcome(error);
  }
  return resultOutcome(fn(kData));
};

const kConfigurations: Array<[string, () => CompileFilterOptions | undefined]> =
  [
    ["no options", () => undefined],
    ["the sample filter's options", sampleLikeOptions],
  ];

describe.each(kConfigurations)(
  "compileFilterExpression matches filtrex with %s",
  (_, options) => {
    beforeEach(() => {
      vi.spyOn(console, "warn").mockImplementation(() => undefined);
    });
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it.each(kHandPickedExpressions)("%j", (expression) => {
      expect(outcome(ours, expression, options())).toEqual(
        outcome(filtrex, expression, options())
      );
    });

    it.each(kCorpusChunks)(
      "agrees on corpus expressions $label",
      ({ expressions }) => {
        const mismatches = expressions.filter((expression) => {
          const expected = outcome(filtrex, expression, options());
          const actual = outcome(ours, expression, options());
          try {
            expect(actual).toEqual(expected);
            return false;
          } catch {
            return true;
          }
        });
        expect(mismatches).toEqual([]);
      }
    );
  }
);

describe("compileFilterExpression", () => {
  it("reaches every kind of outcome across the corpus", () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const kinds = new Set(
      kCorpus.map((expression) => {
        const result = outcome(ours, expression, sampleLikeOptions());
        if ("compileError" in result) return `compile ${result.compileError}`;
        if ("error" in result) return `runtime ${result.error}`;
        return typeof result.value === "boolean"
          ? String(result.value)
          : typeof result.value;
      })
    );
    vi.restoreAllMocks();
    expect([...kinds]).toEqual(
      expect.arrayContaining([
        "false",
        "true",
        "compile Error",
        "compile SyntaxError",
        "number",
        "object",
        "runtime SyntaxError",
        "runtime UnexpectedTypeError",
        "runtime UnknownFunctionError",
        "runtime UnknownPropertyError",
        "string",
        "undefined",
      ])
    );
  });

  it("returns runtime errors rather than throwing them", () => {
    const result = compileFilterExpression("missing == 1")({});
    expect(result).toBeInstanceOf(UnknownPropertyError);
    expect(result).toBeInstanceOf(ReferenceError);
    expect(result).toMatchObject({ propertyName: "missing" });
  });

  it("throws syntax errors at compile time", () => {
    expect(() => compileFilterExpression("a and")).toThrow(/^Parse error/);
  });
});

describe("compileFilterExpression never evaluates code", () => {
  it("runs the whole corpus with Function and eval disabled", () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const run = (compile: Compile) =>
      kCorpus.map((expression) =>
        outcome(compile, expression, sampleLikeOptions())
      );
    const expected = run(ours);

    // A function declaration, so the stub also intercepts `new Function`.
    function blocked(): never {
      throw new EvalError("code evaluation is disabled");
    }
    const functionSpy = vi
      .spyOn(globalThis, "Function")
      .mockImplementation(blocked);
    const evalSpy = vi.spyOn(globalThis, "eval").mockImplementation(blocked);
    try {
      // The stubs are effective: filtrex cannot compile under them.
      expect(() => compileExpression("1 == 1")).toThrow(EvalError);
      functionSpy.mockClear();

      expect(run(ours)).toEqual(expected);
      expect(functionSpy).not.toHaveBeenCalled();
      expect(evalSpy).not.toHaveBeenCalled();
    } finally {
      vi.restoreAllMocks();
    }
  });
});
