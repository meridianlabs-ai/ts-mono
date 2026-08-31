import assert from "node:assert/strict";
import { test } from "node:test";

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
  const body = render({}, { "a`\n<b>|.ts": { "r`\n<b>|": { count: 1 } } });
  assert.ok(body.includes("<code>a` &lt;b&gt;&#124;.ts</code>"));
  assert.ok(body.includes("<code>r` &lt;b&gt;&#124;</code>"));
});
