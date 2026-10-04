import { describe, expect, it } from "vitest";

import { testConnectionLimitChange, testEvalStats } from "../testing";

import { normalizeEvalStats } from "./stats";

describe("normalizeEvalStats", () => {
  it.each([undefined, null, "stats"])(
    "leaves absent or unusable stats absent: %s",
    (raw) => {
      expect(normalizeEvalStats(raw)).toBeUndefined();
    }
  );

  it.each([undefined, null, []].map((history) => ({ history })))(
    "fills legacy stats defaults for $history history",
    ({ history }) => {
      expect(normalizeEvalStats({ connection_limit_history: history })).toEqual(
        testEvalStats()
      );
    }
  );

  it("preserves stats and connection fields without mutating the input", () => {
    const raw = {
      ...testEvalStats({
        started_at: "2025-01-15T10:00:00Z",
        completed_at: "2025-01-15T10:01:00Z",
      }),
      connection_limit_history: [
        { ...testConnectionLimitChange(), future: "kept" },
        testConnectionLimitChange({ reason: "manual" }),
        testConnectionLimitChange({ reason: "slow_start" }),
        testConnectionLimitChange({ reason: "steady_state_up" }),
      ],
      future_stats: true,
    };
    const original = structuredClone(raw);
    expect(normalizeEvalStats(raw)).toEqual(raw);
    expect(raw).toEqual(original);
  });

  it("normalizes legacy model and role usage", () => {
    const stats = normalizeEvalStats({
      model_usage: { model: { input_tokens: 3, output_tokens: 2 } },
      role_usage: { grader: { input_tokens: 1, output_tokens: 4 } },
    });
    expect(stats?.model_usage["model"]).toMatchObject({
      input_tokens: 3,
      output_tokens: 2,
    });
    expect(stats?.role_usage["grader"]).toMatchObject({
      input_tokens: 1,
      output_tokens: 4,
    });
    expect(stats?.connection_limit_history).toEqual([]);
  });

  it.each(
    [
      {},
      "history",
      [null],
      [{}],
      [testConnectionLimitChange(), { timestamp: 0 }],
      [{ ...testConnectionLimitChange(), model: null }],
      [{ ...testConnectionLimitChange(), timestamp: "123" }],
      [{ ...testConnectionLimitChange(), old_limit: "1" }],
      [{ ...testConnectionLimitChange(), new_limit: null }],
      [{ ...testConnectionLimitChange(), reason: "unknown" }],
    ].map((history) => ({ history }))
  )(
    "isolates malformed history %j without losing other stats",
    ({ history }) => {
      const stats = normalizeEvalStats({
        started_at: "start",
        connection_limit_history: history,
      });
      expect(stats?.connection_limit_history).toEqual([]);
      expect(stats?.connectionHistoryError).toMatch(
        "Invalid connection history"
      );
      expect(stats?.started_at).toBe("start");
    }
  );

  it.each([NaN, Infinity, -Infinity, 2 ** 57, -(2 ** 57)])(
    "preserves numeric timestamp %s for consumer range validation",
    (timestamp) => {
      const stats = normalizeEvalStats(
        testEvalStats({
          connection_limit_history: [testConnectionLimitChange({ timestamp })],
        })
      );
      expect(stats?.connection_limit_history[0]?.timestamp).toBe(timestamp);
      expect(stats?.connectionHistoryError).toBeUndefined();
    }
  );
});
