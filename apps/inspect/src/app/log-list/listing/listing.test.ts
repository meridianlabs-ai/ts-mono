import { describe, expect, it } from "vitest";

import { Column, ConditionBuilder } from "@tsmono/inspect-common/query";
import type { Condition } from "@tsmono/inspect-common/query";

import { applyListingQuery } from "./applyListingQuery";
import { evaluateCondition } from "./evaluator";
import type { ValueComparator } from "./types";

interface Row {
  name: string;
  score?: number;
  model: string;
  [k: string]: unknown;
}

const r0: Row = { name: "a", score: 0.9, model: "gpt-4" };
const r1: Row = { name: "b", score: 0.1, model: "claude" };
const r2: Row = { name: "c", model: "gpt-4" }; // missing score
const r3: Row = { name: "d", score: 0.5, model: "gpt-4o" };
const rows: Row[] = [r0, r1, r2, r3];

const getValue = (row: Row, id: string): unknown => row[id];

// Numeric comparator pinning missing values last regardless of direction
// (the AG `comparators.number` contract).
const numeric: ValueComparator = (a, b, desc) => {
  const am = a === null || a === undefined;
  const bm = b === null || b === undefined;
  if (am && bm) return 0;
  if (am) return desc ? -1 : 1;
  if (bm) return desc ? 1 : -1;
  return (a as number) - (b as number);
};
const getComparator = (id: string): ValueComparator | undefined =>
  id === "score" ? numeric : undefined;

describe("evaluateCondition", () => {
  const ev = (c: Condition, row: Row) => evaluateCondition(row, c, getValue);

  it("eq / ne", () => {
    expect(ev(new Column("model").eq("gpt-4"), r0)).toBe(true);
    expect(ev(new Column("model").eq("gpt-4"), r1)).toBe(false);
    expect(ev(new Column("model").ne("gpt-4"), r1)).toBe(true);
  });

  it("comparison operators", () => {
    expect(ev(new Column("score").gt(0.5), r0)).toBe(true);
    expect(ev(new Column("score").lte(0.5), r3)).toBe(true);
  });

  it("IN", () => {
    expect(ev(new Column("model").in(["claude", "gpt-4o"]), r3)).toBe(true);
    expect(ev(new Column("model").in(["claude"]), r0)).toBe(false);
  });

  it("LIKE / ILIKE", () => {
    expect(ev(new Column("model").like("gpt%"), r0)).toBe(true);
    expect(ev(new Column("model").ilike("GPT%"), r0)).toBe(true);
    expect(ev(new Column("model").like("gpt%"), r1)).toBe(false);
  });

  it("IS NULL / IS NOT NULL", () => {
    expect(ev(new Column("score").isNull(), r2)).toBe(true);
    expect(ev(new Column("score").isNull(), r0)).toBe(false);
    expect(ev(new Column("score").isNotNull(), r0)).toBe(true);
  });

  it("BETWEEN", () => {
    expect(ev(new Column("score").between(0.4, 0.95), r0)).toBe(true);
    expect(ev(new Column("score").between(0.4, 0.95), r1)).toBe(false);
  });

  it("AND / OR / NOT", () => {
    const and = new Column("model")
      .eq("gpt-4")
      .and(new Column("score").gt(0.5));
    expect(ev(and, r0)).toBe(true); // gpt-4 & 0.9
    expect(ev(and, r2)).toBe(false); // gpt-4 but missing score

    const or = new Column("model").eq("claude").or(new Column("score").gt(0.8));
    expect(ev(or, r0)).toBe(true); // score 0.9 > 0.8
    expect(ev(or, r3)).toBe(false); // gpt-4o, score 0.5

    const not = new Column("model").eq("gpt-4").not();
    expect(ev(not, r1)).toBe(true);
  });
});

describe("applyListingQuery", () => {
  it("sorts ascending with missing last", () => {
    const res = applyListingQuery(rows, {
      orderBy: { column: "score", direction: "ASC" },
      getValue,
      getComparator,
    });
    expect(res.items.map((r) => r.name)).toEqual(["b", "d", "a", "c"]);
    expect(res.total_count).toBe(4);
  });

  it("sorts descending with missing still last", () => {
    const res = applyListingQuery(rows, {
      orderBy: { column: "score", direction: "DESC" },
      getValue,
      getComparator,
    });
    expect(res.items.map((r) => r.name)).toEqual(["a", "d", "b", "c"]);
  });

  it("filters then reports total_count", () => {
    const res = applyListingQuery(rows, {
      filter: new Column("model").eq("gpt-4"),
      getValue,
      getComparator,
    });
    expect(res.items.map((r) => r.name).sort()).toEqual(["a", "c"]);
    expect(res.total_count).toBe(2);
  });

  it("paginates with a forward cursor", () => {
    const first = applyListingQuery(rows, {
      orderBy: { column: "name", direction: "ASC" },
      pagination: { limit: 2, cursor: null, direction: "forward" },
      getValue,
      getComparator,
    });
    expect(first.items.map((r) => r.name)).toEqual(["a", "b"]);
    expect(first.next_cursor).toEqual({ offset: 2 });

    const second = applyListingQuery(rows, {
      orderBy: { column: "name", direction: "ASC" },
      pagination: { limit: 2, cursor: first.next_cursor, direction: "forward" },
      getValue,
      getComparator,
    });
    expect(second.items.map((r) => r.name)).toEqual(["c", "d"]);
    expect(second.next_cursor).toBeNull();
  });

  it("builds conditions via ConditionBuilder too", () => {
    const filter = ConditionBuilder.simple("name", "=", "a");
    const res = applyListingQuery(rows, { filter, getValue, getComparator });
    expect(res.items).toHaveLength(1);
  });
});
