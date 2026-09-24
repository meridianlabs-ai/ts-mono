/**
 * Parser for the sample filter expression language: the grammar of
 * filtrex 3.1 (`generateParser.mjs`), reimplemented so expressions can be
 * evaluated by walking the tree instead of compiling generated JavaScript.
 *
 * The lexer reproduces filtrex's jison lexer rule for rule (first matching
 * rule wins, keywords swallow the non-word character after them), and the
 * precedence-climbing parser reproduces the yacc precedence table. Syntax
 * errors carry jison's message prefix and position marker because the
 * filter bar derives the error position from them.
 */

export type SymbolType = "unescaped" | "single-quoted";

export interface SymbolRef {
  name: string;
  type: SymbolType;
}

export type RelationalOperator = "==" | "!=" | "~=" | "<" | "<=" | ">=" | ">";

/** `%` is filtrex's deprecated spelling of `mod`. */
export type ArithmeticOperator = "+" | "-" | "*" | "/" | "^" | "mod" | "%";

export type ExpressionNode =
  | { kind: "number"; text: string; value: number }
  | { kind: "string"; value: string }
  /** `name` reads from the data object; `name of object` from `object`. */
  | { kind: "property"; symbol: SymbolRef; object: ExpressionNode | null }
  | { kind: "call"; symbol: SymbolRef; args: ExpressionNode[] }
  | { kind: "group"; inner: ExpressionNode }
  | { kind: "tuple"; items: ExpressionNode[] }
  | { kind: "negate"; arg: ExpressionNode }
  | { kind: "not"; arg: ExpressionNode }
  | {
      kind: "arithmetic";
      op: ArithmeticOperator;
      left: ExpressionNode;
      right: ExpressionNode;
    }
  | {
      kind: "logical";
      op: "and" | "or";
      left: ExpressionNode;
      right: ExpressionNode;
    }
  | {
      kind: "in";
      negated: boolean;
      left: ExpressionNode;
      right: ExpressionNode;
    }
  /** `a < b <= c` is one relation: `a < b and b <= c`, each operand once. */
  | {
      kind: "relation";
      first: ExpressionNode;
      rest: Array<{ op: RelationalOperator; operand: ExpressionNode }>;
    }
  /** `if test then a else b`, or the deprecated `test ? a : b`. */
  | {
      kind: "conditional";
      test: ExpressionNode;
      consequent: ExpressionNode;
      alternate: ExpressionNode;
      deprecatedTernary: boolean;
    };

type TokenType =
  | "*"
  | "/"
  | "-"
  | "+"
  | "^"
  | "("
  | ")"
  | ","
  | RelationalOperator
  | "notIn"
  | "and"
  | "or"
  | "not"
  | "in"
  | "of"
  | "if"
  | "then"
  | "else"
  | "mod"
  | "Number"
  | "Symbol"
  | "String"
  | "%"
  | "?"
  | ":"
  | "EndOfExpression";

interface TokenPosition {
  /** The text the lexer rule consumed (keywords include the next char). */
  text: string;
  start: number;
  /** Line count after consuming this token, as jison's `yylineno`. */
  lineAfter: number;
}

type Token = TokenPosition &
  (
    | { type: "Symbol"; symbol: SymbolRef }
    | { type: "String"; value: string }
    | { type: Exclude<TokenType, "Symbol" | "String"> }
  );

type LexRule = [RegExp, TokenType | "whitespace" | "QuotedSymbol"];

