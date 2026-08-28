# Contributing

Conventions, code style, and testing guidance live in [AGENTS.md](AGENTS.md).
This file covers the policies contributors must follow.

## Lint / type-check suppressions

**Don't suppress. Fix the code.**

A lint or type error means the tooling found a problem. Fix the problem
instead of silencing the tool: restructure the code, fix the types, narrow
the input. If you're reaching for `eslint-disable` or `@ts-expect-error`
and you can't say exactly why the tool is wrong here and why no fix is
possible, stop. The suppression is almost certainly the wrong move, and
maintainers won't accept a PR on "it made the error go away" grounds.

`suppressions.json` counts every suppression comment by file and rule.
CI fails if it doesn't match the code.

In the rare case a suppression is correct:

1. Write the reason into the comment:
   `// eslint-disable-next-line <rule> -- <why the tool is wrong here and no fix exists>`
2. Run `pnpm suppressions:update` and commit the ledger diff. That diff is
   your request for sign-off. A maintainer must accept every new
   suppression; the reason alone doesn't earn acceptance.

To remove one, delete the comment and run `pnpm suppressions:update`. The
total only goes down over time.
