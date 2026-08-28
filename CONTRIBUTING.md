# Contributing

Conventions, code style, and testing guidance live in [AGENTS.md](AGENTS.md).
This file covers the policies contributors must follow.

## Lint / type-check suppressions

**Don't suppress. Fix the code.**

A lint or type error means the tooling found a problem. The answer is to
fix the problem — restructure the code, fix the types, narrow the input —
not to silence the tool. If you're reaching for `eslint-disable` or
`@ts-expect-error` and you can't articulate precisely why the tool is
wrong *here* and why no fix is possible, stop: the suppression is almost
certainly the wrong move, and the PR will not be accepted on "it made the
error go away" grounds.

Every suppression comment is registered by count in `suppressions.json`.
CI fails if that file doesn't match the code.

In the rare case a suppression is genuinely correct:

1. Write the reason into the comment:
   `// eslint-disable-next-line <rule> -- <why the tool is wrong here and no fix exists>`
2. Run `pnpm suppressions:update` and commit the ledger diff. That diff is
   your request for sign-off: a maintainer must accept every new
   suppression, and the reason alone doesn't earn acceptance.

Removing one: delete the comment, run `pnpm suppressions:update`. The
total only goes down over time.
