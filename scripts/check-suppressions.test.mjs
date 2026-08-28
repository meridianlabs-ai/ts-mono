import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildLedger,
  diffLedgers,
  ratchetViolations,
  scanSource,
  totals,
} from "./check-suppressions.mjs";

test("line directive with description", () => {
  assert.deepEqual(
    scanSource("// eslint-disable-next-line a/rule -- fire-and-forget\n"),
    [{ rule: "a/rule", described: true }],
  );
});

test("line directive without description", () => {
  assert.deepEqual(scanSource("// eslint-disable-next-line a/rule\n"), [
    { rule: "a/rule", described: false },
  ]);
});

test("multiple rules in one directive count separately", () => {
  assert.deepEqual(scanSource("// eslint-disable-next-line a, b/c -- why\n"), [
    { rule: "a", described: true },
    { rule: "b/c", described: true },
  ]);
});

test("trailing eslint-disable-line after code", () => {
  assert.deepEqual(scanSource("foo(); // eslint-disable-line a/rule\n"), [
    { rule: "a/rule", described: false },
  ]);
});

test("block directive, description cut at comment close", () => {
  assert.deepEqual(scanSource("/* eslint-disable a/rule -- legacy */ x();\n"), [
    { rule: "a/rule", described: true },
  ]);
});

test("bare block disable maps to *", () => {
  assert.deepEqual(scanSource("/* eslint-disable */\n"), [
    { rule: "*", described: false },
  ]);
});

test("@ts-expect-error with and without description", () => {
  assert.deepEqual(
    scanSource("// @ts-expect-error the schema lies\n// @ts-expect-error\n"),
    [
      { rule: "@ts-expect-error", described: true },
      { rule: "@ts-expect-error", described: false },
    ],
  );
});

test("@ts-ignore is never described", () => {
  assert.deepEqual(scanSource("// @ts-ignore some excuse\n"), [
    { rule: "@ts-ignore", described: false },
  ]);
});

test("directive text outside a comment is ignored", () => {
  assert.deepEqual(scanSource('const s = "eslint-disable-next-line a";\n'), []);
});

test("buildLedger tallies per file and rule, omitting zero undescribed", () => {
  const ledger = buildLedger(
    new Map([
      [
        "b.ts",
        [
          { rule: "r", described: false },
          { rule: "r", described: true },
        ],
      ],
      ["a.ts", [{ rule: "r", described: true }]],
      ["empty.ts", []],
    ]),
  );
  assert.deepEqual(ledger, {
    "a.ts": { r: { count: 1 } },
    "b.ts": { r: { count: 2, undescribed: 1 } },
  });
  assert.deepEqual(Object.keys(ledger), ["a.ts", "b.ts"]);
});

test("diffLedgers reports growth and shrink", () => {
  const diffs = diffLedgers(
    { "a.ts": { r: { count: 2 } }, "gone.ts": { r: { count: 1 } } },
    { "a.ts": { r: { count: 3 } } },
  );
  assert.deepEqual(
    diffs.map(({ before, after }) => [before, after]),
    [
      [2, 3],
      [1, 0],
    ],
  );
});

test("ratchet flags undescribed growth, allows shrink and described growth", () => {
  const ledger = { "a.ts": { r: { count: 2, undescribed: 2 } } };
  assert.equal(
    ratchetViolations(ledger, { "a.ts": { r: { count: 3, undescribed: 3 } } })
      .length,
    1,
  );
  assert.equal(
    ratchetViolations(ledger, { "a.ts": { r: { count: 3, undescribed: 2 } } })
      .length,
    0,
  );
  assert.equal(
    ratchetViolations(ledger, { "a.ts": { r: { count: 1, undescribed: 1 } } })
      .length,
    0,
  );
});

test("ratchet flags a new file with an undescribed suppression", () => {
  assert.equal(
    ratchetViolations({}, { "new.ts": { r: { count: 1, undescribed: 1 } } })
      .length,
    1,
  );
});

test("totals sums counts and undescribed", () => {
  assert.deepEqual(
    totals({
      "a.ts": { r: { count: 2, undescribed: 1 }, s: { count: 1 } },
      "b.ts": { r: { count: 3, undescribed: 3 } },
    }),
    { count: 6, undescribed: 4 },
  );
});
