import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

// The release build restores no cache another workflow could have saved
// (decision: Ransom, 2026-09-21).
const workflow = readFileSync(
  new URL("../.github/workflows/npm-publish.yml", import.meta.url),
  "utf8"
);
const code = workflow.replace(/^\s*#.*\n/gm, "");

test("no step restores an Actions cache", () => {
  assert.doesNotMatch(code, /uses:\s*actions\/cache(\/restore)?@/);
  assert.doesNotMatch(code, /^\s*(restore-keys|cache-from|cache-to):/m);
  assert.doesNotMatch(code, /^\s*cache:\s*(?!false\s*$)/m);
});

test("setup-node's automatic package-manager cache is off", () => {
  assert.match(code, /^\s*package-manager-cache:\s*false\s*$/m);
});

test("turbo neither reads nor writes a local or remote cache", () => {
  assert.match(code, /^ {6}TURBO_CACHE:\s*"local:,remote:"\s*$/m);
  assert.doesNotMatch(code, /TURBO_(TOKEN|TEAM|API|REMOTE_ONLY)|--cache[= ]/);
});

test("no local composite action, which could set up its own caches", () => {
  assert.doesNotMatch(code, /uses:\s*\.\//);
});
