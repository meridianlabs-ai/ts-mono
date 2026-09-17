// Scanner names are not paths: dots and slashes match like any other character.
// Support *, ?, bracket classes/ranges, and backslash escapes; all other
// punctuation is literal. Matching never delegates a log-authored regex.
const kMaxNameLength = 4096;
const kMaxPatternLength = 4096;
const kMaxMatchingWork = 4_000_000;

export const kMaxScannerPatterns = 1024;

export class ScannerGlobBudget {
  private remaining = kMaxMatchingWork;

  spend(work: number): void {
    this.remaining -= work;
    if (this.remaining < 0) {
      throw new Error(
        "Scanner result view exceeds the glob matching work limit."
      );
    }
  }
}

type Token =
  | { kind: "star" | "any" }
  | { kind: "literal"; value: string }
  | { kind: "class"; negate: boolean; ranges: Array<[number, number]> };

function tokenize(pattern: string, budget: ScannerGlobBudget): Token[] {
  const tokens: Token[] = [];
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i]!;
    if (ch === "*") {
      if (tokens.at(-1)?.kind !== "star") tokens.push({ kind: "star" });
    } else if (ch === "?") {
      tokens.push({ kind: "any" });
    } else if (ch === "\\" && i + 1 < pattern.length) {
      tokens.push({ kind: "literal", value: pattern[++i]! });
    } else if (ch === "[") {
      let end = i + 1;
      const negate = pattern[end] === "!" || pattern[end] === "^";
      if (negate) end++;
      const chars: Array<{ code: number; escaped: boolean }> = [];
      // A closing bracket in the first position is a member of the class.
      while (
        end < pattern.length &&
        (pattern[end] !== "]" || chars.length === 0)
      ) {
        budget.spend(1);
        const escaped = pattern[end] === "\\" && end + 1 < pattern.length;
        if (escaped) end++;
        chars.push({ code: pattern.charCodeAt(end++), escaped });
      }
      if (end === pattern.length) {
        tokens.push({ kind: "literal", value: ch });
        continue;
      }
      const ranges: Array<[number, number]> = [];
      for (let j = 0; j < chars.length; j++) {
        const start = chars[j]!.code;
        const dash = chars[j + 1];
        const last = chars[j + 2];
        if (dash?.code === 45 && !dash.escaped && last) {
          ranges.push([start, last.code]);
          j += 2;
        } else {
          ranges.push([start, start]);
        }
      }
      tokens.push({ kind: "class", negate, ranges });
      i = end;
    } else {
      tokens.push({ kind: "literal", value: ch });
    }
  }
  return tokens;
}

function matchesCharacter(
  token: Token,
  value: string,
  budget: ScannerGlobBudget
): boolean {
  switch (token.kind) {
    case "any":
      return true;
    case "literal":
      return token.value === value;
    case "class": {
      budget.spend(token.ranges.length);
      const code = value.charCodeAt(0);
      const member = token.ranges.some(
        ([start, end]) => code >= start && code <= end
      );
      return token.negate ? !member : member;
    }
    case "star":
      return false;
  }
}

export function scannerGlobMatches(
  pattern: string,
  value: string,
  budget: ScannerGlobBudget
): boolean {
  if (pattern.length > kMaxPatternLength || value.length > kMaxNameLength) {
    throw new Error(
      "Scanner result view glob patterns and scanner names must be at most 4096 characters."
    );
  }
  budget.spend(pattern.length + value.length);
  const tokens = tokenize(pattern, budget);
  let tokenIndex = 0;
  let valueIndex = 0;
  let starIndex = -1;
  let starEnd = 0;
  while (valueIndex < value.length) {
    budget.spend(1);
    const token = tokens[tokenIndex];
    if (token?.kind === "star") {
      starIndex = tokenIndex++;
      starEnd = valueIndex;
    } else if (token && matchesCharacter(token, value[valueIndex]!, budget)) {
      tokenIndex++;
      valueIndex++;
    } else if (starIndex >= 0) {
      // Only the latest star can need expansion; earlier matches stay fixed.
      tokenIndex = starIndex + 1;
      valueIndex = ++starEnd;
    } else {
      return false;
    }
  }
  while (tokens[tokenIndex]?.kind === "star") tokenIndex++;
  return tokenIndex === tokens.length;
}
