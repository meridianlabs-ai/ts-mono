# Removing the Bootstrap CSS dependency

Status: PRs 1–5 are done; PR 6 and the optional PR 7 remain. Measurements
in the analysis sections are from `main` at `b4b6753f` (2026-11-12), before
PR 1.

Before PR 5 both apps imported all of `bootstrap@5.3.8` CSS:
`apps/inspect/src/app/App.tsx` imported `bootstrap.css`, and
`apps/scout/src/App.tsx` and the scout dataframe e2e fixture imported
`bootstrap.min.css`. We used no Bootstrap JavaScript:
nothing imports `bootstrap/dist/js` or uses `data-bs-*` behaviour attributes,
and `@types/bootstrap` was an unused dev dependency. `bootstrap-icons` is a
separate package and out of scope.

## Recommendation

Remove Bootstrap in six PRs. PRs 1–3 copy the parts we use into
`packages/theme`: variables, Reboot, then component classes. Each one is
gated by a computed-style comparison between Bootstrap as shipped and
Bootstrap with that part deleted plus our copy. The result must be
identical. PR 4 deletes dead rules. PR 5 deletes the import, and it is the
only PR with intended visual changes. PR 6 removes the specificity
workarounds that only exist to beat Bootstrap. An optional PR 7 stops the
reset applying to host pages such as hawk.

