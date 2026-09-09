import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { MARKER, render } from "./suppressions-pr-delta.mjs";

test("renders nothing when unchanged", () => {
  const ledger = { "a.ts": { r: { count: 1, undescribed: 1 } } };
  assert.equal(render(ledger, ledger), null);
});

test("growth renders marker, warning heading, row, and footer", () => {
  const body = render({}, { "a.ts": { r: { count: 1 } } });
  assert.ok(body.startsWith(MARKER));
  assert.match(body, /⚠️ Suppression ledger grew: 0 → 1 \(\+1\)/);
  assert.ok(body.includes("| <code>a.ts</code> | <code>r</code> | +1 |"));
  assert.match(body, /maintainer sign-off/);
});

test("shrink renders plain heading without footer", () => {
  const body = render(
    { "a.ts": { r: { count: 2 } } },
    { "a.ts": { r: { count: 1 } } },
  );
  assert.match(body, /Suppression ledger changed: 2 → 1 \(-1\)/);
  assert.doesNotMatch(body, /maintainer sign-off/);
});

test("undescribed-only change still renders", () => {
  const body = render(
    { "a.ts": { r: { count: 1, undescribed: 1 } } },
    { "a.ts": { r: { count: 1 } } },
  );
  assert.ok(
    body.includes("| <code>a.ts</code> | <code>r</code> | ±0 (reason-less 1 → 0) |"),
  );
  assert.match(body, /Reason-less \(baselined\) suppressions: 1 → 0/);
});

test("warns when reason-less count grows without total growth", () => {
  const body = render(
    { "a.ts": { r: { count: 1 } } },
    { "a.ts": { r: { count: 1, undescribed: 1 } } },
  );
  assert.match(body, /⚠️ Reason-less suppressions grew: 0 → 1 \(\+1\)/);
  assert.match(body, /maintainer sign-off/);
});

test("escapes untrusted table cell text", () => {
  const body = render({}, { "a`\n<b>|[.ts": { "r`\n<b>|[": { count: 1 } } });
  assert.ok(body.includes("<code>a&#96; &lt;b&gt;&#124;&#91;.ts</code>"));
  assert.ok(body.includes("<code>r&#96; &lt;b&gt;&#124;&#91;</code>"));
});

test("markdown link/image syntax cannot form in a cell", () => {
  const body = render(
    {},
    { "![](https://evil.example/p.png)": { "[x](https://y)": { count: 1 } } },
  );
  // No raw `[` may survive: without an opening bracket the `](url)` tail
  // is inert text, so no live link or image can render.
  assert.ok(!body.includes("["));
  assert.ok(body.includes("<code>!&#91;](https://evil.example/p.png)</code>"));
});

test("non-numeric tally values from a fork ledger cannot inject markdown", () => {
  const payload = "0\n\n[click](https://evil.example)";
  const body = render(
    { "a.ts": { r: { count: 1 } } },
    {
      "a.ts": { r: { count: payload, undescribed: payload } },
      "b.ts": { r: { count: 2 } },
    },
  );
  // Crafted strings coerce to 0 and never reach the heading, the per-row
  // reason-less note, or the reason-less summary line.
  assert.ok(!body.includes("evil.example"));
  assert.match(body, /⚠️ Suppression ledger grew: 1 → 2 \(\+1\)/);
});

test("malformed ledger shapes render without throwing", () => {
  const body = render(null, {
    "a.ts": null,
    "b.ts": 5,
    "c.ts": { r: null, s: { count: 1 } },
  });
  assert.match(body, /⚠️ Suppression ledger grew: 0 → 1 \(\+1\)/);
  assert.ok(body.includes("| <code>c.ts</code> | <code>s</code> | +1 |"));
});

// --- CLI arg handling ---

const SCRIPT = fileURLToPath(
  new URL("./suppressions-pr-delta.mjs", import.meta.url),
);

const runDelta = (...args) =>
  spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8" });

test("CLI rejects missing or extra path args instead of printing nothing", () => {
  for (const args of [[], ["only-base.json"], ["a.json", "b.json", "extra"]]) {
    const result = runDelta(...args);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /usage: suppressions-pr-delta\.mjs/);
    assert.equal(result.stdout, "");
  }
});

test("CLI still tolerates missing ledger files (pre-ledger branches)", () => {
  const result = runDelta("no-such-base.json", "no-such-head.json");
  assert.equal(result.status, 0);
  assert.equal(result.stdout, "");
});
