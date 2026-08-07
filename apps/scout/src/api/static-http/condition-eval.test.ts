import { describe, expect, it } from "vitest";

import { transcriptColumns as tc } from "../../query";
import type { Pagination } from "../../types/api-types";

import {
  applyOrderBy,
  applyPagination,
  evaluateCondition,
  resolveCell,
} from "./condition-eval";

const row = (overrides: Record<string, unknown>): Record<string, unknown> => ({
  transcript_id: "t1",
  model: "gpt-4",
  score: 0.5,
  error: null,
  metadata: {},
  ...overrides,
});

describe("evaluateCondition", () => {
  it("handles comparison operators", () => {
    expect(evaluateCondition(row({}), tc.model.eq("gpt-4"))).toBe(true);
    expect(evaluateCondition(row({}), tc.model.ne("gpt-4"))).toBe(false);
    expect(evaluateCondition(row({}), tc.score.gt(0.4))).toBe(true);
    expect(evaluateCondition(row({}), tc.score.gt(0.5))).toBe(false);
    expect(evaluateCondition(row({}), tc.score.gte(0.5))).toBe(true);
    expect(evaluateCondition(row({}), tc.score.lt(0.5))).toBe(false);
    expect(evaluateCondition(row({}), tc.score.lte(0.5))).toBe(true);
  });

  it("handles IN / NOT IN", () => {
    expect(evaluateCondition(row({}), tc.model.in(["gpt-4", "claude-3"]))).toBe(
      true
    );
    expect(evaluateCondition(row({}), tc.model.in(["claude-3"]))).toBe(false);
    expect(evaluateCondition(row({}), tc.model.notIn(["claude-3"]))).toBe(true);
  });

  it("handles LIKE / ILIKE wildcards", () => {
    expect(evaluateCondition(row({}), tc.model.like("gpt%"))).toBe(true);
    expect(evaluateCondition(row({}), tc.model.like("GPT%"))).toBe(false);
    expect(evaluateCondition(row({}), tc.model.ilike("GPT%"))).toBe(true);
    expect(evaluateCondition(row({}), tc.model.like("gpt-_"))).toBe(true);
    expect(evaluateCondition(row({}), tc.model.like("gpt-__"))).toBe(false);
    // regex metacharacters in the pattern are literals
    expect(evaluateCondition(row({ model: "a.b" }), tc.model.like("a.b"))).toBe(
      true
    );
    expect(evaluateCondition(row({ model: "axb" }), tc.model.like("a.b"))).toBe(
      false
    );
    // * and ? are SQL-literal too, not regex quantifiers
    expect(evaluateCondition(row({ model: "a*b" }), tc.model.like("a*b"))).toBe(
      true
    );
    expect(evaluateCondition(row({ model: "aab" }), tc.model.like("a*b"))).toBe(
      false
    );
    expect(evaluateCondition(row({ model: "b" }), tc.model.like("a*b"))).toBe(
      false
    );
    expect(evaluateCondition(row({ model: "a?" }), tc.model.like("a?"))).toBe(
      true
    );
    expect(evaluateCondition(row({ model: "a" }), tc.model.like("a?"))).toBe(
      false
    );
  });

  it("handles NULL checks", () => {
    expect(evaluateCondition(row({}), tc.error.isNull())).toBe(true);
    expect(evaluateCondition(row({}), tc.error.isNotNull())).toBe(false);
    // missing columns are null-like
    expect(evaluateCondition(row({}), tc.field("absent").isNull())).toBe(true);
  });

  it("handles BETWEEN", () => {
    expect(evaluateCondition(row({}), tc.score.between(0.1, 0.9))).toBe(true);
    expect(evaluateCondition(row({}), tc.score.between(0.6, 0.9))).toBe(false);
    expect(evaluateCondition(row({}), tc.score.notBetween(0.6, 0.9))).toBe(
      true
    );
  });

  it("handles AND / OR / NOT compounds", () => {
    const and = tc.model.eq("gpt-4").and(tc.score.gt(0.4));
    const or = tc.model.eq("nope").or(tc.score.gt(0.4));
    const not = tc.model.eq("gpt-4").not();
    expect(evaluateCondition(row({}), and)).toBe(true);
    expect(evaluateCondition(row({}), or)).toBe(true);
    expect(evaluateCondition(row({}), not)).toBe(false);
  });

  it("excludes NULL cells from comparisons and negations (SQL semantics)", () => {
    const r = row({ score: null });
    // a NULL operand makes the predicate unknown → row excluded
    expect(evaluateCondition(r, tc.score.eq(0.5))).toBe(false);
    expect(evaluateCondition(r, tc.score.ne(0.5))).toBe(false);
    expect(evaluateCondition(r, tc.score.lt(0.5))).toBe(false);
    expect(evaluateCondition(r, tc.score.lte(0.5))).toBe(false);
    expect(evaluateCondition(r, tc.score.gt(0.5))).toBe(false);
    expect(evaluateCondition(r, tc.score.gte(0.5))).toBe(false);
    expect(evaluateCondition(r, tc.score.in([0.5]))).toBe(false);
    expect(evaluateCondition(r, tc.score.notIn([0.5]))).toBe(false);
    expect(evaluateCondition(r, tc.score.between(0, 1))).toBe(false);
    expect(evaluateCondition(r, tc.score.notBetween(0, 1))).toBe(false);
    expect(evaluateCondition(row({ model: null }), tc.model.like("g%"))).toBe(
      false
    );
    expect(
      evaluateCondition(row({ model: null }), tc.model.notLike("g%"))
    ).toBe(false);
  });

  it("propagates unknown through NOT/AND/OR (Kleene logic)", () => {
    const r = row({ score: null });
    // NOT(unknown) is unknown → excluded, matching SQL
    expect(evaluateCondition(r, tc.score.lt(0.5).not())).toBe(false);
    // unknown AND true → unknown; unknown OR true → true
    expect(
      evaluateCondition(r, tc.score.lt(0.5).and(tc.model.eq("gpt-4")))
    ).toBe(false);
    expect(
      evaluateCondition(r, tc.score.lt(0.5).or(tc.model.eq("gpt-4")))
    ).toBe(true);
    // false stays dominant over unknown for AND's negation
    expect(
      evaluateCondition(r, tc.score.lt(0.5).and(tc.model.eq("nope")).not())
    ).toBe(true);
  });

  it("treats NULLs inside IN lists as SQL does", () => {
    // match found → true regardless of NULLs in the list
    expect(evaluateCondition(row({}), tc.model.in(["gpt-4", null]))).toBe(true);
    // no match but list has NULL → unknown, so IN and NOT IN both exclude
    expect(evaluateCondition(row({}), tc.model.in(["nope", null]))).toBe(false);
    expect(evaluateCondition(row({}), tc.model.notIn(["nope", null]))).toBe(
      false
    );
    // no match, no NULLs → NOT IN includes
    expect(evaluateCondition(row({}), tc.model.notIn(["nope"]))).toBe(true);
  });

  it("resolves custom columns through the metadata object", () => {
    const r = row({ metadata: { difficulty: "hard" } });
    expect(evaluateCondition(r, tc.field("difficulty").eq("hard"))).toBe(true);
    expect(
      evaluateCondition(r, tc.field("metadata.difficulty").eq("hard"))
    ).toBe(true);
  });
});