// Order matters: jison takes the first rule that matches, not the longest.
const kLexRules: readonly LexRule[] = [
  [/\*/y, "*"],
  [/\//y, "/"],
  [/-/y, "-"],
  [/\+/y, "+"],
  [/\^/y, "^"],
  [/\(/y, "("],
  [/\)/y, ")"],
  [/,/y, ","],
  [/==/y, "=="],
  [/!=/y, "!="],
  [/~=/y, "~="],
  [/>=/y, ">="],
  [/<=/y, "<="],
  [/</y, "<"],
  [/>/y, ">"],
  [/not\s+in[^\w]/y, "notIn"],
  [/and[^\w]/y, "and"],
  [/or[^\w]/y, "or"],
  [/not[^\w]/y, "not"],
  [/in[^\w]/y, "in"],
  [/of[^\w]/y, "of"],
  [/if[^\w]/y, "if"],
  [/then[^\w]/y, "then"],
  [/else[^\w]/y, "else"],
  [/mod[^\w]/y, "mod"],
  [/\s+/y, "whitespace"],
  [/[0-9]+(?:\.[0-9]+)?(?![0-9.])/y, "Number"],
  [/[a-zA-Z$_][.a-zA-Z0-9$_]*/y, "Symbol"],
  [/'(?:\\'|\\\\|[^'\\])*'/y, "QuotedSymbol"],
  [/"(?:\\"|\\\\|[^"\\])*"/y, "String"],
  [/%/y, "%"],
  [/\?/y, "?"],
  [/:/y, ":"],
];

const kLineBreak = /\r\n?|\n/g;

const countLineBreaks = (text: string): number =>
  text.match(kLineBreak)?.length ?? 0;

/** Strip the quotes and undo the only two escapes the lexer admits. */
const unquote = (literal: string): string => {
  let built = "";
  for (let i = 1; i < literal.length - 1; i++) {
    if (literal[i] === "\\") i++;
    built += literal[i];
  }
  return built;
};

/**
 * jison's `showPosition`: up to 20 characters either side and a dashed
 * marker under the offending token. Past 20 characters of prefix the
 * marker stops advancing; the filter bar inherits that.
 */
const showPosition = (
  input: string,
  tokenStart: number,
  tokenText: string
): string => {
  const past = input.slice(0, tokenStart);
  const pre =
    (past.length > 20 ? "..." : "") + past.slice(-20).replace(/\n/g, "");
  let next = tokenText;
  if (next.length < 20) {
    next += input
      .slice(tokenStart + tokenText.length)
      .slice(0, 20 - next.length);
  }
  const upcoming = (
    next.slice(0, 20) + (next.length > 20 ? "..." : "")
  ).replace(/\n/g, "");
  return `${pre}${upcoming}\n${"-".repeat(pre.length)}^`;
};

class Lexer {
  private pos = 0;
  private lineno = 0;

  constructor(private readonly input: string) {}

  next(): Token {
    for (;;) {
      const start = this.pos;
      if (start === this.input.length) {
        return {
          type: "EndOfExpression",
          text: "",
          start,
          lineAfter: this.lineno,
        };
      }
      const token = this.match(start);
      if (token) return token;
    }
  }

  /** Returns undefined after skipping whitespace. */
  private match(start: number): Token | undefined {
    for (const [pattern, kind] of kLexRules) {
      pattern.lastIndex = start;
      const found = pattern.exec(this.input);
      if (!found) continue;
      const text = found[0];
      this.pos = start + text.length;
      this.lineno += countLineBreaks(text);
      const position = { text, start, lineAfter: this.lineno };
      switch (kind) {
        case "whitespace":
          return undefined;
        case "Symbol":
          return {
            ...position,
            type: "Symbol",
            symbol: { name: text, type: "unescaped" },
          };
        case "QuotedSymbol":
          return {
            ...position,
            type: "Symbol",
            symbol: { name: unquote(text), type: "single-quoted" },
          };
        case "String":
          return { ...position, type: "String", value: unquote(text) };
        default:
          return { ...position, type: kind };
      }
    }
    throw new Error(
      `Lexical error on line ${this.lineno + 1}. Unrecognized text.\n` +
        showPosition(this.input, start, "")
    );
  }
}

const kRelationalOperators: readonly RelationalOperator[] = [
  "==",
  "!=",
  "~=",
  "<",
  "<=",
  ">=",
  ">",
];

const asRelationalOperator = (
  type: TokenType
): RelationalOperator | undefined =>
  kRelationalOperators.find((op) => op === type);

// Binding powers from filtrex's precedence table (lowest first). `not` and
// unary minus share level 10; `of` (12) is handled with its Symbol.
const kConditionalLevel = 1;
const kRelationLevel = 6;
const kUnaryLevel = 10;
const kOfLevel = 12;

const infixLevel = (type: TokenType): number | undefined => {
  switch (type) {
    case "?":
      return kConditionalLevel;
    case "or":
      return 2;
    case "and":
      return 3;
    case "in":
    case "notIn":
      return 4;
    case "+":
    case "-":
      return 8;
    case "*":
    case "/":
    case "mod":
    case "%":
      return 9;
    case "^":
      return 11;
    default:
      return asRelationalOperator(type) ? kRelationLevel : undefined;
  }
};

class Parser {
  private lookahead: Token | undefined;
  private lastConsumed: Token | undefined;
  private invalidNumber = false;

  constructor(
    private readonly input: string,
    private readonly lexer: Lexer
  ) {}

  parse(): ExpressionNode {
    const expression = this.parseExpression(0);
    this.expect("EndOfExpression");
    if (this.invalidNumber) {
      // filtrex pastes number text into generated sloppy-mode JavaScript,
      // where `01.5` is a legacy octal followed by `.5`. V8 reports this.
      throw new SyntaxError("Unexpected number");
    }
    return expression;
  }

  private peek(): Token {
    this.lookahead ??= this.lexer.next();
    return this.lookahead;
  }

  private consume(): Token {
    const token = this.peek();
    this.lookahead = undefined;
    this.lastConsumed = token;
    return token;
  }

  private expect(type: TokenType): Token {
    if (this.peek().type !== type) throw this.error();
    return this.consume();
  }

  private error(): Error {
    const token = this.peek();
    const line = (this.lastConsumed?.lineAfter ?? 0) + 1;
    return new Error(
      `Parse error on line ${line}:\n` +
        showPosition(this.input, token.start, token.text) +
        `\nUnexpected '${token.type}'`
    );
  }

  private parseExpression(minLevel: number): ExpressionNode {
    let left = this.parsePrefix();
    for (;;) {
      const type = this.peek().type;
      const level = infixLevel(type);
      if (level === undefined || level <= minLevel) return left;
      this.consume();
      left = this.parseInfix(type, level, left);
    }
  }

  private parseInfix(
    type: TokenType,
    level: number,
    left: ExpressionNode
  ): ExpressionNode {
    switch (type) {
      case "?": {
        const consequent = this.parseExpression(0);
        this.expect(":");
        // Right-associative: `a ? b : c ? d : e` nests in the alternate.
        const alternate = this.parseExpression(level - 1);
        return {
          kind: "conditional",
          test: left,
          consequent,
          alternate,
          deprecatedTernary: true,
        };
      }
      case "and":
      case "or":
        return {
          kind: "logical",
          op: type,
          left,
          right: this.parseExpression(level),
        };
      case "in":
      case "notIn":
        return {
          kind: "in",
          negated: type === "notIn",
          left,
          right: this.parseExpression(level),
        };
      case "^":
        return {
          kind: "arithmetic",
          op: "^",
          left,
          right: this.parseExpression(level - 1),
        };
      case "+":
      case "-":
      case "*":
      case "/":
      case "mod":
      case "%":
        return {
          kind: "arithmetic",
          op: type,
          left,
          right: this.parseExpression(level),
        };
      default: {
        const op = asRelationalOperator(type);
        if (!op) throw new Error(`Not an infix operator: ${type}`);
        const rest = [{ op, operand: this.parseExpression(kRelationLevel) }];
        for (;;) {
          const chained = asRelationalOperator(this.peek().type);
          if (!chained) break;
          this.consume();
          rest.push({
            op: chained,
            operand: this.parseExpression(kRelationLevel),
          });
        }
        return { kind: "relation", first: left, rest };
      }
    }
  }

  private parsePrefix(): ExpressionNode {
    const token = this.peek();
    switch (token.type) {
      case "-":
        this.consume();
        return { kind: "negate", arg: this.parseExpression(kUnaryLevel) };
      case "not":
        this.consume();
        return { kind: "not", arg: this.parseExpression(kUnaryLevel) };
      case "if": {
        this.consume();
        const test = this.parseExpression(0);
        this.expect("then");
        const consequent = this.parseExpression(0);
        this.expect("else");
        const alternate = this.parseExpression(kConditionalLevel - 1);
        return {
          kind: "conditional",
          test,
          consequent,
          alternate,
          deprecatedTernary: false,
        };
      }
      case "(": {
        this.consume();
        const first = this.parseExpression(0);
        if (this.peek().type !== ",") {
          this.expect(")");
          return { kind: "group", inner: first };
        }
        const items = [first];
        while (this.peek().type === ",") {
          this.consume();
          items.push(this.parseExpression(0));
        }
        this.expect(")");
        return { kind: "tuple", items };
      }
      case "Number":
        this.consume();
        return { kind: "number", text: token.text, value: this.number(token) };
      case "String":
        this.consume();
        return { kind: "string", value: token.value };
      case "Symbol": {
        this.consume();
        const symbol = token.symbol;
        if (this.peek().type === "(") {
          this.consume();
          const args: ExpressionNode[] = [];
          if (this.peek().type !== ")") {
            args.push(this.parseExpression(0));
            while (this.peek().type === ",") {
              this.consume();
              args.push(this.parseExpression(0));
            }
          }
          this.expect(")");
          return { kind: "call", symbol, args };
        }
        if (this.peek().type === "of") {
          this.consume();
          return {
            kind: "property",
            symbol,
            object: this.parseExpression(kOfLevel),
          };
        }
        return { kind: "property", symbol, object: null };
      }
      default:
        throw this.error();
    }
  }

  /** The value the text has as a sloppy-mode JavaScript literal. */
  private number(token: Token): number {
    if (/^0[0-7]+$/.test(token.text)) return parseInt(token.text, 8);
    if (/^0[0-7]+\./.test(token.text)) this.invalidNumber = true;
    return Number(token.text);
  }
}

/**
 * Parse a filter expression. Throws an `Error` whose message starts with
 * "Parse error" or "Lexical error" (with jison's position marker) for
 * malformed input, exactly where filtrex's `compileExpression` would.
 */
export const parseExpression = (input: string): ExpressionNode =>
  new Parser(input, new Lexer(input)).parse();
