# Content rendering policy

Inspect treats log structure as application data, but model and tool payloads
may be hostile. Rendering permission applies to content throughout the viewer,
including summaries, metadata, provider tools, print views and JSON views.

## Configuration and source ownership

The public configuration remains `trust_content: boolean | null` in both the
application configuration and a task's `ViewerConfig`. Each setting maps to
`richContentPolicy` or `plainContentPolicy`. The effective policy intersects the
application ceiling with the policy of the log that owns the displayed content.
A task cannot raise an application restriction.

The application ceiling is inherited and nested ceilings only restrict it.
Source providers identify the current payload's owner and replace an ambient
source scope. Grid rows can belong to different logs; samples retained during
navigation must keep their source identity. The selected log alone is not enough
to identify those payloads. Content without a source policy defaults to plain.

An unloaded header is untrusted. Once loaded, absent, null and true retain the
legacy rendering default; false and unrecognized values deny rich rendering.
This feature assumes a log's policy remains stable for its identity. Replacing a
file in place with different trust is outside this contract; no session header
verification or fetching mechanism is part of rendering policy.

## Permissions and preferences

`ContentRenderingPolicy` has separate permissions for markdown, math, syntax
highlighting, ANSI, media, content links and specialized data formatting. These
are internal permissions; this change does not expose new granular settings.

Coarse trust providers map configuration to policies; renderers read specific
permissions. `RequireMedia` checks media, and `useHasAllContentPermissions`
checks the full policy for arbitrary callbacks.

Raw/Rendered is a display preference, independent of the permissions. Rendering
components can request an operation but cannot grant it. `forceRender` overrides
the preference, never permission. Allowing math alone does not cause markdown to
run. A markdown-without-math policy uses markdown without loading MathJax or
rewriting TeX source for MathJax.

## Payload dispatch and application controls

Payload dispatchers choose an ordinary value renderer before optional parsing
or specialization when formatted data is disallowed. Strings remain strings,
including JSON-shaped strings with duplicate keys and whitespace. Already
structured records and arrays remain inspectable, with all fields retained.
Plain text reveals hidden characters and isolates bidi runs. Known media gets a
placeholder; unknown content types keep the existing console diagnostic.

`RenderedContent`, message formatting, content-data views, client tool input
extraction and provider tool dispatch use this decision. Provider tools choose the original arguments and
result before parsing or selecting stdout, stderr and exit-code fields.
Arbitrary custom renderers, including their probes, require the full rendering
policy until they adopt a policy-aware contract. Reference preview callbacks
follow the same rule, and open previews disappear immediately on restriction.
Timeline construction retains source results and defers tool formatting until
the card renders. Terminal recordings require both media and ANSI permissions.

Metadata grids accept application-owned `cells` separately from their values.
Controls such as tag editing and timeline navigation remain usable under plain
policy. Cells rendering log-derived text or destinations must use the shared
text and link components. `_html` is an ordinary data key, not a renderer escape.

## Rendering components

Markdown, links, ANSI, media and syntax highlighting enforce their own specific
permission. The markdown pipeline receives the same policy: parser instances and
rendered HTML caches include it in their keys. Changing policy remounts the HTML
renderer immediately, so narrower permissions cannot inherit previous HTML.

All generated HTML, including reference post-processing and MathJax output,
passes through `sanitizeRenderedHtml`. Sanitizer hooks use immutable policies on
separate cached instances; no current-policy global is changed during rendering.
Denied links and media cannot be reintroduced by HTML post-processing. Existing
URL and style restrictions still apply to permitted rendering.

## Verification

Tests exercise both ceilings, loading and source transitions, duplicate-key
strings, provider payload preservation, custom renderer exclusion, UI cells,
library loading, markdown without MathJax, post-processing, and transitions
between cached rich and restricted output. Browser tests include trusted positive
controls and observe transient rendering as well as the settled DOM.
