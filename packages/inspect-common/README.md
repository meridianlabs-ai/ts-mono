# @tsmono/inspect-common

Shared non-UI code for working with Inspect AI eval logs: generated API
types, boundary normalization (`/normalize`), a query/condition builder
(`/query`), and test fixtures (`/testing`).

## TypeScript types from OpenAPI

Types in `src/types/generated.ts` are generated from inspect_ai's OpenAPI
schema — no schema copy is committed here:

```
Python Pydantic models → inspect-openapi.json (in inspect_ai) → src/types/generated.ts
```

`scripts/generate-types.js` locates the Python repo (requires running ts-mono
as a submodule of inspect_ai, or setting `TSMONO_PYTHON_ROOT_INSPECT_AI` to a
local checkout) and runs `openapi-typescript` against
`src/inspect_ai/_view/inspect-openapi.json`.

When Python models change, re-export the schema in inspect_ai, then:

```bash
pnpm types:generate
```

and commit the updated `generated.ts`. (`apps/scout` has a parallel pipeline
for inspect_scout's schema.)

## Normalization

Raw eval-log/journal JSON must pass through `/normalize`
(`normalizeEvalSample`, `normalizeEvents`, …) at the parse boundary before
the generated types can be trusted — old files omit fields the schema
declares required. See the type-safety section in
[AGENTS.md](../../AGENTS.md).
