import { describe, expect, it } from "vitest";

import { ConditionBuilder } from "../../query/conditionBuilder";
import type { ScalarValue } from "../../query/types";
import type { Pagination } from "../../types/api-types";

import { buildListingSql, conditionToSql } from "./condition-sql";

describe("conditionToSql IN / NOT IN null handling", () => {
  it("IN with only non-null values uses a single IN list", () => {
    const condition = ConditionBuilder.simple("model", "IN", ["a", "b", "c"]);
    expect(conditionToSql(condition)).toEqual({
      sql: `"model" IN (?, ?, ?)`,
      params: ["a", "b", "c"],
    });
  });

  it("IN containing null splits out an IS NULL term", () => {
    const condition = ConditionBuilder.simple("model", "IN", ["a", "b", null]);
    expect(conditionToSql(condition)).toEqual({
      sql: `("model" IN (?, ?) OR "model" IS NULL)`,
      params: ["a", "b"],
    });
  });

  it("IN with only null becomes IS NULL with no params", () => {
    const condition = ConditionBuilder.simple("model", "IN", [null]);
    expect(conditionToSql(condition)).toEqual({
      sql: `"model" IS NULL`,
      params: [],
    });
  });

  it("empty IN is always false", () => {
    const condition = ConditionBuilder.simple("model", "IN", []);
    expect(conditionToSql(condition)).toEqual({ sql: "FALSE", params: [] });
  });

  it("NOT IN with only non-null values uses a single NOT IN list", () => {
    const condition = ConditionBuilder.simple("model", "NOT IN", [
      "a",
      "b",
      "c",
    ]);
    expect(conditionToSql(condition)).toEqual({
      sql: `"model" NOT IN (?, ?, ?)`,
      params: ["a", "b", "c"],
    });
  });

  it("NOT IN containing null splits out an IS NOT NULL term", () => {
    const condition = ConditionBuilder.simple("model", "NOT IN", [
      "a",
      "b",
      null,
    ]);
    expect(conditionToSql(condition)).toEqual({
      sql: `("model" NOT IN (?, ?) AND "model" IS NOT NULL)`,
      params: ["a", "b"],
    });
  });

  it("NOT IN with only null becomes IS NOT NULL with no params", () => {
    const condition = ConditionBuilder.simple("model", "NOT IN", [null]);
    expect(conditionToSql(condition)).toEqual({
      sql: `"model" IS NOT NULL`,
      params: [],
    });
  });

  it("empty NOT IN is always true", () => {
    const condition = ConditionBuilder.simple("model", "NOT IN", []);
    expect(conditionToSql(condition)).toEqual({ sql: "TRUE", params: [] });
  });

  it("preserves non-string scalar values as params", () => {
    const values: ScalarValue[] = [1, 2, 3];
    const condition = ConditionBuilder.simple("score", "IN", values);
    expect(conditionToSql(condition)).toEqual({
      sql: `"score" IN (?, ?, ?)`,
      params: [1, 2, 3],
    });
  });
});

describe("buildListingSql cursor pagination", () => {
  const forward = (cursor: Pagination["cursor"]): Pagination => ({
    direction: "forward",
    cursor,
    limit: 10,
  });

  it("forward cursor on a single column compares with >", () => {
    const result = buildListingSql(
      undefined,
      { column: "id", direction: "ASC" },
      forward({ id: 5 }),
      "id"
    );
    expect(result.where).toEqual({ sql: `"id" > ?`, params: [5] });
  });

  it("backward cursor flips the comparison to <", () => {
    const result = buildListingSql(
      undefined,
      { column: "id", direction: "ASC" },
      { direction: "backward", cursor: { id: 5 }, limit: 10 },
      "id"
    );
    expect(result.where).toEqual({ sql: `"id" < ?`, params: [5] });
  });

  it("multi-column order builds an OR-of-AND keyset condition", () => {
    const result = buildListingSql(
      undefined,
      { column: "created", direction: "ASC" },
      forward({ created: "t", id: 5 }),
      "id"
    );
    expect(result.where).toEqual({
      sql: `("created" > ?) OR (("created" = ?) AND ("id" > ?))`,
      params: ["t", "t", 5],
    });
  });

  it("DESC order column uses < for a forward cursor", () => {
    const result = buildListingSql(
      undefined,
      { column: "id", direction: "DESC" },
      forward({ id: 5 }),
      "id"
    );
    expect(result.where).toEqual({ sql: `"id" < ?`, params: [5] });
  });

  it("combines filter and cursor with params in [filter, cursor] order", () => {
    const result = buildListingSql(
      ConditionBuilder.simple("model", "=", "gpt-4"),
      { column: "id", direction: "ASC" },
      forward({ id: 5 }),
      "id"
    );
    expect(result.countWhere).toEqual({
      sql: `"model" = ?`,
      params: ["gpt-4"],
    });
    expect(result.where).toEqual({
      sql: `("model" = ?) AND ("id" > ?)`,
      params: ["gpt-4", 5],
    });
  });

  it("filter without pagination yields where equal to countWhere", () => {
    const result = buildListingSql(
      ConditionBuilder.simple("model", "=", "gpt-4"),
      undefined,
      undefined,
      "id"
    );
    expect(result.where).toEqual({ sql: `"model" = ?`, params: ["gpt-4"] });
    expect(result.countWhere).toEqual(result.where);
  });

  it("no filter and no pagination yields null where/countWhere", () => {
    const result = buildListingSql(undefined, undefined, undefined, "id");
    expect(result.where).toBeNull();
    expect(result.countWhere).toBeNull();
  });
});
