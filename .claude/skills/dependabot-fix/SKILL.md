---
name: dependabot-fix
description: Recurring maintenance task — clear the current batch of GitHub dependabot security alerts by adding or updating pnpm override entries in the root package.json. Use whenever the user mentions dependabot alerts, security advisories, CVEs/GHSAs, vulnerable dependencies, pnpm audit findings, or asks to "fix security issues" — even if they don't mention overrides.
---

# Fix dependabot alerts via pnpm overrides

Dependabot alerts accumulate continuously as new advisories are published;
clearing them is routine maintenance done every few weeks, not a one-off.
Each run works the same way: list whatever alerts are currently open, fix the
batch, ship one PR.

Scope: **indirect (transitive) deps only.** When the vulnerable package is a
direct dependency, dependabot generally opens its own bump PR — merge that
instead. This skill exists for the alerts dependabot can't auto-fix. The repo's
convention is to force patched versions via `pnpm.overrides` in the root
`package.json`. The entries already there are the residue of past runs —
follow their style, and expect this run to raise some of them (a package
patched at `^3.1.2` last time may need `^3.1.4` today; advisories often
outrun old pins).

## Workflow

### 1. List open alerts

```bash
gh api repos/meridianlabs-ai/ts-mono/dependabot/alerts --paginate \
  -q '.[] | select(.state == "open") | {num: .number, pkg: .dependency.package.name, severity: .security_advisory.severity, vulnerable: .security_vulnerability.vulnerable_version_range, patched: .security_vulnerability.first_patched_version.identifier, ghsa: .security_advisory.ghsa_id, summary: .security_advisory.summary}'
```

Note: `first_patched_version` is for ONE vulnerable range. An advisory can
cover several major lines, each with its own patched version. When a package
has multiple resolved majors in the tree, fetch the full advisory to see all
ranges: `gh api /advisories/<ghsa_id> -q .vulnerabilities`.

### 2. Understand how each package enters the tree

```bash
pnpm why -r <pkg>                      # who depends on it, all workspaces
grep -n "^  '\?<pkg>@" pnpm-lock.yaml  # which versions actually resolve
```

Key questions:
- Is it a **direct dep** of a workspace package? Check for an open dependabot
  PR (`gh pr list --author "app/dependabot"`) — if one exists, that alert is
  handled there; drop it from this batch. If dependabot didn't open one, bump
  the range in the owning package.json rather than adding an override.
- Do **multiple majors** resolve (e.g. `brace-expansion` 1.x and 2.x)? A bare
  override forces every dependent onto one range and can break consumers that
  need a different major.

### 3. Add/update the override

Edit `pnpm.overrides` in root `package.json`. Match the existing style
(caret range at the first patched version, e.g. `"fast-uri": "^3.1.4"`).

For multi-major packages, scope the override so each major stays on its own
patched line:

```jsonc
"pkg@1": "^1.1.12",   // version-scoped: only rewrites deps wanting 1.x
"parent>pkg": "^3.1.3" // parent-scoped: only rewrites parent's dep
```

If an override for the package already exists, raise its version rather than
adding a second entry — updating stale pins from previous runs is the normal
case, not the exception.

Before committing to a version jump across majors, sanity-check that the
forced version is API-compatible with what dependents expect — a security fix
that breaks the build is worse than the alert.

### 4. Apply and verify

```bash
pnpm install
grep -n "^  '\?<pkg>@" pnpm-lock.yaml # confirm vulnerable versions are gone
pnpm audit                            # should no longer report the advisory
pnpm check && pnpm build && pnpm test # forced bumps can break things
```

If a vulnerable version still resolves, `pnpm why -r <pkg>` again — usually a
second major line or a scoped override that missed a parent.

### 5. Ship

**One PR for the whole batch** — fix every actionable alert first, then
branch and commit once. Don't open per-alert PRs; the override edits all land
in the same two files (package.json + lockfile) anyway, and one PR keeps
review/CI cost flat. Commit message: concise list of packages bumped and
alert numbers. PR body: one line per alert (number, package, severity).
Alerts auto-close once the merged lockfile no longer contains vulnerable
versions — don't dismiss them manually.

## Gotchas

- Dependabot reads `pnpm-lock.yaml`, not package.json ranges — the lockfile
  must actually change for an alert to close.
- `minimumReleaseAge` (pnpm-workspace.yaml) blocks versions younger than 7
  days. When every patched version is still inside the soak window, don't
  silently add a `minimumReleaseAgeExclude` entry — ask the user whether to
  defer the alert or add the exclusion. Recommend deferring: waiting out the
  soak is the whole point of the setting, and the alert will fix cleanly next
  round. Overriding is the user's call for cases where the exposure outweighs
  the supply-chain risk. Note any deferred alert in the PR.
- Some packages are pinned low on purpose (e.g. `react-popper>react` scoping,
  `esbuild`). Don't "clean up" existing overrides while fixing alerts.
- An unfixable alert (no patched version, or patch requires an incompatible
  major) should be reported to the user, not papered over with a dismiss.
