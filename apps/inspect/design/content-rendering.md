# Content rendering policy

Inspect renders model output richly: markdown, math, syntax highlighting,
ANSI, media and links. When a log's model output isn't trusted, the viewer
renders it as plain text instead, so a hostile model can't inject content,
scripts or requests into the page. The concern is model output; log structure
and application data render as they always have.

## Configuration

`trust_content: boolean | null` is set by a task's `ViewerConfig` (baked into
the log) and by `inspect view --no-trust-content` (the app config). Absent,
null and true trust; false and unrecognized values don't. A log's header that
hasn't loaded yet is untrusted.

Both settings are fixed while the viewer runs: a log's trust never changes,
and neither does the viewer's. Trust only changes in a mounted tree when the
user moves between logs.

## Providers

`ContentTrustProvider` maps trust to a `ContentRenderingPolicy`;
`ContentTrustCeilingProvider` caps everything below it. The app router sets
the ceiling from the app config and the trust of the selected log. Sample
views (sample display, event focus, print) use the log the selected sample
came from. Content outside any provider is untrusted. The flow panel belongs to the
log directory rather than a log, so it renders as trusted under the ceiling.

Sample summaries are taken only from the log they're requested for: the
listing keeps the previous log's rows as placeholder data during a switch,
and those must never be shown under the new log's trust.

Scout renders as trusted until it can tell which log a transcript came from.

## Permissions

`ContentRenderingPolicy` has one permission per rich renderer: markdown,
syntax highlighting, ANSI, media and links. Only the all-or-nothing policies
are configurable today, but each renderer checks the permission it needs, so
finer settings can follow:

- `MarkdownDiv` / `RenderedText` show the source text. Rendered markdown can
  carry links, media and highlighted code, so until the pipeline enforces
  those individually it requires every permission.
- `ANSIDisplay` shows escape sequences instead of interpreting them; the
  terminal player needs media and ANSI.
- `RequireMedia` replaces images, audio and video with a placeholder.
- `ExternalLink` and `MediaReference` render inert text with the destination.
- `usePrismHighlight` doesn't run; `ContentCode` renders the code as text.
- Custom tool views and registered content renderers can emit anything, so
  they require every permission.

The Raw/Rendered display mode is a preference, independent of permissions:
`forceRender` overrides the preference, never the policy.

Plain model output reveals hidden characters (`⟨U+202E⟩`) and isolates bidi
runs, so text can't disguise what it says. This applies to the plain paths
of the renderers above and to model-produced text shown directly (tool and
sandbox output, tool errors).

## Library loading

Prism, markdown-it, DOMPurify, MathJax, ansi-output and the asciinema player
load on demand, only when trusted content needs them, so an untrusted session
never fetches or runs them. The e2e suite checks that no such module is
requested for untrusted content.

## Lint

`tsmono/require-media-permission` requires media elements to sit inside
`RequireMedia`, confines `dangerouslySetInnerHTML` to `MarkdownDiv`, requires
highlightable `<code>` to use `ContentCode`, and flags an `<a>` with a
computed `href` outside the files that build links from application data
(`DYNAMIC_LINK_FILES`): log-derived destinations go through `ExternalLink`.
