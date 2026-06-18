# @tsmono/theme

The viewer's design system — `--inspect-*` CSS custom-property tokens, an
element reset, and a small global utility vocabulary — shared by the Inspect and
Scout viewers.

Import the layers you need (side-effect CSS, plus one TS helper):

| Import                      | What                                                                                                                                |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `@tsmono/theme/tokens`      | The `--inspect-*` tokens: the public **inputs** (`theme.css` — the re-theming contract) + the derived internal layer it `@import`s. |
| `@tsmono/theme/reboot`      | Element reset + base element defaults (links, inline code).                                                                         |
| `@tsmono/theme/utilities`   | Global utility classes (`text-size-*`, truncation, `visually-hidden`, `[data-tooltip]`).                                            |
| `@tsmono/theme/transcript`  | Cross-cutting transcript rules (readable-variant role bands, `.tool-output`).                                                       |
| `@tsmono/theme/vscode`      | Browser fallbacks for the `--vscode-*` vars the vendored `@vscode-elements` components read.                                        |
| `@tsmono/theme/apply-theme` | Framework-agnostic theme bootstrap: sets `data-theme` from the persisted preference at start.                                       |

## Re-theming

The viewer ships as a self-contained bundle. Re-skin it by overriding the public
**input** tokens — set a base once and its surfaces/borders/emphasis follow, in
both light and dark, via `color-mix()`; you never touch the derived tokens.

| Input                                                        | Role                   |
| ------------------------------------------------------------ | ---------------------- |
| `--inspect-foreground` / `-background` / `-surface`          | text / page / surfaces |
| `--inspect-border`                                           | hairlines              |
| `--inspect-primary`                                          | accent / interactive   |
| `--inspect-danger` / `-success` / `-warning`                 | status                 |
| `--inspect-link`                                             | links                  |
| `--inspect-code-foreground`                                  | inline code            |
| `--inspect-radius`                                           | corner rounding        |
| `--inspect-font-family` / `-font-mono`                       | type families          |
| `--inspect-font-size-base` / `-font-weight` / `-line-height` | type metrics           |

1. **Light/dark** is driven by `data-theme="dark"` on the document root — the
   same attribute `apply-theme.ts` sets and the cross-app signal hawk shares.
   The readable transcript variant is a second axis (`data-theme-variant="readable"`)
   and is the **default** ("Event Colors"): a fixed editorial palette that also
   replaces `--inspect-foreground` in the transcript, so your brand foreground is
   not the transcript body color until a user switches the variant off.
2. **Override the inputs**, light + dark:

   ```css
   :root {
     --inspect-primary: #6f42c1;
     --inspect-link: #6f42c1;
     --inspect-radius: 6px;
     --inspect-font-family: "Inter", system-ui, sans-serif;
   }
   :root[data-theme="dark"] {
     --inspect-primary: #b794f6;
     --inspect-link: #b794f6;
   }
   ```

   Caveats:
   - **Load order + dark selector.** Your override must load **after** the viewer
     bundle (or sit at equal-or-higher scope) to beat the compiled `:root`
     defaults. Dark overrides must use the `:root[data-theme="dark"]` selector
     (as above) — a plain `:root` rule loses to the bundle's dark block.
   - **Dark mode routes through the VS Code bridge even in a plain browser.**
     `apply-theme.ts` sets a `vscode-*` body class in dark mode, so the dark
     values for _derived_ chrome come from the IDE-token fallbacks in
     `vscode.css`. Your `:root[data-theme="dark"]` _input_ overrides still win
     (higher specificity than the bridge), but a derived token you don't override
     follows the bridge, not a `color-mix` of your dark inputs.
   - **iframe.** Custom properties don't cross frame boundaries — set `data-theme`
     and load your overrides **inside the iframe's document**; a parent-page
     `:root` override is invisible to the child.

   `--inspect-font-size-base` is the document/body base (default `1rem`): `body`
   reads it directly, and content text (the `text-size-*` utilities and component
   text, via the derived `--inspect-font-size-content` = `0.9 ×` base) scales with
   it. The heading ramp and the rest of the type scale are fixed.

   **Not on the public surface** — override the internal token directly, or leave:
   text selection, the readable-variant and `info` editorial palettes, the heading
   size ramp, the fixed type scale, and the `Select` dropdown chevron (a
   hardcoded-stroke inline SVG that doesn't follow `--inspect-foreground`).

Maintaining the system — architecture, the derivation layer, conventions, and
how to add a token — is documented in
[`design/theme-system.md`](../../design/theme-system.md).
