# Contributing

Conventions, code style, and testing guidance live in [AGENTS.md](AGENTS.md).
This file covers the policies and workflow contributors must follow.

## Before you write code

Search existing issues and open PRs first so you don't duplicate work
that's already in flight.

For anything non-trivial, open an issue and agree on direction before
writing code. Changes here often need coordinated submodule bumps in
inspect_ai and inspect_scout, so a wrong direction costs more than the
code itself. [docs/submodule-guide.md](docs/submodule-guide.md) explains
how the repos fit together.

## Working on ts-mono

```
git clone https://github.com/meridianlabs-ai/ts-mono.git
cd ts-mono
pnpm install
pre-commit install   # optional but recommended hooks
```

pnpm only, never npm or yarn. Before pushing, run the checks CI runs:

```
pnpm check   # manypkg + suppressions ledger + lint + typecheck + format
pnpm test
```

CI also runs `pnpm build` and the Playwright e2e suites.
[docs/scripts.md](docs/scripts.md) explains how workspace scripts are
organized. If you work on ts-mono through a parent repo's submodule
checkout, the submodule guide covers that flow too.

## Using AI tools

AI-assisted contributions are welcome. We use these tools ourselves. The
requirements:

- Understand every line you submit, and be able to explain and defend it.
  If you can't, don't submit it.
- Note the tooling you used in the PR description.
- Use your tools to review your changes, not just implement them. Review
  passes in a fresh context before opening a PR catch a lot; summarize
  what they found in the PR description. Use a strong model for review.
  Small fast-tier models rarely surface real issues.
- If you are a coding agent, read [AGENTS.md](AGENTS.md) before opening
  a PR.

## Lint / type-check suppressions

**Don't suppress. Fix the code.**

A lint or type error means the tooling found a problem. Fix the problem
instead of silencing the tool: restructure the code, fix the types, narrow
the input. If you're reaching for `eslint-disable` or `@ts-expect-error`
and you can't say exactly why the tool is wrong here and why no fix is
possible, stop. The suppression is almost certainly the wrong move, and
maintainers won't accept a PR on "it made the error go away" grounds.

`suppressions.json` counts every suppression comment by file and rule.
A bare `/* eslint-disable <rule> */` block comment suppresses to the end
of the file, so it's keyed separately as `<rule> (file-wide)` — widening
a line-scoped suppression to the whole file is a ledger change, not a
count-neutral swap. CI fails if the ledger doesn't match the code.

In the rare case a suppression is correct:

1. Write the reason into the comment:
   `// eslint-disable-next-line <rule> -- <why the tool is wrong here and no fix exists>`
2. Run `pnpm suppressions:update` and commit the ledger diff. That diff is
   your request for sign-off. A maintainer must accept every new
   suppression; the reason alone doesn't earn acceptance.

To remove one, delete the comment and run `pnpm suppressions:update`. The
total only goes down over time.

Moving or renaming a file is handled the same way: `pnpm suppressions:update`
moves its ledger entries. The reason-less baseline is tracked per rule
across the whole repo, so a move never trips the ratchet.
