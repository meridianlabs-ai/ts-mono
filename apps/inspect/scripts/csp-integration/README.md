# CSP integration check

The viewer's Content-Security-Policy is built here (`dist/content-security-policy.json`), but it only takes effect once a host delivers it:

| Host                  | How the policy is delivered                                                                        | Where                                     |
| --------------------- | -------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| `inspect view`        | `Content-Security-Policy` header on every response, plus `frame-ancestors 'none'`                  | inspect_ai, `_view/network.py`            |
| `inspect view bundle` | `<meta http-equiv>` as the first child of `<head>`                                                 | inspect_ai, `log/_bundle.py`              |
| VS Code webview       | translated: `'self'` gains the webview's `cspSource`, `script-src` its nonce, `worker-src` `blob:` | inspect_vscode, `src/core/webview-csp.ts` |

A host that doesn't know the file (an older inspect_ai or extension) keeps its old behaviour, so the pieces can land in any order.

`run.mjs` checks all of them together in Chromium:

1. It builds this viewer, or takes `CSP_DIST`.
2. It writes fixture logs with a real mockllm eval (`make_logs.py`). They contain MathJax, `data:` image, audio and video, a human-baseline terminal session, and a sample large enough for the JSON worker and both decompression workers, in zstd, DEFLATE and JSON form.
3. It serves them through `inspect view`, then through `inspect view bundle` on a plain static server.
4. With `INSPECT_VSCODE_DIR` set, it also renders the page with the extension's own `renderWebviewHtml`. Assets are on a separate CDN-like origin, as in VS Code, and a stub host answers the viewer's `http_request` proxy from the same `inspect view` server. That runs once with the viewer's policy and once with the legacy policy of older extensions.

Each host fails on:

- any CSP violation or CSP console error;
- any request that leaves its origins;
- a read path that didn't run in its worker;
- MathJax without `mathjax.css`, unloaded media, no asciinema terminal, unstyled CodeMirror, or a sample filter that doesn't filter.

## Running

```sh
# inspect_ai checkout with the host-side support, and its venv
export INSPECT_AI_PYTHON=~/code/inspect_ai/.venv/bin/python
# optional: inspect_vscode checkout, compiled with `pnpm compile-tests`
export INSPECT_VSCODE_DIR=~/code/inspect_vscode

node scripts/csp-integration/run.mjs         # from apps/inspect
CSP_DIST=/path/to/dist node scripts/csp-integration/run.mjs
```

`serve_dist.py` points `inspect view` and `inspect view bundle` at a given dist in-process, so the checkout's committed `_view/dist` is never touched. Ports default to 7690 and 8690 (`CSP_SERVER_PORT`, `CSP_STATIC_PORT`). Work files go to a temp dir (`CSP_WORK_DIR`).

## Not covered

- **A real VS Code window.** VS Code injects its own default styles and API script into every webview, and the emulation can't see them. Check a viewer in VS Code by hand after changing the policy.
- **Known in legacy mode:** the legacy extension policy has no `media-src`, so it blocks `data:` audio and video. That's today's behaviour, which the viewer policy fixes, and the legacy run expects it.
