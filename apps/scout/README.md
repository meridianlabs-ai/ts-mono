# Inspect Scout Viewer

React web app for
[Inspect Scout](https://github.com/meridianlabs-ai/inspect_scout) — browse
scans, scanner results, and transcripts. The production build is copied into
the inspect_scout Python package (via the
[submodule workflow](../../docs/submodule-guide.md)) and served by Scout's
view server.

For repo setup (corepack, pnpm, install), see the
[root README](../../README.md).

## Development

Run commands from this directory, or from the repo root with
`pnpm <command> --filter=scout` (the root scripts pass the filter through to
`turbo run`, preserving task dependencies):

| Command           | Description                                        |
| ----------------- | -------------------------------------------------- |
| `pnpm dev`        | Start the Vite dev server on :5174                 |
| `pnpm build`      | Build the app (copied into the Python repo when running as a submodule) |
| `pnpm watch`      | Rebuild on change                                  |
| `pnpm test`       | Run unit/integration tests (vitest)                |
| `pnpm test:watch` | Run tests in watch mode                            |
| `pnpm e2e`        | Run Playwright e2e tests (`e2e:ui`, `e2e:headed`)  |
| `pnpm lint`       | Lint (`lint:fix` to auto-fix)                      |
| `pnpm typecheck`  | Type check                                         |
| `pnpm format`     | Format with Prettier                               |

The dev server proxies `/api` to a Scout view server expected at
`http://127.0.0.1:7576`.

## TypeScript types from OpenAPI

API types are generated from inspect_scout's FastAPI OpenAPI spec to keep
client and server in sync:

```
Python Pydantic models → openapi.json (in inspect_scout) → src/types/generated.ts
```

1. **Schema source**: the schema lives in the inspect_scout Python repo at
   `src/inspect_scout/_view/openapi.json` — no copy is committed here
2. **Generate types**: `scripts/generate-types.js` locates the Python repo
   (requires running ts-mono as a submodule of inspect_scout, or setting
   `TSMONO_PYTHON_ROOT_INSPECT_SCOUT` to a local checkout) and runs
   `openapi-typescript` against the schema
3. **Type adapter**: `src/types/api-types.ts` re-exports types with clean names
4. **Usage**: import types from `src/types/api-types.ts`

(`packages/inspect-common` has a parallel pipeline for inspect_ai's schema.)

### Updating types after API changes

When Python Pydantic models change:

```bash
# 1. Re-export the OpenAPI schema (from the inspect_scout repo root)
.venv/bin/python scripts/export_openapi_schema.py

# 2. Regenerate TypeScript types (from apps/scout in the submodule)
pnpm types:generate
```

Commit the updated schema in inspect_scout and `src/types/generated.ts` here.
inspect_scout's CI regenerates both and fails if they differ from what's
committed.

## Tech stack

React 19, TypeScript, Vite, react-router, zustand, TanStack
(Query/Table/Virtual), Bootstrap 5, vitest + MSW, Playwright. AG Grid remains
in the dataframe view only — new tables use TanStack Table.