Keep the `--bs-*` variable names and the `data-bs-theme` attribute. Hawk
writes and reads the attribute, and inspect_vscode reads `--bs-body-color`
(see [Theme attribute](#theme-attribute)). Keeping the names also leaves
the 1,355 references untouched. Renaming is an optional later step.

Rough size: about 1,000 lines of CSS added to `packages/theme`, nearly all of it
copied from Bootstrap, and about 150 removed from `base.css`. PRs 1–5
change almost no TSX. PR 6 edits about 15 CSS modules. The main risks are
the cascade-order changes in PR 5 and hawk, which embeds both viewers.

## What Bootstrap does for us

| Job | How much | Notes |
| --- | --- | --- |
| Colour, radius and font variables (`--bs-*`) | 91 names, 1,355 references in 205 files | 54 names outside components (5 of them undefined, see [bugs](#pre-existing-bugs-found-while-measuring)) and 37 component-scoped names (`--bs-btn-*`, `--bs-nav-*`, ...) |
| Element reset (Reboot) | Every rendered element | `box-sizing`, body typography, list, paragraph and `pre` margins, form-control font inheritance, table borders |
| Component and utility classes | 15 class families in about 30 TSX files | Mostly behind shared wrappers |
| Dark theme switch | `data-bs-theme` on `<html>` | Read by 128 selectors in our CSS, and by hawk |

Payload: `bootstrap.min.css` is 232 KB minified and 31 KB gzipped. Both apps'
library builds (`lib/styles/index.css`) include it, so hawk receives it, and
Reboot's global element rules apply to hawk's own page.

Counts come from `git grep` over `apps/` and `packages/` (`.ts`, `.tsx`,
`.css`, `.html`). Class counts come from a script that extracts string
literals from TSX and keeps tokens that are Bootstrap class names. I read
each hit and removed test names and data values.

### Variables

The 54 names outside components:

- **Set by our CSS somewhere (29 names, about 1,110 references).** For
  example `--bs-border-color` (170), `--bs-body-color` (123),
  `--bs-secondary-color` (113), `--bs-body-bg` (111), `--bs-secondary` (90),
  `--bs-border-radius` (82), `--bs-light-border-subtle` (77). Most are
  re-pointed only inside the VS Code bridge (`body[class^="vscode-"]` in
  `packages/theme/src/base.css`). `base.css` also sets `--bs-border-radius`,
  `--bs-border-radius-lg` and `--bs-code-color` on `:root`, and the readable
  variant sets `--bs-body-color`. Every other value in the standalone
  theme comes from Bootstrap.
- **Never set by our CSS (25 names, about 160 references).** For example
  `--bs-font-monospace` (65), `--bs-success` (23), `--bs-body-color-rgb`
  (13), `--bs-tertiary-color` (10), `--bs-orange` (9). Five of these are
  defined nowhere, by us or by Bootstrap.

The 37 component-scoped names have 1–7 references each. Each one either
overrides a Bootstrap component we will own or is dead.

The CSS we copy in PRs 2 and 3 also reads names nobody references today,
such as `--bs-border-width`, `--bs-font-sans-serif`, `--bs-body-font-*`. The token
file has to define those too. The
completeness check in [Verification](#verification) catches any we miss.

### Reboot

grep can't count Reboot use, so I measured it.

**Method.** Throwaway worktree, vite dev servers for both apps, real logs
(hackthebox, theory-of-mind and gpqa-diamond `.eval` files) and a real scout
project (a 25-transcript scan, 1,458 transcripts). A Playwright script
replaced the text of Bootstrap's `<style>` element on each loaded screen
with one of three variants:

- `full`: Bootstrap as shipped.
- `noreboot`: Bootstrap with every Reboot selector removed (the 76 rules of
  `bootstrap-reboot.css`, removed by selector, so `h1, .h1` keeps `.h1`).
- `vars`: only Bootstrap's `:root` / `[data-bs-theme]` variable blocks.

For each variant it recorded 36 computed properties and the box size of
every rendered element. For each property that changed between `full` and
`noreboot`, it listed the Reboot rules that match the element and declare
that property. Coverage was 23 inspect screens and 7 scout screens, each in
light and dark:

- Inspect: the log list; for each of three logs, the samples list and the
  transcript, messages, scoring, metadata and info tabs; and the info,
  models, task and JSON tabs of one log.
- Scout: scans, a scan, a scan result, transcripts, a transcript, project
  and validation.

Counts below are summed over all screens and both themes.

| Reboot rule | Effect when removed |
| --- | --- |
| `*, ::before, ::after { box-sizing: border-box }` | 14,836 property diffs in inspect, 4,538 in scout |
| `body { margin; font-family; font-size; line-height; color; background-color }` | Inherited by everything: 13,560 font-family and 11,740 line-height diffs, and 10,868 changed element heights |
| `input, button, select, optgroup, textarea { margin: 0; font: inherit; line-height: inherit }` | Buttons fall back to the UA font size (13.33px) and `line-height: normal` |
| `button:not(:disabled), ... { cursor: pointer }`, `[role=button] { cursor: pointer }`, `button { -webkit-appearance: button }` | Buttons lose the pointer cursor |
| `p { margin: 0 0 1rem }` | A 12–14px top margin appears |
| `ol, ul, dl { margin-top: 0; margin-bottom: 1rem }`, `ol, ul { padding-left: 2rem }` | Breadcrumb and lists shift |
| `pre, code, kbd, samp`, `pre`, `code`, `pre code` font rules | Code falls back to UA `monospace` and 12.8px; `pre` gains a top margin; code inside `pre` gets the code colour |
| `thead, tbody, tfoot, tr, td, th { border: 0 solid; border-color: inherit }`, `table { border-collapse: collapse }` | Scout's transcript and result tables lose their row borders (2,826 diffs) |
| `h1`–`h6` | Scout's scan title (`h1`, `h2` in `ScanPanelTitle`) changes line height and colour |
| `a { color; text-decoration }` | Grid row links change colour |
| `img, svg { vertical-align: middle }` | Icons shift (38 diffs) |
| `dt`, `dd`, `hr` | Usage breakdown labels lose bold; `hr` colour and margins change |

Two TSX files set the `hidden` attribute
(`packages/inspect-components/src/theme/ThemeToggle.tsx`,
`packages/inspect-components/src/transcript/CommunicationEventView.tsx`).
Reboot's `[hidden] { display: none !important }` is what keeps them hidden
when a class sets `display`. Model output rendered as markdown or HTML can
also contain `blockquote`, `kbd`, `mark`, `sub`/`sup` and `dl`. None of the
measured logs exercised those, and nothing in the repo styles `blockquote`.

So the reset should be **all 76 Reboot rules, copied verbatim**, not a
selection. It is about 420 lines and costs nothing to keep.

Screens not covered: dialogs (#847 is rewriting them), running evals
(spinners), the scout pager, hover and focus states, the readable theme
variant (the default preference; the script forced plain light and dark),
VS Code itself, and hawk.

**What deleting Bootstrap does today.** The `vars` variant keeps the
variables but drops Reboot and the components. It renders the transcript in
a serif font. The tab strips become blue underlined links stacked
vertically, and the event nav pills become a bulleted list of UA buttons.
Keeping the variables alone isn't enough.

### Component and utility classes

Real uses after removing test names, CSS-module names and data strings:

| Classes | Files | Shared wrapper | Notes |
| --- | --- | --- | --- |
| `btn` | 15 | `ToolButton`, `ToolDropdownButton` (`packages/react`); `FindBandUI` buttons; `ExpandablePanel` more toggle | Other uses are inline in inspect title-view dialogs, `ColumnFilterEditor`, `ConnectionLogModal`, `MessageBand`, `DownloadButton`, `LogLocationGate` |
| `btn-primary`, `btn-secondary`, `btn-outline-primary` | 8 | none | Dialog footers (edit tags, metadata, annotations), `ResultsPanel`, `CollapsedTitleBar`, `DownloadButton`, `ColumnFilterEditor` |
| `nav`, `nav-pills`, `nav-tabs`, `nav-item`, `nav-link` | 5 | `TabSet`, `NavPills` (`packages/react`); `EventNavs`, `EventNav`, `EventNavsPicker` (`inspect-components`) | `TabSet` builds `nav-${type}`. Scout `TranscriptBody.module.css` restyles `:global(.nav)` |
| `tab-content`, `tab-pane` (+ `show`, `active`) | 3 | `TabSet`; `EventPanel` | `SampleDisplay` adds `tab-pane` directly |
| `form-control` | 4 | `AutogrowText` (one of four) | Inspect title-view dialogs |
| `form-select`, `form-select-sm` | 3 | none | `EditMetadataDialog`; scout `ScannerResultsFilter`, `ScannerResultsGroup` |
| `spinner-border` + `visually-hidden` | 5 | none | The same three-line pattern in `LogListFooter`, `RunningNoSamples`, `SampleFooter`, scout `Footer`, `EventProgressPanel` |
| `breadcrumb`, `breadcrumb-item` | 2 | inspect `Navbar`; `useBreadcrumbTruncation` | The hook creates a hidden `ol.breadcrumb` to measure item widths, so it depends on the breadcrumb CSS |
| `pagination`, `page-link` | 1 | scout `Pager` | |
| `navbar`, `navbar-brand`, `navbar-text` | 3 | inspect `TitleView`, `PrimaryBar`, `CollapsedTitleBar` | inspect_vscode's `view-overrides.css` also targets these names |
| `card`, `container`, `container-fluid` | 3 | `EventRow`, `EmptyPanel`, `SampleScoresView` | |
| Utilities: `sticky-top`, `mb-0`, `text-truncate`, `font-monospace`, `text-danger`, `text-secondary` | 1–2 each | | `text-truncate` is already redefined in `base.css`. Bootstrap's utilities are `!important` |

No TSX uses `badge`, `modal`, `accordion`, `table`, `progress`, `popover`,
`dropdown` or `alert` as a Bootstrap class. The raw grep counts for `card`,
`table`, `modal`, `navbar`, `progress` and `badge` come from test names,
CSS-module class names (`styles.modal`, `styles.card`) and data values
(`mode: "badge"`).

`base.css` still has about 150 lines for Bootstrap components that nothing
renders. These are `.modal*` (`Modal` renders only its CSS-module class),
`.accordion*`, `.card-header`, `table.table`, `.table`, the
`.collapse`/`.collapsing` accordion rules, and the `.popover*` rules that
#846 removes.

Measured on the same screens (`vars` diffs minus `noreboot` diffs), the
classes that change the most elements are `.nav-link` (3,857 property
diffs), `.btn` (1,308), `.nav-item`, `.breadcrumb-item`, `.nav`/`.nav-pills`,
the `.navbar-*` classes, `.font-monospace` and, in scout, `.form-select-sm`.

### Cascade order

Bootstrap doesn't load first. `main.tsx` imports modules that import
`packages/react` components before it imports `App.tsx`. In both the dev
server and a production build, about 250 CSS-module class selectors
(`AsyncGate`, `PulsingDots`, `AutocompleteInput`, `CopyButton`, `TabSet`,
...) come before Bootstrap in `index.css`. Bootstrap wins every
equal-specificity tie with those modules. The library build that hawk embeds
is different: its entry imports `App.tsx` first, so the modules come after
Bootstrap and win those ties. As a result, in the standalone apps:

- Some selectors double a class to out-specify Bootstrap, such as
  `:global(.btn).toolButton` (16 selectors in 7 files, plus 2
  `:global(.nav)` in scout).
- Some rules never apply. `TabSet.module.css` `.pillSmall
  { padding: 0.3rem }` loses to `.nav-link { padding: .5rem 1rem }`, so the
  tabs render with Bootstrap's padding.
- Some of the 166 `!important`s in our CSS (51 in `base.css`) exist for the
  same reason. I haven't classified them one by one.

Removing Bootstrap, or layering it, reverses these ties. The
[alternative](#alternative-keep-bootstrap-in-layer-bootstrap) section has
the measured result.

### Theme attribute

`data-bs-theme` on `<html>` is written by `setDocumentBaseScheme` in
`packages/theme/src/bootstrap.ts` and by both `index.html` files. It is
read by:

- 124 `:global([data-bs-theme="dark"])` selectors in 13 CSS modules, and 4
  more in `base.css` and `vscode.css`;
- `useResolvedIsDark` (a `MutationObserver` on the attribute) and an inspect
  e2e spec;
- **hawk** (`hawk/www`, checkout from 2026-09-13). Hawk also writes the
  attribute (`index.html`, `theme.ts`), observes it in `useIsDarkTheme`,
  keys its Tailwind `dark` custom variant on it, and styles ag-grid with it.

`setDocumentBaseScheme` also sets `style.colorScheme` on `<html>`.
`applyTheme` toggles `body.vscode-dark`, which turns on the
`--vscode-*` → `--bs-*` bridge in standalone dark. inspect_vscode's
`assets/www/view/view-overrides.css` reads `--bs-body-color`.

## Target design

### Files and load order

Four new files in `packages/theme`, imported by both `App.tsx` files and the
scout dataframe e2e fixture, where Bootstrap's import was. They load before
Prism and `base.css`:

```ts
import "@tsmono/theme/tokens";
import "@tsmono/theme/reset";
import "@tsmono/theme/components";
import "@tsmono/theme/utilities";
import "prismjs/themes/prism.css";
import "@tsmono/theme/base";
import "@tsmono/theme/vscode";
```

### Tokens

`tokens.css` defines every `--bs-*` name that we or Bootstrap's own rules
read, under the current names, with values copied from Bootstrap's light and
dark blocks. PR 5 dropped the 33 names that only Bootstrap's uncopied rules
read.
Colours use `light-dark()`:

```css
:root {
  --bs-body-bg: light-dark(#fff, #212529);
  --bs-body-color: light-dark(#212529, #dee2e6);
  --bs-border-color: light-dark(#dee2e6, #495057);
  --bs-border-width: 1px;
  --bs-font-monospace: SFMono-Regular, Menlo, Monaco, Consolas,
    "Liberation Mono", "Courier New", monospace;
  /* ... */
}
```

`light-dark()` picks a value from the element's `color-scheme`.
`setDocumentBaseScheme` already sets `color-scheme` on `<html>` before first
paint, in standalone and, once it can read the host's theme, in VS Code.
`vscode.css` also sets it from `data-bs-theme`. I checked in Chrome that a
custom property holding `light-dark()` resolves where it is used, against
that element's `color-scheme`. Nothing in the repo sets `color-scheme` below
`:root`. A future subtree that did would flip these tokens inside it.

The `-rgb` triplets (`--bs-body-color-rgb`, `--bs-primary-rgb`, ...; 22
references in 11 files) aren't colours, so `light-dark()` can't hold them.
They keep a `:root[data-bs-theme="dark"]` block, as in Bootstrap.

Replacing the triplets with `color-mix()` is a good change but not a
zero-diff one. The bridge and the readable variant re-point
`--bs-primary`, `--bs-secondary` and `--bs-body-color` but not their
triplets, so today those references use Bootstrap's values in VS Code,
standalone dark and the default readable theme. Do it as its own PR after
PR 5, with before and after screenshots.

The VS Code bridge, the readable variant and `base.css`'s own `:root`
values keep writing `--bs-*` names, so they don't change. Each context
resolves like this:

| Context | Today | After |
| --- | --- | --- |
| Standalone light | Bootstrap `:root` values, then `base.css` `:root`; bridge off | `tokens.css` light branch, then the same `base.css` |
| Standalone dark | Bootstrap dark block, then the bridge (`body.vscode-dark`) re-points about 30 names at `vscode.css`'s dark defaults | `tokens.css` dark branch, then the same bridge |
| VS Code webview | Bootstrap light or dark following the host, then the bridge with the host's `--vscode-*` values | `tokens.css` branch following the host, then the same bridge |

**Renaming to semantic names** (`--inspect-fg`, `--inspect-border`, ...) is
optional and belongs after removal. Do it as one codemod gated on a zero
computed-style diff, not with aliases. An alias declared on `:root`
(`--bs-body-color: var(--inspect-fg)`) resolves on `:root` and descendants
inherit the resolved value. The bridge overrides variables on `body`, so
everything still reading the alias would keep the `:root` value. I checked
this in Chrome.

### Reset

`reset.css` is Bootstrap 5.3.8's Reboot without the variable blocks: all 76
rules with the same selectors and declarations, only reformatted. Don't wrap
it in `:where()`. Reboot's `pre code { color: inherit }` beats
`code { color: ... }` only on specificity.

`reset.css` is in the `tsmono.reset` layer, below `tsmono.components`, so
component classes beat reset rules whatever their specificity. `base.css`
keeps its own `a` and `a:hover` colour rules in the same layer. Unlayered,
they would beat the layered `.nav-link` colours.

### Components and utilities

`components.css` owns the component classes under the **same global class
names**. It copies only the variants we use, with every state (hover,
active, focus-visible, disabled):

- `.btn`, `.btn-primary`, `.btn-secondary`, `.btn-outline-primary` (about
  120 lines). The VS Code overrides in `base.css` target these
  `--bs-btn-*` variables and keep working.
- `.nav`, `.nav-item`, `.nav-link`, `.nav-pills`, `.nav-tabs`,
  `.tab-content`, `.tab-pane` (about 80 lines).
- `.form-control`, `.form-select`, `.form-select-sm` (about 70 lines).
  Bootstrap sets the chevron image, `--bs-form-select-bg-img`, on
  `.form-select` itself and swaps it in `[data-bs-theme=dark] .form-select`.
  Copy both rules. A `:root` dark value would be hidden by the
  element-level light one.
- `.spinner-border` and its keyframes (about 20 lines).
- `.breadcrumb`, `.breadcrumb-item` (about 20 lines).
  `useBreadcrumbTruncation` keeps working because the class names don't
  change.
- `.pagination`, `.page-link` (about 40 lines, scout only).
- `.navbar`, `.navbar-brand`, `.navbar-text`, `.card`, `.container`,
  `.container-fluid` (about 40 lines).

`utilities.css` copies `.visually-hidden`, `.sticky-top`, `.mb-0`,
`.text-truncate`, `.font-monospace`, `.text-danger` and `.text-secondary`
with their `!important`. It stays unlayered in PR 5, so the utilities keep
exactly today's behaviour (see the layer results below).

Keeping class names means PRs 1–5 change no TSX. Moving a class into its
wrapper's CSS module can follow once Bootstrap is gone, where a wrapper
exists:

- `TabSet` and `NavPills` own every `nav-*` use except the `EventNav*`
  family and scout's `:global(.nav)` override.
- `ToolButton` and `ToolDropdownButton` own the tool buttons.
- The five spinners repeat one pattern. A `<Spinner label>` in
  `packages/react` would remove the inline `spinner-border` /
  `visually-hidden` pair.
- Dialog buttons and form controls have no wrapper. #847 rewrites `Modal`,
  which is the natural home for footer buttons.

### Hawk and other hosts

Copying Reboot keeps today's leak. In library builds, `lib/styles/index.css`
would apply `reset.css`'s element rules to the host page, as Bootstrap does
now.

Cascade layers make this worse in hawk. Hawk uses Tailwind v4
(`hawk/www/src/index.css`), which declares
`@layer theme, base, components, utilities` before our CSS loads. Our layer
names would join that order and land after Tailwind's `utilities`. Inside
the embedded viewer, `reset`'s `ul { padding-left }` and
`button { font: inherit }` would then beat our own `.nav`, `.breadcrumb`
and `.btn` rules.

So PR 5 names the layers under one namespace, `@layer tsmono.reset,
tsmono.components`, so they never merge with a host's layers. In hawk the
`tsmono` layer orders after Tailwind's, so our reset and components still
beat Tailwind's layered utilities, as unlayered Bootstrap did. I worked out
the hawk ordering from the layer rules. I didn't run it in hawk.

Hawk's own markup also shares class names with Bootstrap's utilities. Hawk
loads each viewer's stylesheet only on that viewer's routes (`EvalPage`,
`ScanPage`, lazy-loaded in `AppRouter.tsx`), so its list pages never had
Bootstrap. On the viewer routes, hawk's chrome (`EvalSetStatusBar`, the
artifact viewers, the loading, error and pending pages) uses Tailwind classes
such as `p-4`, `px-3`, `gap-3`, `mb-3`, `rounded` and `border`, which
Bootstrap also defines as `!important` utilities with different values
(`.p-4` is 1.5rem in Bootstrap and 1rem in Tailwind). After PR 5 Tailwind's
values apply there, except where the reset sets the same property on that
element: the `tsmono.reset` layer orders after Tailwind's `utilities`, so
`h2.mb-1` gets the reset's 0.5rem, `p.mt-1` and `ul.mt-2` get 0, and
`button.rounded` loses its radius. Bootstrap's `!important` utilities used
to hide this. PR 7 removes it by scoping the reset to the viewer. I found
this by reading hawk's source (checkout from 2026-09-13) and haven't
checked it in a running hawk.

VS Code hosts older than 1.104 inject their default webview styles
unlayered, so there they beat the layered reset and components (body font
size, `code`, link colours on tabs rendered as `<a>`). From 1.104 VS Code
wraps them in `@layer vscode-default`, which orders before ours. The viewer
ships with the inspect_ai package, so an extension minimum can't keep it off
older hosts. PR 5 accepts these differences on VS Code older than 1.104
(August 2025).

Model output can carry Bootstrap classes too. The HTML sanitizer keeps
`class` attributes and markdown renders with `html: true`, so a message
containing `<table class="table">` or `<span class="badge">` is styled by
Bootstrap before PR 5 and isn't after it.

Stopping the leak means scoping the reset to the viewer in library builds,
for example `@scope ([data-tsmono-viewer])` with `:scope` standing in for
`body`. That is a separate PR after PR 5, for three reasons:

- It needs a TSX change: nothing sets a viewer-root attribute today.
- Everything the viewer renders has to sit under that root. Today `Modal`,
  `PopOver`, `ToolDropdownButton`, `EventNavsPicker`, `AutocompleteInput`
  and scout's `ValidationSetSelector` portal into `document.body`, where a
  scoped reset wouldn't reach them. #846 and #847 are rewriting all six to
  render in place. Check that no portal is left once they merge.
- The library build needs its own entry for the scoped file, because both
  builds import CSS from the same `App.tsx`.

Also check `@scope` in each browser and in VS Code's Electron. I haven't
done that.

### Theme attribute

Keep `data-bs-theme`. Renaming it changes nothing a user can see and would
break hawk. If we want a neutral name later, write both attributes for a
release, move hawk and the 128 selectors over, then stop writing the old
one. `body.vscode-dark` and `data-theme-variant` stay as they are.

`packages/theme/src/bootstrap.ts` is named for bootstrapping the theme
before first paint, not for Bootstrap. It can keep its name.

## Sequencing

| PR | Change | Gate | Size |
| --- | --- | --- | --- |
| 1 | `tokens.css`; the variable completeness check; fix the five undefined names | `full` vs (Bootstrap without its variable blocks + `tokens.css`): zero diff. Two of the five fixes change rendering, listed in the PR | ~200 lines |
| 2 | `reset.css` | `full` vs (`noreboot` + `reset.css`): zero diff | ~420 lines |
| 3 | `components.css`, `utilities.css` | `full` vs (Bootstrap emptied + all four copies): zero diff, including forced hover, focus-visible and active states | ~760 lines (each component brings its `--bs-*-*` variables) |
| 4 | Delete the `base.css` rules for components nothing renders | `full` vs branch: zero diff | −150 lines |
| 5 | Delete the Bootstrap imports and the `bootstrap` / `@types/bootstrap` dependencies; put `reset.css` and `components.css` in `tsmono.*` layers | Every diff is listed in the PR and either accepted or fixed | ~30 lines + fixes |
| 6 | Remove the `:global(.btn)` doubling and the `!important`s that only beat Bootstrap, one file at a time | Zero diff per file | ~15 CSS modules |
| 7 (optional) | Scope the reset to the viewer root in library builds ([Hawk and other hosts](#hawk-and-other-hosts)) | Zero diff standalone; hawk's own pages lose Reboot | ~30 lines + a root attribute |

Loading the copy after full Bootstrap would always give zero diff, even
with rules missing, because Bootstrap would still supply them. That's why
the gates for PRs 1–3 compare against Bootstrap with the copied part
deleted. The experiment's `noreboot` variant is the model for PR 2.

The PR 5 diffs came from cascade order: rules that lost to Bootstrap started
to apply. At rest only TabSet's `.pillSmall` padding and NavPills' `.pill`
padding and font size would have changed the standalone rendering, and PR 5
deleted them. In the library build those two had applied, so hawk's small
tabs and pills grow to the standalone size. The others are hover, focus,
active and disabled styles where a module rule now beats `.btn:hover`,
`.btn:active`, `.nav-link:hover` or `.form-control:disabled`. PR 5 lists them
and keeps them.

### Verification

- **Computed-style comparison.** For PRs 1–3, a verify-log-viewer drive
  spec, `bootstrap-copies.spec.ts`, which PR 5 deleted along with Bootstrap.
  PRs 1 and 2 gated each copy separately. PR 3 emptied Bootstrap's
  stylesheet and compared the four copies alone against Bootstrap as
  shipped. PR 5 compared `main` and the branch in two dev servers instead,
  element by element, with screenshots, and PR 6 needs the same comparison.
  Both covered inspect and scout in light, dark and both readable variants,
  with `::before`/`::after` and forced `:hover`, `:focus`, `:focus-visible`
  and `:active` on interactive elements. Half the copied classes never
  render on those screens (dialog buttons and forms, spinners, pagination),
  so PR 3's spec also rendered a fixture page with markup for every copied
  class.
- **Variable completeness.** A check that every `var(--bs-*)` in the repo
  resolves to a name defined in a theme file or CSS module, or has a
  fallback. Three names Bootstrap reads but never defines
  (`--bs-body-text-align`, `--bs-nav-link-font-size`,
  `--bs-breadcrumb-font-size`) are the deliberate exceptions. It replaces
  Bootstrap as the source of truth, and it would have caught the five
  undefined names.
- **Screenshots.** Before and after, light and dark, for the inspect log
  list, samples list, transcript, messages, a scoring tab and a dialog, and
  for scout scans, a scan result, the transcripts list and a transcript. They
  go in the PR description, per the repository's PR rules.
- **VS Code.** For PRs 1 and 5, open the same logs in the inspect_vscode
  extension host with a light and a dark VS Code theme. These PRs change
  where token values come from and what the bridge sits on.
- **Gates.** `pnpm check`, `pnpm test` and `pnpm e2e`.
- **Hawk**, for PR 5. Link the built `lib/` into hawk (`hawk/www/README.md`
  explains how) and check both the embedded viewers and hawk's own pages.

### In-flight work

- #846 (native popovers) already removes the `.popover*` rules from
  `base.css`.
- #847 (native dialog) replaces `Modal`'s markup.
- #851 (Find highlights) adds `--inspect-find-*` tokens to `base.css` with
  the `:root[data-bs-theme="dark"]` pattern, which this plan keeps.

Start PR 1 after those three merge to avoid `base.css` conflicts. None of
them changes the plan.

## Size and risk

Six PRs, plus an optional seventh. PRs 2 and 3 are the largest, at about
420 and 760 lines, but nearly all of it is copied CSS. Implementation is a few days. Verification takes
as long again: two apps, two themes plus the readable variant, VS Code, and
hawk for PR 5.

| Risk | Likelihood | Mitigation |
| --- | --- | --- |
| A copied component misses a rule or state | Medium | PR 3's gate removes Bootstrap's version first, and covers hover and focus |
| PR 5's cascade-order flips change tab and button sizes | Certain, partly measured | Review each diff in PR 5 |
| Layer order in a host page (hawk) puts our reset above our components | High without namespacing | `tsmono.*` layer names; check in hawk |
| `@scope` support in VS Code's Electron or one browser | Unknown | Check before PR 7; without it the reset keeps leaking as it does today |
| `light-dark()` resolves differently in a subtree with its own `color-scheme` | Low: none today | Comment in `tokens.css` |
| VS Code theme regressions | Low–medium | The bridge doesn't change; check in a real VS Code host in PRs 1 and 5 |
| Conflicts with in-flight PRs | Avoidable | Start after #846, #847 and #851 merge |

What we gain:

- 31 KB less gzipped CSS per app, minus a few KB of copied CSS.
- One less dependency.
- With PR 7, no global element rules in host pages.
- The end of the equal-specificity ties behind the `:global(.btn)`
  doubling, dead rules like `.pillSmall`, and some `!important`s.

## Alternative: keep Bootstrap in `@layer bootstrap`

Wrap the import in a cascade layer so every unlayered rule of ours beats
Bootstrap. Then ban new direct use with lint: an ESLint rule on Bootstrap
class names in `className` strings, and a CSS rule against new `--bs-*`
component variables.

I measured this by wrapping the same stylesheet in
`@layer bootstrap { ... }`. **It is not zero-diff.**

- Inspect: 2,310 property diffs, all on tabs. Every `TabSet` tab shrinks
  (padding 8px 16px → 4.8px, height 33 → 26px), because `.pillSmall`
  starts applying.
- Scout: 234 diffs. Bootstrap's utilities are `!important`, and a layered
  `!important` beats an unlayered `!important`. The validation icon in the
  transcripts list (`text-secondary` plus a module colour) turns from green
  to grey.

Layering hits the same cascade-order flips as PR 5, so it's one PR plus
those fixes. It keeps the 31 KB, keeps Reboot leaking into hawk, and adds
the same layer-ordering question in hawk. It also leaves the `--bs-*`
component variables in place. It saves PRs 1–4 and nothing more. Removal
ends with CSS we own and nothing to ban, so I'd do that.

## Pre-existing bugs found while measuring

These are independent of the migration.

- Five names were referenced but defined nowhere, so each fell back to the
  property's initial or inherited value. PR 1 pointed MessageBand and
  ScanPanelTitle at the tokens they name (`--bs-danger-*`,
  `--bs-secondary-color`) and replaced the other three with the value they
  rendered as (`transparent`, `inherit`):
  - `--bs-body-background`: `base.css`, 3 uses (Bootstrap's name is
    `--bs-body-bg`).
  - `--bs-error-bg-subtle` and `--bs-error-text-emphasis`:
    `apps/inspect/src/components/MessageBand.module.css`.
  - `--bs-primary-color`: `SearchPanel.module.css` (5 uses) and
    `SearchScoutUnavailable.module.css`.
  - `--bs-secondary-text-color`:
    `apps/scout/src/app/scan/ScanPanelTitle.module.css` (2 uses).
- The VS Code dialog overrides in `base.css`
  (`body[class^="vscode-"] .modal { ... }`, `.modal .form-control`) never
  apply. `Modal` renders only its CSS-module class, not `.modal`. PR 4
  deletes them as dead. Restoring VS Code theming for dialogs is a
  separate fix in `Modal` (#847).
- `packages/react/src/components/TabSet.module.css`
  `.tab { color: "var(--bs-body-color)" }` is a quoted string, so the
  declaration is invalid and ignored.
- `TabSet.module.css` `.pillSmall` padding never applies (see
  [Cascade order](#cascade-order)).
