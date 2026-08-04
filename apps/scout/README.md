# Inspect Scout Viewer

A React-based web viewer for Inspect AI evaluation logs.

## Prerequisites

This project uses [pnpm](https://pnpm.io/) as its package manager, managed through [corepack](https://nodejs.org/api/corepack.html).

### Setup

**Enable corepack** (required once):

```bash
corepack enable
```

That's it! Corepack is built into Node.js 16.9+ and will automatically install the correct pnpm version (specified in `package.json`) when you run pnpm commands.

**Alternative:** If you prefer to install pnpm manually, see the [official pnpm installation guide](https://pnpm.io/installation).

### Install Dependencies

```bash
pnpm install
```

## Development

Start the development server:

```bash
pnpm dev
```

Build for production:

```bash
pnpm build
```

Watch mode for development:

```bash
pnpm watch
```

Preview production build:

```bash
pnpm preview
```

## Code Quality

Run linting:

```bash
pnpm lint
```

Auto-fix linting issues:

```bash
pnpm lint:fix
```

Format code:

```bash
pnpm format
```

Check formatting:

```bash
pnpm format:check
```

Type check:

```bash
pnpm typecheck
```

Run all checks (lint, format, typecheck):

```bash
pnpm check
```

## TypeScript Types from OpenAPI

Types are auto-generated from the FastAPI OpenAPI spec to keep client/server in sync.

### How It Works

The type generation pipeline:

```
Python Pydantic models → openapi.json (in inspect_scout) → generated.ts → built app
```

1. **Schema source**: The OpenAPI schema lives in the inspect_scout Python
   repo at `src/inspect_scout/_view/openapi.json` — no copy is committed here
2. **Generate types**: `scripts/generate-types.js` locates the Python repo
   (requires running ts-mono as a submodule of inspect_scout) and runs
   `openapi-typescript` against the schema
3. **Type adapter**: `src/types/api-types.ts` re-exports types with clean names
4. **Usage**: Import types from `src/types/index.ts` in your code

### Updating Types After API Changes

When Python Pydantic models change:

```bash
# 1. Re-export the OpenAPI schema (from the inspect_scout repo root)
.venv/bin/python scripts/export_openapi_schema.py

# 2. Regenerate TypeScript types (from apps/scout in the submodule)
pnpm types:generate
```

Commit the updated schema in inspect_scout and `src/types/generated.ts` here.

### CI Validation

Schema and generated-type freshness is validated by inspect_scout's CI, which
regenerates the files and fails if they differ from the committed versions. If
that fails, run the commands above and commit the updated files.

## Tech Stack

- React 19
- TypeScript
- Vite
- Bootstrap 5
- AG Grid
- React Router
