# Security Policy

## Reporting a vulnerability

Email **security@meridianlabs.ai**. Please do not open a public issue,
discussion, or pull request for a suspected vulnerability.

Include the version of `inspect_ai`, `inspect_scout`, the Inspect VS Code
extension, or `@meridianlabs/log-viewer` you tested, a description of what an
attacker could do, and steps to reproduce (a log file that triggers the
behaviour is ideal).

We acknowledge reports within 3 business days, say within 10 business days
whether we consider it a vulnerability, and aim to ship a fix within 30 days.
We do not run a bug bounty program.

## Supported versions

This repository ships as a built bundle inside the most recent releases of
`inspect_ai` and `inspect_scout` on PyPI, inside the Inspect VS Code
extension, and as the most recent `@meridianlabs/log-viewer` on npm. We fix
security issues in those and do not backport.

## Scope

This policy covers the code in this repository: the Inspect log viewer
(`apps/inspect`), the Scout viewer (`apps/scout`), and the shared
`@tsmono/*` packages. The Python view server, log format, sandboxes, and
eval runtime belong to [Inspect AI](https://github.com/UKGovernmentBEIS/inspect_ai)
and [Inspect Scout](https://github.com/meridianlabs-ai/inspect_scout); the
extension host and its proxy belong to
[inspect_vscode](https://github.com/meridianlabs-ai/inspect_vscode).

## Threat model and trust boundaries

This section says what the viewers treat as trusted and what they treat as
hostile. Security reports, scanner findings, and code reviews are judged
against it. The full model, with scored threats and evidence, is in
[THREAT_MODEL.md](THREAT_MODEL.md).

### The boundary is the content of a log

The viewers exist to display eval logs and Scout scans. Those files are
written by Inspect and Scout, which we trust, but they *contain* the output
of the model under test, the tools it called, the sandbox it ran in, and the
scanner models that judged it. That content is hostile by construction: a
model can emit anything, and an agent under test may emit tokens designed to
exploit whatever displays them later. Logs are also shared between people
and organizations, so a log opened on one machine may have been produced on
another.

So the line runs through the file. The *structure* of a well-formed log
(span trees, ids, score names, attachment ids, file layout) is trusted; if
it is wrong, a trust boundary upstream of this repository has already
failed. The *content* of every field that a model, tool, sandbox, or scanner
could have influenced is untrusted, whatever field it arrives in: message
text, tool arguments and results, metadata values, URLs, citations, media
references, JSON embedded in strings, state diffs, scanner explanations.

### Why the viewer origin matters

An attacker who gets script execution inside the viewer does not just deface
a page. The viewer runs in one of four places, and what a script in the
viewer origin can reach differs in each:

| Context | What the viewer origin can reach |
|---|---|
| `inspect view` in a browser | Every log the local server process can read (local disk as the user, S3/GCS/Azure), plus the server's edit, message, and delete endpoints, and for Scout the scan-launch and project-config endpoints. The server binds loopback by default and enforces a log-directory access policy; with `--authorization` set, that policy is off. |
| Static bundle | Only the logs published next to the bundle, on the host the user chose. |
| VS Code webview | Only what the extension's scoped proxy forwards: the panel's own log directory, with a fixed route allowlist. The extension treats this webview as untrusted and never gives it the server token. |
| Embedded via `@meridianlabs/log-viewer` | Whatever the embedding application's API grants the current user, with that user's credentials (cookies or headers the embedder supplies). |

Severity is judged by the worst of these that a finding reaches. Script
execution or a forged request against the view server's write endpoints is
the top of the scale.

### Trusted inputs

Defects in handling these are correctness or robustness bugs, fixed when
they break legitimate use, not vulnerabilities:

- The process serving the viewer: the `inspect view` server, the static host
  the user pointed at, the VS Code extension host, or the embedding
  application and its API. Whoever controls it already controls the logs
  the viewer displays and the machine or account the viewer acts for.
- The structure of well-formed log and scan files, as above.
- The user's own actions in the viewer UI.
- The build: this repository's source, `pnpm-lock.yaml`, and the resolved
  dependency set. The supply-chain controls that protect them (release soak,
  disabled postinstall scripts, frozen lockfile, advisory overrides) are
  security surface; the resolved packages themselves are trusted once
  installed.
- Persisted client state (localStorage, IndexedDB, VS Code webview state) is
  written only by the viewer's own origin. We still validate it on read as
  hardening, because an earlier compromise or a stale schema can leave it
  malformed, but a finding that requires having already written to it
  requires script execution first.

### Untrusted inputs

These are treated as hostile and are where security findings live:

- **Log and scan content**, every field a model, tool, sandbox, or scanner
  could influence, in every renderer: markdown, HTML, MathJax, ANSI, state
  diffs, tool output, citations, web-search results, media, attachments,
  metadata, and score explanations.
- **The URL**: query parameters (`log_dir`, `log_file`, `inspect_server`,
  `mode`), the hash route, and share links. Any web page can send a user to
  a viewer URL.
- **Window messages.** `postMessage` from another window or frame. In a
  browser, any page that opened or framed the viewer can send them.
- **Embedded configuration blocks** (`log_dir_context`,
  `inspect-host-capabilities` script tags) on hosted pages, since the page
  may be served from a static host.
- **Files the viewer downloads on the user's behalf**: the name, extension,
  and bytes come from log content.

### Invariants that reviews protect

A change that weakens one of these is a security change and is reviewed as
one:

- All HTML that reaches the DOM passes through `sanitizeRenderedHtml`
  (`packages/react/src/components/renderedHtmlSanitizer.ts`). There is no
  second sanitizer and no unsanitized `dangerouslySetInnerHTML`.
- Every `href` and `src` derived from log content is scheme-checked
  (`http`/`https`, or a validated raster `data:` image) and opened with
  `rel="noopener noreferrer"`. Remote media is never fetched automatically.
- Log-authored strings are never used as keys on a plain object. Use `Map`
  or the null-prototype helpers in `@tsmono/util`.
- The viewer never holds a view-server auth token. Embedders supply
  credentials through `headerProvider`/`customFetch`; the VS Code webview
  goes through the extension's scoped proxy.
- Mutating requests carry the `X-Inspect-View-Request` header. Never add a
  write path that omits it.
- Parsed log data is normalized at the boundary
  (`@tsmono/inspect-common/normalize`), and persisted state is
  type-checked on read.
- CI workflows that hold a write token or a machine PAT never check out or
  execute fork code, and their gating lives in
  `meridianlabs-ai/agents`.

### Out of scope

- A hostile view server, static host, extension host, or embedding
  application. These hold a trusted position.
- Attacks that require a malformed log structure from a compromised Inspect
  or Scout installation. Report those to the producing project.
- Denial of service through the *size* of well-formed content. Inspect caps
  tool output and providers cap model output, so a single item cannot be
  arbitrarily large. A single small item that crashes or hangs the whole
  viewer is a bug we do fix, and we prioritize it, but it is not an
  advisory.
- Vulnerabilities in third-party dependencies. Report them to that project;
  tell us if this repository needs a version pin.
- Development-only tooling: the Vite dev server and its loopback origin
  rewrite, Storybook, benchmarks, and anything not shipped in `dist`.
- Reports produced mainly by an automated tool or a language model with no
  demonstrated path from an untrusted input to a sink. We triage these with
  the questions below and file them as bugs or close them.

### How to triage a finding

1. **Does the attacker already hold a trusted position?** Controls the
   server, the host machine, the embedding app, or the Inspect install?
   Then it is a robustness or correctness bug. Fix it when it breaks
   legitimate use; rank it below any untrusted-input finding.
2. **Does untrusted content reach a sink?** Log content, a URL parameter,
   a window message, or a download name reaching the DOM as HTML, an `href`
   or `src`, an object key, a fetch URL, a file name, or a request to the
   view server. If yes, it is a security finding. Its severity is set by the
   deployment table above: what the viewer origin can reach where the sink
   lives.
3. **Would the mitigation cost legitimate use?** A control that only
   defends against a trusted party is not worth a worse viewer. One that
   costs nothing may stay as hardening. Prefer controls that close the
   class (a sanitizer chokepoint, a URL-policy helper, a null-prototype
   record, a CSP) over patches for one instance.

## Disclosure

We publish fixes as a GitHub security advisory on the affected release
repository and credit reporters by name unless asked not to. Please keep
details private until the advisory is published.
