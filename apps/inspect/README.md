# Inspect Log Viewer

React app for viewing eval logs produced by
[Inspect AI](https://inspect.aisi.org.uk/). It runs standalone (served by
`inspect view`), against statically hosted log directories, inside the
Inspect VS Code extension, and can be embedded in external applications via
the [`@meridianlabs/log-viewer`](https://www.npmjs.com/package/@meridianlabs/log-viewer)
npm package.

For repo setup (corepack, pnpm, install), see the
[root README](../../README.md).

## Development

Run commands from this directory, or from the repo root with
`pnpm <command> --filter=@meridianlabs/log-viewer` (the root scripts pass the
filter through to `turbo run`, preserving task dependencies — see
[scripts.md](../../docs/scripts.md)):

| Command          | Description                               |
| ---------------- | ----------------------------------------- |
| `pnpm dev`       | Start the Vite dev server on :5173        |
| `pnpm build`     | Build the bundled app                     |
| `pnpm build:lib` | Build the embeddable library into `lib/`  |
| `pnpm test`      | Run unit/integration tests (vitest)       |
| `pnpm e2e`       | Run Playwright e2e tests                  |
| `pnpm check-all` | Type check, lint, format, test, and build |

Built output is not committed; the library is built at publish time
(`prepublishOnly`).

You may optionally set the `VIEW_SERVER_API_URL` environment variable at
build time to use an API server running on a different host.

## Embedding (`@meridianlabs/log-viewer`)

> **Versioning disclaimer**: this package does NOT use semantic versioning.
> The public surface evolves with the host application's needs — expect
> breaking changes in any release and adapt accordingly.

```bash
npm install @meridianlabs/log-viewer
```

The viewer requires its bundled CSS:

```typescript
import "@meridianlabs/log-viewer/styles/index.css";
```

### Example Usage

An embedder installs a per-dir API factory with `setApiFactory` **before**
initializing the store and rendering `<App />`. The viewer resolves the log
directory (from `initialLogDir` or a `?log_dir=` URL param), calls your
factory with it, and renders:

```tsx
import {
    App,
    clientApi,
    createViewServerApi,
    initializeStore,
    setApiFactory,
} from "@meridianlabs/log-viewer";
import type { Capabilities } from "@meridianlabs/log-viewer";

import "@meridianlabs/log-viewer/styles/index.css";

// Install the API factory first — installing after the backend has
// resolved throws.
setApiFactory(
    (logDir) =>
        clientApi(
            createViewServerApi({
                logDir,
                // Optional transport options: apiBaseUrl, headerProvider, customFetch
                apiBaseUrl: "https://mycompany.com/api",
            })
        ),
    "s3://my-bucket/logs" // initialLogDir; omit to require ?log_dir= in the URL
);

const capabilities: Capabilities = {
    downloadFiles: true,
    downloadLogs: false,
    webWorkers: true,
    streamSamples: false,
};
initializeStore(capabilities);

export function MyApp() {
    return <App />;
}
```

To re-point the viewer at a different log directory after boot, call
`setLogRoot(dir)` — it rebuilds the API through the same factory.

### Transcript-only embedding

Consumers that already own navigation and data loading can render a normalized Inspect event
stream without mounting the full viewer application:

```tsx
import {
    initializeStore,
    InspectComponentProvider,
    normalizeEvents,
    TranscriptLayout,
} from "@meridianlabs/log-viewer";
import { useRef } from "react";

import "@meridianlabs/log-viewer/styles/index.css";

initializeStore({
    downloadFiles: false,
    downloadLogs: false,
    webWorkers: false,
    streamSamples: false,
});

export function Transcript({ rawEvents }: { rawEvents: unknown }) {
    const scrollRef = useRef<HTMLDivElement>(null);
    return (
        <InspectComponentProvider
            navigate={(path) => window.location.assign(path)}
        >
            <div ref={scrollRef}>
                <TranscriptLayout
                    embedded
                    events={normalizeEvents(rawEvents)}
                    listId="transcript"
                    scrollRef={scrollRef}
                />
            </div>
        </InspectComponentProvider>
    );
}
```

`normalizeEvents` is the compatibility boundary for persisted evals; pass untrusted event JSON
through it before rendering. The same provider composes `ChatView` for the simpler messages view
and accepts `displayMode="raw"` for unformatted content. `TranscriptOutline`,
`TranscriptViewNodes`, `treeifyEvents`, and their public types are also exported for consumers that
need to compose the layout primitives directly.

### Embedder chrome

If your own UI (rendered as a sibling of `<App />`, not a descendant) calls
the viewer's selection hooks (`useSelectedSampleSummary`,
`useSelectedScores`, `useLogSelection`), wrap that chrome in
`<InspectQueryClientProvider>` so the hooks resolve the viewer's
react-query client, and gate it on `useViewerReady()` — the hooks throw
before the viewer's app config resolves.

See [src/index.ts](src/index.ts) for the full public surface.