describe("resolveCell", () => {
  it("prefers direct columns over metadata fallback", () => {
    expect(resolveCell({ model: "a", metadata: { model: "b" } }, "model")).toBe(
      "a"
    );
  });

  it("traverses dotted paths", () => {
    expect(resolveCell({ a: { b: { c: 1 } } }, "a.b.c")).toBe(1);
    expect(resolveCell({ a: 2 }, "a.b.c")).toBeUndefined();
  });
});

describe("applyOrderBy", () => {
  it("sorts multi-column with direction and nulls first", () => {
    const rows = [
      { a: 2, b: "x" },
      { a: 1, b: "y" },
      { a: null, b: "z" },
      { a: 1, b: "x" },
    ];
    const sorted = applyOrderBy(rows, [
      { column: "a", direction: "ASC" },
      { column: "b", direction: "DESC" },
    ]);
    expect(sorted).toEqual([
      { a: null, b: "z" },
      { a: 1, b: "y" },
      { a: 1, b: "x" },
      { a: 2, b: "x" },
    ]);
  });
});

describe("applyPagination", () => {
  const rows = Array.from({ length: 5 }, (_, i) => ({
    transcript_id: `t${i}`,
    date: `2026-01-0${i + 1}`,
  }));
  const orderBy = { column: "date", direction: "DESC" as const };

  it("windows forward and emits a cursor only when the page is full", () => {
    const page1 = applyPagination(
      rows,
      orderBy,
      { limit: 2, direction: "forward" },
      "transcript_id"
    );
    expect(page1.items.map((r) => r.date)).toEqual([
      "2026-01-05",
      "2026-01-04",
    ]);
    expect(page1.nextCursor).toEqual({
      date: "2026-01-04",
      transcript_id: "t3",
    });

    const page2 = applyPagination(
      rows,
      orderBy,
      { limit: 2, direction: "forward", cursor: page1.nextCursor },
      "transcript_id"
    );
    expect(page2.items.map((r) => r.date)).toEqual([
      "2026-01-03",
      "2026-01-02",
    ]);

    const page3 = applyPagination(
      rows,
      orderBy,
      { limit: 2, direction: "forward", cursor: page2.nextCursor },
      "transcript_id"
    );
    expect(page3.items.map((r) => r.date)).toEqual(["2026-01-01"]);
    // partial page: no further cursor
    expect(page3.nextCursor).toBeNull();
  });

  it("returns backward pages in forward order", () => {
    const back: Pagination = {
      limit: 2,
      direction: "backward",
      cursor: { date: "2026-01-02", transcript_id: "t1" },
    };
    const page = applyPagination(rows, orderBy, back, "transcript_id");
    expect(page.items.map((r) => r.date)).toEqual(["2026-01-04", "2026-01-03"]);
  });

  it("breaks date ties by id ascending", () => {
    const tied = [
      { transcript_id: "b", date: "2026-01-01" },
      { transcript_id: "a", date: "2026-01-01" },
      { transcript_id: "c", date: "2026-01-01" },
    ];
    const page1 = applyPagination(
      tied,
      orderBy,
      { limit: 2, direction: "forward" },
      "transcript_id"
    );
    expect(page1.items.map((r) => r.transcript_id)).toEqual(["a", "b"]);
    const page2 = applyPagination(
      tied,
      orderBy,
      { limit: 2, direction: "forward", cursor: page1.nextCursor },
      "transcript_id"
    );
    expect(page2.items.map((r) => r.transcript_id)).toEqual(["c"]);
  });
});
