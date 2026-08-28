---
name: verify-log-viewer
description: Drive the real inspect log viewer (apps/inspect web UI) against real .eval fixture logs and capture evidence that user-facing behavior works — log list, sample detail, transcript, scores. Use when a change to the viewer needs proof it behaves correctly in the running app, not just in unit tests.
---

# Verify the inspect log viewer

This skill launches the real viewer stack — an `inspect view` API server
reading real `.eval` files, plus the app's vite dev server — and drives it
with Playwright the way a user would. It is not the mocked e2e suite: the
specs in `apps/inspect/e2e/` stub `/api` with MSW and in-memory JSON logs;
this harness exercises the production transport (view-server API, binary
`.eval` parsing, streaming) end to end.

All commands below run from `apps/inspect`. The harness lives in this
directory (`.claude/skills/verify-log-viewer/`); it never edits product code.

## Configuration knobs

Every command reads the same four env vars (defaults in parentheses):

- `VERIFY_VIEWER_PORT` (5179) — vite dev server port for this harness.
- `VERIFY_VIEW_SERVER_PORT` (7677) — `inspect view` API port for this harness.
- `INSPECT_BIN` (`inspect` on PATH) — the inspect_ai CLI. Installing
  inspect_ai in a venv puts `inspect` on PATH while that venv is active, so
  the default works there. Outside a venv, point at one directly, e.g.
  `INSPECT_BIN=~/code/inspect_ai/.venv/bin/inspect`.
- `VERIFY_LOG_DIR` (`~/code/viewer-validation/logs`) — directory of `.eval`
  fixture logs. The default holds ~23 deterministic mockllm logs
  (viewer-rich, viewer-arithmetic, viewer-error, viewer-cancelled, …) — no
  model calls, so runs are free and reproducible.

Ports 5173/5174 (the apps' own dev servers), 5175/5176 (the mocked e2e
suites), and 7575 (the user's real `inspect view`) are deliberately NOT used.

## Doctor

Before driving anything, run the read-only preflight:

```sh
.claude/skills/verify-log-viewer/doctor.sh
```

It reports whether the two harness ports are free (and who owns them if
not), whether the inspect CLI resolves, and whether the fixture dir has
`.eval` files. If a port is busy, stop that process or pick another port via
the env vars — never drive a server this run did not start.

## Launch

Playwright owns the lifecycle: its config starts both servers, waits for
readiness, and kills them at the end of the run. There is nothing to start
by hand:

```sh
INSPECT_BIN=~/code/inspect_ai/.venv/bin/inspect \
  pnpm exec playwright test --config .claude/skills/verify-log-viewer/playwright.verify.config.ts
```

Readiness: the view server is up when `http://127.0.0.1:7677/api/logs`
returns the log listing; the viewer is up when `http://localhost:5179/`
answers. Both use `reuseExistingServer: false` — a busy port fails the run
instead of silently driving someone else's session.

To start the stack manually for interactive poking (two terminals):

```sh
~/code/inspect_ai/.venv/bin/inspect view start \
  --log-dir ~/code/viewer-validation/logs --port 7677 --display plain
pnpm exec vite --config .claude/skills/verify-log-viewer/vite.verify.config.ts
```

Then open `http://localhost:5179/`. Kill both processes (Ctrl-C) when done —
kill the PIDs you started, never by process name.

Why the extra vite config: the app's own `pnpm dev` proxies `/api` to the
hardcoded port 7575 — the user's real `inspect view`. The view server sends
no CORS headers and rejects cross-site requests, so the viewer must reach it
same-origin through the proxy; `vite.verify.config.ts` extends the app's
config and only re-points that proxy at the harness port.

## Drive

Write drives as Playwright specs in `drive/` (they run via the Launch
command above; add `-g "<test name>"` to run one). The specs resolve
`@playwright/test` through `apps/inspect/node_modules`, which is why this
skill lives app-local rather than at the repo root.

The feature map in [`features/`](features/README.md) is the maintained
recipe book: what each feature is, how a user reaches it, exact selectors,
and what observable end state proves it works. Read the README index first;
a proof that drives one convenient entry point is incomplete when the map
lists others.

`drive/log-viewer.spec.ts` is the standing proof run — one test per mapped
feature. Keep it passing; extend it when the map grows.

## Evidence

Proof artifacts go to `.claude/skills/verify-log-viewer/evidence/`
(gitignored, named per feature, overwritten each run — the current contents
are the latest proof). Playwright's own failure artifacts land in
`test-results/` next to it.

Standards for a proof:

- Exercise the real user path (navigate, click, read) — not internal
  setters, not test-only endpoints, and no MSW mocks anywhere.
- Capture the action AND the resulting state: assert on rendered text/roles,
  then screenshot the end state into `evidence/`.
- The fixture logs are the ground truth — assert values that are actually in
  the `.eval` file being driven (task name, sample input, score value), not
  merely "something rendered".
- Evidence survives cleanup: Playwright tears down the servers but never
  touches `evidence/`.

## Cleanup

Nothing to do in the normal path: Playwright kills the two servers it
spawned. After a crashed or interrupted run, check for strays with
`doctor.sh` (it names the PID owning each harness port) and kill those PIDs
specifically. Never `pkill -f inspect` or `pkill -f vite` — the user may be
running their own.

`test-results/` may be deleted freely; `evidence/` holds the proof — leave
it.

## Isolation

Two harness runs cannot share ports: to run concurrently, give the second
run different `VERIFY_VIEWER_PORT`/`VERIFY_VIEW_SERVER_PORT`. The fixture
log dir is opened read-only by the view server, so concurrent readers are
safe. The viewer stores per-origin state in IndexedDB keyed by port — a
changed port is a cold cache, which is fine for verification.

## Maintenance

When the viewer's UI or routes change, update the feature map and the
standing spec together — see `/maintain-verification-skill`.
