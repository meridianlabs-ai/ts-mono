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
- a probe image from a blocked origin that is _not_ blocked and reported (proof the policy is in force there);
- a read path that didn't run in its worker;
- MathJax without `mathjax.css`, unloaded media, no asciinema terminal, unstyled CodeMirror, or a sample filter that doesn't keep exactly the matching sample.

Separately, the run fails if any shipped script contains `new Function` or `eval(`. The page can't observe violations inside workers, and a bundle's workers run with no policy at all (see below), so this static check is what covers them.

## Running

The run is manual; it isn't wired into CI. You need:

- Chromium for Playwright: `pnpm exec playwright install chromium`.
- An inspect_ai checkout with host-side support (from `UKGovernmentBEIS/inspect_ai`, branch `brandly/view-csp` until it merges), installed in a venv.
- Optionally, an inspect_vscode checkout with the webview policy (from `meridianlabs-ai/inspect_vscode`, branch `brandly/strict-csp` until it merges), compiled with `pnpm compile-tests`.

```sh
export INSPECT_AI_PYTHON=~/code/inspect_ai/.venv/bin/python
export INSPECT_VSCODE_DIR=~/code/inspect_vscode   # optional

node scripts/csp-integration/run.mjs              # from apps/inspect
CSP_DIST=/path/to/dist node scripts/csp-integration/run.mjs
```

`serve_dist.py` points `inspect view` and `inspect view bundle` at a given dist in-process, so the checkout's committed `_view/dist` is never touched.

- **Ports:** `CSP_SERVER_PORT` (default 7690) and `CSP_STATIC_PORT` (default 8690). The run stops if something already answers on either.
- **Work files:** they go to a temp dir that's removed afterwards. Set `CSP_WORK_DIR` to keep them; its `logs/` is regenerated and its bundle overwritten on each run.

## Not covered

- **Violations inside workers.** Workers take their policy from their own response headers: under `inspect view` they get it, but a bundle on a static server that sends no headers runs them with no policy, since a meta policy doesn't govern them. The static `new Function`/`eval` scan above is the check for them.
- **A real VS Code window.** VS Code injects its own default styles and API script into every webview, and the emulation can't see them. Check a viewer in VS Code by hand after changing the policy.
- **Known in legacy mode:** the legacy extension policy has no `media-src`, so it blocks `data:` audio and video. That's today's behaviour, which the viewer policy fixes, and the legacy run expects it.
