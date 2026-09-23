import { compileExpression } from "filtrex";
import { describe, expect, it, vi } from "vitest";

import { ExpressionNode, parseExpression } from "./expressionParser";
import { kCorpus, kHandPickedExpressions } from "./expressionTestCorpus";

// filtrex compiles by pasting code fragments together; printing our tree
// with the same fragments lets us compare parse trees exactly, including
// precedence and associativity that evaluate to coincidentally equal values.
const toFiltrexJs = (node: ExpressionNode): string => {
  switch (node.kind) {
    case "number":
      return node.text;
    case "string":
      return JSON.stringify(node.value);
    case "property":
      return `prop(${JSON.stringify(node.symbol)}, ${node.object ? toFiltrexJs(node.object) : "data"})`;
    case "call": {
      const args = node.args.map((arg) => `, ${toFiltrexJs(arg)}`).join("");
      return `call(${JSON.stringify(node.symbol)}${args})`;
    }
    case "group":
      return `(${toFiltrexJs(node.inner)})`;
    case "tuple":
      return `([ ${node.items.map(toFiltrexJs).join(", ")} ])`;
    case "negate":
      return `(ops['-'](${toFiltrexJs(node.arg)}))`;
    case "not":
      return `(! std.coerceBoolean(${toFiltrexJs(node.arg)}))`;
    case "arithmetic": {
      const left = toFiltrexJs(node.left);
      const right = toFiltrexJs(node.right);
      if (node.op === "%") {
        return `std.warnDeprecated('modulo', ops['mod'](${left}, ${right}))`;
      }
      if (node.op === "mod") return `(ops.mod(${left}, ${right}))`;
      return `(ops['${node.op}'](${left}, ${right}))`;
    }
    case "logical": {
      const op = node.op === "and" ? "&&" : "||";
      return `(std.coerceBoolean(${toFiltrexJs(node.left)}) ${op} std.coerceBoolean(${toFiltrexJs(node.right)}))`;
    }
    case "in":
      return `(${node.negated ? "!" : ""}std.isSubset(${toFiltrexJs(node.left)}, ${toFiltrexJs(node.right)}))`;
    case "relation": {
      const temps = node.rest.map((_, i) => `tmp${i}`);
      let previous = toFiltrexJs(node.first);
      const comparisons = node.rest.map(({ op, operand }, i) => {
        const comparison = `ops["${op}"](${previous}, ${temps[i]} = ${toFiltrexJs(operand)})`;
        previous = temps[i] ?? "";
        return comparison;
      });
      return `(function(){ var ${temps.join(", ")}; return ${comparisons.join(" && ")};})()`;
    }
    case "conditional": {
      const body = `std.coerceBoolean(${toFiltrexJs(node.test)}) ? ${toFiltrexJs(node.consequent)} : ${toFiltrexJs(node.alternate)}`;
      return node.deprecatedTernary
        ? `std.warnDeprecated('ternary', ${body})`
        : `(${body})`;
    }
  }
};

type ParseOutcome = { code: string } | { error: string; message: string };

/** The message head the filter bar reads: prefix, context line, marker. */
const errorOutcome = (error: unknown): ParseOutcome => {
  if (!(error instanceof Error)) return { error: "thrown", message: "" };
  const syntax = /^(Parse|Lexical) error/.test(error.message);
  return {
    error: error.constructor.name,
    message: syntax
      ? error.message.split("\n").slice(0, 3).join("\n")
      : error.message,
  };
};

const filtrexOutcome = (expression: string): ParseOutcome => {
  const spy = vi.spyOn(globalThis, "Function");
  try {
    compileExpression(expression);
    const body = spy.mock.calls.at(-1)?.at(-1) ?? "";
    return { code: body };
  } catch (error) {
    return errorOutcome(error);
  } finally {
    spy.mockRestore();
  }
};

const ourOutcome = (expression: string): ParseOutcome => {
  try {
    return { code: `return ${toFiltrexJs(parseExpression(expression))};` };
  } catch (error) {
    return errorOutcome(error);
  }
};

describe("parseExpression matches filtrex's parser", () => {
  it.each(kHandPickedExpressions)("%j", (expression) => {
    expect(ourOutcome(expression)).toEqual(filtrexOutcome(expression));
  });

  it("agrees on every generated expression", () => {
    const mismatches = kCorpus.filter(
      (expression) =>
        JSON.stringify(ourOutcome(expression)) !==
        JSON.stringify(filtrexOutcome(expression))
    );
    expect(mismatches).toEqual([]);
  });

  it("parses the generated corpus into a mix of trees and errors", () => {
    const parsed = kCorpus.filter((e) => "code" in ourOutcome(e)).length;
    expect(parsed).toBeGreaterThan(kCorpus.length / 4);
    expect(parsed).toBeLessThan(kCorpus.length);
  });
});

describe("parseExpression syntax errors", () => {
  // The filter bar places its marker at the dash count before `^`.
  const markerColumn = (expression: string): number | undefined => {
    try {
      parseExpression(expression);
      return undefined;
    } catch (error) {
      if (!(error instanceof Error)) return undefined;
      return error.message.match(/^(-*)\^$/m)?.[1]?.length;
    }
  };

  it("marks the offending token", () => {
    expect(markerColumn("foo and")).toBe(4);
    expect(markerColumn("a == 1 #")).toBe(7);
    expect(markerColumn("(a and b")).toBe(8);
  });

  it("prefixes parse and lexical errors the way the filter bar expects", () => {
    expect(() => parseExpression("a and")).toThrow(/^Parse error on line 1:/);
    expect(() => parseExpression("a # b")).toThrow(
      /^Lexical error on line 1\. Unrecognized text\./
    );
  });
});
