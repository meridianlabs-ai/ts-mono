// Preserve the existing path/dot wildcard rules without log-authored regexes.
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
  | { kind: "star" | "globstar" | "any" }
  | { kind: "literal"; value: string }
  | { kind: "class"; negate: boolean; ranges: Array<[number, number]> };

function tokenize(pattern: string, budget: ScannerGlobBudget): Token[] {
  const tokens: Token[] = [];
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i]!;
    if (ch === "*") {
      const start = i;
      while (pattern[i + 1] === "*") i++;
      const wholeSegment =
        (start === 0 || pattern[start - 1] === "/") &&
        (i + 1 === pattern.length || pattern[i + 1] === "/");
      tokens.push({
        kind: wholeSegment && i - start === 1 ? "globstar" : "star",
      });
    } else if (ch === "?") {
      tokens.push({ kind: "any" });
    } else if (ch === "\\" && i + 1 < pattern.length) {
      tokens.push({ kind: "literal", value: pattern[++i]! });
    } else if (ch === "[") {
      let end = i + 1;
      const negate = pattern[end] === "^";
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
    case "globstar":
      return false;
  }
}

function matchesSegment(
  tokens: Token[],
  value: string,
  budget: ScannerGlobBudget
): boolean {
  const first = tokens[0];
  if (
    (first?.kind === "star" || first?.kind === "any") &&
    (value.length === 0 || value.startsWith("."))
  ) {
    return false;
  }
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

function matchesSegments(
  segments: Token[][],
  values: string[],
  budget: ScannerGlobBudget
): boolean {
  // Keep all reachable segment positions so multiple ** cannot cause backtracking.
  let reachable = new Set([0]);
  for (let segmentIndex = 0; segmentIndex < segments.length; segmentIndex++) {
    const segment = segments[segmentIndex]!;
    const next = new Set<number>();
    if (segment.length === 1 && segment[0]?.kind === "globstar") {
      // Picomatch requires the slash in */**, but allows a/** to match a.
      const requiresSlash =
        segmentIndex === segments.length - 1 &&
        segments[segmentIndex - 1]?.at(-1)?.kind === "star";
      for (let index = 0; index <= values.length; index++) {
        budget.spend(1);
        if (reachable.has(index) && (!requiresSlash || index < values.length)) {
          next.add(index);
        }
        const value = values[index];
        if (next.has(index) && value !== undefined && !value.startsWith(".")) {
          next.add(index + 1);
        }
      }
    } else {
      for (const index of reachable) {
        budget.spend(1);
        const value = values[index];
        if (value !== undefined && matchesSegment(segment, value, budget)) {
          next.add(index + 1);
        }
      }
    }
    if (next.size === 0) return false;
    reachable = next;
  }
  return reachable.has(values.length);
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
  if (pattern.length === 0) {
    throw new Error("Scanner result view glob patterns must not be empty.");
  }
  budget.spend(pattern.length + value.length);
  if (value.length === 0) return false;
  if (pattern === value) return true;
  if (pattern.startsWith("./")) pattern = pattern.slice(2);
  const tokens = tokenize(pattern, budget);
  const segments: Token[][] = [[]];
  for (const token of tokens) {
    if (token.kind === "literal" && token.value === "/") segments.push([]);
    else segments[segments.length - 1]!.push(token);
  }
  const values = value.split("/");
  if (matchesSegments(segments, values, budget)) return true;
  const last = tokens.at(-1);
  // Preserve the optional trailing slash used by path patterns and bracket classes.
  const optionalSlash =
    last?.kind === "class" ||
    (last?.kind === "star" &&
      (pattern.includes("/") || pattern.startsWith("*") || pattern === ".*"));
  return (
    optionalSlash &&
    value.endsWith("/") &&
    matchesSegments(segments, values.slice(0, -1), budget)
  );
}
