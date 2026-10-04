# @tsmono/filter-expression

The expression language behind the log viewer's sample filter (the filter bar on the samples tab, and the samples-grid column funnels that compile through it). In short, it's a safer [filtrex](https://github.com/cshaa/filtrex): the same language, with the same results and errors, evaluated without ever generating code.

## Why not filtrex

filtrex 3.1's `compileExpression` translates an expression into a JavaScript source string and runs it with `new Function(...)`. That has two costs:

- **It needs `'unsafe-eval'`.** Under a Content-Security-Policy without it, which the viewer's strict policy omits, every filter throws `EvalError` and filtering stops working.
- **Its safety rests on code generation.** Filter text comes from a text box, a URL or a funnel, and filtrex's sandbox depends on escaping it correctly into generated JavaScript. That's a riskier design than never creating code at all.

This package parses the expression into a tree and walks it. Nothing is compiled, so there's nothing to escape and nothing for a CSP to block.

## Usage

```ts
import { compileFilterExpression } from "@tsmono/filter-expression";

const matches = compileFilterExpression(
  'score > 0.5 and input_contains("math")',
  {
    extraFunctions: { input_contains: (pattern: string) => /* ... */ true },
    constants: { True: true, False: false, None: null },
    // Optional: resolve symbols yourself; `get` reads `name` from the data
    // and throws UnknownPropertyError if it's missing.
    customProp: (name, get) => get(name),
  }
);

const result = matches({ score: 0.8 });
// true, false, another value, or an Error: the compiled function returns
// runtime errors rather than throwing them, as filtrex's does.
```

- `compileFilterExpression` **throws** on malformed input. The message starts with `Parse error on line N:` or `Lexical error`, with jison's `----^` position marker, which the filter bar reads to place its error.
- `parseExpression` returns the syntax tree (`ExpressionNode`) for callers that want to inspect an expression rather than run it.
- Runtime errors are `UnknownPropertyError` and `UnknownFunctionError` (both `ReferenceError`s, carrying `propertyName` and `functionName`) and `UnexpectedTypeError` (a `TypeError`).

## The language

Everything filtrex 3.1 accepts, from lowest to highest precedence:

| Operators                         | Notes                                                                                   |
| --------------------------------- | --------------------------------------------------------------------------------------- |
| `if a then b else c`, `a ? b : c` | Right-associative. `?:` is deprecated and logs a warning.                               |
| `or`                              |                                                                                         |
| `and`                             |                                                                                         |
| `in`, `not in`                    | Subset test: `x in (1, 2, 3)`, `(1, 2) in list`                                         |
| `==` `!=` `<` `<=` `>` `>=` `~=`  | Chainable, so `a < b <= c` means `a < b and b <= c`. `~=` matches a regular expression. |
| `+` `-`                           |                                                                                         |
| `*` `/` `mod` `%`                 | `%` is deprecated and logs a warning.                                                   |
| `not`, unary `-`                  |                                                                                         |
| `^`                               | Right-associative.                                                                      |
| `a of b`                          | Reads property `a` of `b`.                                                              |

- **Values:** numbers (`42`, `1.5`), strings in double quotes (`"text"`), and tuples (`(1, 2, 3)`).
- **Symbols:** `name` reads that property from the data. A dot is part of the name, so `a.b` looks up the key `"a.b"`, not a nested path; use `customProp` to interpret dots (the viewer does this for `metadata.*`). `'quoted name'` reads a property whose name isn't a bare identifier. Constants apply only to unquoted symbols.
- **Built-in functions:** `abs`, `ceil`, `floor`, `log`, `log2`, `log10`, `max`, `min`, `round`, `sqrt`, `exists`, `empty`, plus anything passed in `extraFunctions`.

## Compatibility with filtrex

Results, error classes, error messages and `propertyName` match filtrex exactly, and the tests enforce it. The only differences don't show in the filter bar:

1. **The end of a parse-error message:** filtrex lists the tokens its parse table expected; this ends with `Unexpected '<token>'`. The prefix and position marker are identical.
2. **Very deep nesting:** filtrex overflows the stack at about 1,000 levels. This copes with about 3,000, and beyond that fails the same way.
3. **`01.5`:** filtrex fails because its generated JavaScript is invalid, with a browser-dependent message. This always reports Chrome's "Unexpected number".

filtrex's quirks are kept on purpose, so existing filters don't change meaning:

- Numbers with a leading zero are octal (`010` is 8).
- `x - y` is `-x` when `y` is undefined.
- Type errors report null, arrays and objects all as "undefined".
- The syntax-error marker stops at column 23.
- `not(a)` and `x in(1, 2)` are syntax errors, because the keyword swallows the bracket.

## Tests

filtrex is a devDependency of this package only. It's the reference implementation the tests compare against, and it never ships.

- **`expressionTestCorpus.ts`:** 403 hand-picked expressions, covering every grammar production, the edge cases above and malformed input, plus 5,000 seeded generated ones (random expression trees and random token sequences).
- **`expressionParser.test.ts`:** prints each parse tree as the JavaScript filtrex would generate and compares it with filtrex's actual output, so precedence and associativity are checked exactly.
- **`expressionEvaluator.test.ts`:** runs the corpus through both engines, with and without filter-bar-style options, and requires identical results, error classes and `propertyName`. It also stubs `Function` and `eval` to throw and checks the evaluator never calls them.
- **`expressionEvaluator.warnings.test.ts`:** the deprecation warnings.

The filter bar's own behaviour (result, warning range, syntax-error position, messages) is tested in the app, in `apps/inspect/src/app/samples/sample-tools/filters.test.ts`.

**If you change behaviour:** differing from filtrex is a user-visible change to people's saved filters. Add the case to the corpus. If the difference is deliberate, record it under Compatibility above.

## Not here yet

The column funnels still round-trip filter text through the app's own partial parser (`apps/inspect/src/app/samples/sample-tools/filterAst.ts`), which is built on the editor's highlighting tokenizer and disagrees with filtrex in places. For example, it reads `not target ~= "^pre"` as `not (target ~= "^pre")`. Moving the funnels onto `parseExpression` is a natural follow-up.
