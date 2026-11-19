# Security Policy

## Reporting a vulnerability

Please report suspected security vulnerabilities privately using GitHub's
[private vulnerability reporting](https://github.com/meridianlabs-ai/ts-mono/security/advisories/new)
for this repository ("Security" tab → "Report a vulnerability").

Please do **not** report security vulnerabilities through public GitHub
issues, discussions, or pull requests.

When reporting, please include:

- A description of the issue and what an attacker could do with it
- Steps to reproduce (a log file that triggers the behaviour is ideal)
- The version of `inspect_ai`, `inspect_scout`, the Inspect VS Code
  extension, or `@meridianlabs/log-viewer` you tested, and your browser

We will acknowledge reports within 5 business days and keep you informed as
we work on a fix. We ask that you give us a reasonable opportunity to address
the issue before any public disclosure. We do not run a bug bounty program.

## Supported versions

This repository ships as a built bundle inside the most recent releases of
`inspect_ai` and `inspect_scout` on PyPI (which the Inspect VS Code extension
displays from the installed package), and as the most recent
`@meridianlabs/log-viewer` on npm. We fix security issues in those and do not
backport.

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
against it.

### Log and scan files are untrusted

The viewers exist to display eval logs and Scout scans. Two things make
those files hostile input.

First, their content is the output of the model under test, the tools it
called, the sandbox it ran in, and the scanner models that judged it. A
model can emit anything, and an agent under test may emit tokens designed to
exploit whatever displays them later. That covers every field a model, tool,
sandbox, or scanner could influence: message text, tool arguments and
results, metadata values, URLs, citations, media references, JSON embedded
in strings, state diffs, scanner explanations.

Second, the file itself may not come from Inspect or Scout. Researchers pass
log files to each other, and the viewer can be pointed at a directory or
bucket that other people write to, so a file can be truncated, written by an
old version, edited by hand, or crafted by an attacker without the viewer's
user knowing it is there.

So no part of a file is trusted, structure included. No field of any file
(ids, span trees, score names, attachment ids, keys, file layout, or content)
may lead to script execution, an unintended request, a write to the view
server, or a change to state outside that file's own view.

### Malformed files

A malformed file must never exploit the viewer, as above. It also must not
take down the rest of the viewer: list views (the log list, the sample list,
Scout's scan list) keep working and show the bad file as an error. A
malformed file that crashes or hangs only its own log, sample, or scan view
is an ordinary bug. Neither kind of crash is a vulnerability.

### Why the viewer origin matters

An attacker who gets script execution inside the viewer does not just deface
a page. The viewer runs in one of four places, and what a script in the
viewer origin can reach differs in each:

| Context | What the viewer origin can reach |
|---|---|
| `inspect view` in a browser | Every log the local server process can read (local disk as the user, S3/GCS/Azure), plus the server's edit, message, and delete endpoints, and for Scout the scan-launch and project-config endpoints. The server binds loopback by default and limits reads to the log directory. The token-authorized mode used by the VS Code extension lifts that limit, because the extension confines requests itself (see the VS Code row). |
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
- The user's own actions in the viewer UI.
- The build: this repository's source, `pnpm-lock.yaml`, and the resolved
  dependency set. The supply-chain controls that protect them (release soak,
  disabled postinstall scripts, frozen lockfile, advisory overrides) are
  security surface; the resolved packages themselves are trusted once
  installed.
- Embedded configuration blocks (`log_dir_context`,
  `inspect-host-capabilities` script tags), written by whoever publishes
  the bundle or by the VS Code extension host.
- Persisted client state (localStorage, IndexedDB, VS Code webview state),
  written only by the viewer's own origin. A finding that requires having
  already written to it requires script execution first.

### Untrusted inputs

These are treated as hostile and are where security findings live:

- **Log and scan files**, every byte, as above, in every renderer and parser:
  zip, zstd, JSON and Arrow decoding, markdown, HTML, MathJax, ANSI, state
  diffs, tool output, citations, web-search results, media, attachments,
  metadata, and score explanations.
- **The URL**: query parameters (`log_dir`, `log_file`, `inspect_server`,
  `mode`), the hash route, and share links. Any web page can send a user to
  a viewer URL.
- **Window messages.** The viewers listen for `postMessage` only inside the
  VS Code webview. A listener added outside VS Code must check the sender,
  since any page that opens or frames the viewer can post to it.
- **Files the viewer downloads on the user's behalf**: the name, extension,
  and bytes come from log content.

### Invariants that reviews protect

A change that weakens one of these is a security change and is reviewed as
one:

- All HTML that reaches the DOM passes through `sanitizeRenderedHtml`
  (`packages/react/src/components/renderedHtmlSanitizer.ts`). There is no
  second sanitizer and no unsanitized `dangerouslySetInnerHTML`.
- Every `href` and `src` derived from log content passes a scheme check that
  rejects `javascript:`, `vbscript:` and `data:` URLs (inline images allow
  only validated base64 raster `data:` URLs), and every link that opens a new
  tab carries `rel="noopener noreferrer"`. Remote media is never fetched
  automatically.
- Code that keys a collection by a string from a log or scan file uses `Map`
  or the null-prototype helpers in `@tsmono/util` (`getOwn`,
  `nullProtoRecord`), not a plain object.
- The viewer never stores a view-server auth token. Embedders supply
  credentials per request through `headerProvider`/`customFetch`; the VS Code
  webview goes through the extension's scoped proxy and never sees the
  token.
- Mutating requests to the Inspect view server carry the
  `X-Inspect-View-Request` header. Never add a write path that omits it.
- Parsed log data is normalized at the boundary
  (`@tsmono/inspect-common/normalize`).
- List views isolate per-file failures. A file that fails to read, parse,
  or normalize shows as an error and does not stop the other files from
  loading.
- CI workflows that hold a write token or a machine PAT never check out or
  execute fork code.

### Out of scope

- A hostile view server, static host, extension host, or embedding
  application. These hold a trusted position.
- Crashes, hangs, and slowdowns. These are bugs, ranked as described under
  "Malformed files", not advisories.
- Vulnerabilities in third-party dependencies. Report them to that project;
  tell us if this repository needs a version pin.
- Development-only tooling: the Vite dev server, Storybook, benchmarks, and anything not shipped in `dist`.
- Reports produced mainly by an automated tool or a language model with no
  demonstrated path from an untrusted input to a sink. We triage these with
  the questions below and file them as bugs or close them.

### How to triage a finding

1. **Does the attacker already hold a trusted position?** Controls the
   server, the host machine, or the embedding app? Then it is a robustness
   or correctness bug. Fix it when it breaks legitimate use; rank it below
   any untrusted-input finding.
2. **Does untrusted input reach a sink?** Anything in a log or scan file, a
   URL parameter, a window message, or a download name reaching the DOM as
   HTML, an `href` or `src`, an object key, a fetch URL, a file name, or a
   request to the view server. If yes, it is a security finding. Its
   severity is set by the deployment table above: what the viewer origin
   can reach where the sink lives.
3. **Is it a crash or hang?** If it takes down a list view or the whole
   viewer, fix it with priority. If it stays inside the view of the file
   that caused it, it is an ordinary bug.
4. **Would the mitigation cost legitimate use?** A control that only
   defends against a trusted party is not worth a worse viewer. One that
   costs nothing may stay as hardening. Prefer controls that close the
   class (a sanitizer chokepoint, a URL-policy helper, a null-prototype
   record, a CSP) over patches for one instance.

## Disclosure

We publish fixes as a GitHub security advisory on the affected release
repository and credit reporters by name unless asked not to. Please keep
details private until the advisory is published.
