# The `--inspect-*` theme system

Maintainer notes for `@tsmono/theme`. Consumers only need the package
[README](../packages/theme/README.md); this is the internal design.

## Layers

Styling is layered; each `@tsmono/theme` subpath has one job:

- **`theme.css`** — the public theming contract: the ~16 `--inspect-*` input
  tokens (light + dark) a downstream overrides. The whole file _is_ the surface.
- **`tokens.css`** — the derived/internal layer (it `@import`s theme.css):
  surfaces, borders, emphasis, hover, fixed accents, the readable variant, and
  the VS Code bridge, all computed from the inputs. Don't override these; see
  [the token-file structure](#token-files).
- **`reboot.css`** — element reset + base element defaults (links, inline code).
  No classes.
- **`utilities.css`** — the small global utility vocabulary (`text-size-*`,
  truncation/clamping, `visually-hidden`, `[data-tooltip]`). The only classes
  meant to be used as raw strings in JSX.
- **`transcript.css`** — cross-cutting transcript rules: the readable-variant
  role bands (keyed on `data-message-role` / `data-content-kind`) and the
  `.tool-output` hook. Lives here because no single component owns it.
- **`vscode.css`** — browser fallbacks for the `--vscode-*` tokens the vendored
  `@vscode-elements/*` web components read internally, so the form controls
  render styled outside a VS Code webview. We only _consume_ `--vscode-*`.
- **`apply-theme.ts`** — framework-agnostic bootstrap: resolves the persisted
  preference and sets `data-theme`, `data-theme-variant`, and the `vscode-dark`
  body class before first paint.

Component styling does **not** live here. Components own their look via
co-located CSS modules that read the tokens; third-party DOM styling (Prism, AG
Grid, jsondiffpatch, ANSI) is co-located with the wrapper component that owns
the dependency.

## Token files

Two files, read as a pipeline. CSS custom properties resolve lazily (at use
time), so the split is safe regardless of import order — each derived token
reads whatever value its input currently has:

1. **`theme.css` — public inputs** (`:root` + `:root[data-theme="dark"]`): the
   ~16 semantic tokens a downstream embedder overrides. The whole file is the
   contract; nothing else lives there.

Everything below lives in **`tokens.css`** (which `@import`s theme.css), each
derived from those inputs:
2. **Derived internals** — surfaces, borders, emphasis, hover/muted variants
   `color-mix()`d from the inputs against the theme-aware
   `--inspect-background` / `--inspect-foreground`. Because `color-mix` resolves
   at use time, each derived token is correct in light **and** dark from one
   definition — there is no parallel dark list to maintain, and overriding an
   input re-tints its whole family in both themes.
3. **Fixed internals** — values that can't derive (theme-extreme contrast, the
   type scale, fixed accents, shadows).
4. **Component-family tokens** — cross-cutting tokens a component reads
   (`--inspect-tool-*`, `--inspect-input-*`, `--inspect-readable-*`, …). They
   live centrally only when they (a) vary by theme axis (dark / readable) or
   (b) are remapped by the VS Code bridge. Otherwise — including a single-owner
   value that just wants a name — keep it a `--_*` local in the component module;
   a shared constant can live in a shared module without becoming a public token.
5. **Readable variant** (`:root[data-theme-variant="readable"]`) — re-points a
   few component-family tokens to higher-contrast editorial colors.
6. **VS Code host bridge** (`body[class^="vscode-"]`) — the one place that
   writes derived/internal tokens directly: inside a webview the IDE owns the
   palette, so the bridge maps `--vscode-*` onto our tokens, short-circuiting
   the derivation layer. This is the deliberate exception to "override only the
   public inputs."

## Conventions

- `--inspect-*` names are owned by this package. Other code may _override_ a
  contract token on a subtree (re-skinning) but must not mint new `--inspect-*`
  names — `theme-contract.test.ts` (apps/inspect) enforces this. Component-
  private parameterization uses a `--_*` local inside the module; a value that
  is never re-themed never becomes an `--inspect-*` token. **Decision rule:** mint
  a central `--inspect-*` only if it (a) needs a `data-theme="dark"` or readable
  override or (b) has a VS Code bridge entry — "shared by several consumers" alone
  is not enough (put a shared constant in a shared module).
- Host re-skins live beside what they re-skin: a component's VS Code treatment
  is a `:global(body[class^="vscode-"])`-scoped rule in its own module. Prefer
  re-assigning vars over raw properties: a vars-only host block can't have a
  cascade-order conflict with the base rule. Some components (e.g. ModalShell,
  Navbar) do set raw properties in their host block — allowed, but those rules
  must own their specificity/order against the base rule deliberately.
- `body.vscode-dark` is set both by real VS Code webviews and by `apply-theme`
  in browser dark mode; `vscode.css`'s dark `--vscode-*` values are the
  dark-mode palette.

## What a re-theme reaches

Overriding the public inputs (see the README) propagates as follows:

- **Follows the accent:** links, and everything `color-mix`ed from the status
  bases — the `*-surface` / `*-border` / `*-emphasis` washes and the focus-ring
  color (`--inspect-focus-*`, derived from `--inspect-primary`).
- **Follows surface/foreground, but neutral (not the accent):** structural
  chrome like the active-tab highlight (a muted surface, not a brand fill).
- **Not on the public surface — leave, or override the internal token
  directly:** text selection uses the editor selection color
  (`--inspect-active-selection-background`, tied to the VS Code host, not the
  brand); the transcript editorial palettes — readable-variant role bands
  (`--inspect-readable-*`) and the diff add/remove colors — are fixed. Note that
  `data-theme-variant="readable"` replaces `--inspect-foreground` with a
  higher-contrast body color in light mode; in dark, the VS Code bridge sets
  `--inspect-foreground` on `<body>` (nearer than the variant's `<html>` rule),
  so the bridge's editor foreground wins by inheritance and the readable body
  color does not apply (the role bands, set on the role element, are unaffected).

(Focus rings are wired to the derived focus tokens in most controls but not yet
every one — a known gap, not a contract guarantee.)

## Adding or changing a token

The contract test forbids minting `--inspect-*` names outside this package so
the public surface can't grow by accident. The intended path is a one-file
registry edit in `tokens.css`: add the name with its light value, a
`:root[data-theme="dark"]` value if it differs, and a `body[class^="vscode-"]`
mapping if the IDE host should own it. Component-private parameterization that
is _not_ meant to be re-themed stays a `--_*` local in the owning module and
never touches this package.

A token defined by `color-mix()` from the public inputs needs **no** dark value
and **no** bridge entry — it re-derives automatically (the point of the
derivation layer). A **fixed** accent (e.g. `--inspect-info-surface`) _does_ need
an explicit `body[class^="vscode-"]` entry, or it won't track the IDE palette in
a webview.

`theme-contract.test.ts` guards three things: no `--bs-*` / `data-bs-theme`
residue; no `--inspect-*` minted outside this package; and that every
`var(--inspect-*)` reference — including `.ts` inline-style strings (e.g.
`colorScale.ts`) — resolves to a defined token. It does **not** check
derived-token correctness, contrast, or that the test's `PUBLIC_INPUTS` list
still matches `theme.css` — keep those in sync by hand.

`composes:` (the cross-module sharing pattern, e.g. `usageSwatches.module.css`)
only works from a **simple class** into a **simple class** — not from/into
compound or pseudo selectors; inline the rule when the target isn't a bare class.
