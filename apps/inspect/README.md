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

Hosts that own navigation and data loading can render one sample's event
stream without mounting `<App />`. The components are props-pure: every
interactive control is driven by state the host holds and passes back in.
Omit an adapter and its control renders inert — no collapse chevrons
without `collapseState`, no lane/timeline switching without
`timeline.selection`/`timeline.active`, no marker clicks or `h`/`l`
cross-timeline navigation without the `eventId` loop below.

```tsx
import {
    initializeStore,
    InspectComponentProvider,
    TranscriptLayout,
    type Event,
    type Timeline,
} from "@meridianlabs/log-viewer";
import { useRef, useState } from "react";

import "@meridianlabs/log-viewer/styles/index.css";

// Once per page, before the first render. The components read viewer state
// through the same store <App /> uses; every capability can be off.
initializeStore({
    downloadFiles: false,
    downloadLogs: false,
    webWorkers: false,
    streamSamples: false,
});

export function Transcript({
    events,
    timelines,
}: {
    events: Event[];
    timelines?: Timeline[];
}) {
    const scrollRef = useRef<HTMLDivElement>(null);
    // Stays undefined until the first toggle so the viewer's default-collapsed
    // nodes apply; the layout seeds the full map on that toggle.
    const [collapsed, setCollapsed] = useState<Record<string, boolean>>();
    const [selected, setSelected] = useState<string | null>(null);
    const [activeIndex, setActiveIndex] = useState(0);
    // Event the layout asked to jump to (marker click, h/l lane navigation,
    // j/k turn navigation). Feeding it back through `deepLink` performs the
    // scroll and any cross-timeline switch — the standalone app keeps this
    // in `?event=`.
    const [eventId, setEventId] = useState<string | null>(null);

    return (
        // `navigate` receives `#/…` routes from citation links in rendered
        // markdown (ChatView `references`); ignore or map to your router.
        <InspectComponentProvider navigate={() => {}}>
            <div ref={scrollRef}>
                <TranscriptLayout
                    embedded
                    events={events}
                    listId="transcript"
                    scrollRef={scrollRef}
                    collapseState={{
                        transcript: collapsed,
                        onCollapseTranscript: (id, value) =>
                            setCollapsed((current) => ({
                                ...current,
                                [id]: value,
                            })),
                        onSetTranscriptCollapsed: setCollapsed,
                    }}
                    timeline={{
                        serverTimelines: timelines,
                        selection: {
                            selected,
                            onSelect: (key, options) => {
                                setSelected(key);
                                // A row click invalidates a pending jump;
                                // programmatic selections ask to keep it.
                                if (!options?.preserveDeepLink)
                                    setEventId(null);
                            },
                        },
                        active: { activeIndex, onActiveChange: setActiveIndex },
                        onMarkerNavigate: (id, key) => {
                            if (key) setSelected(key);
                            setEventId(id);
                        },
                    }}
                    deepLink={{ eventId }}
                    onNavigatedToEvent={setEventId}
                />
            </div>
        </InspectComponentProvider>
    );
}
```

Build `events` once where you load the sample, with `normalizeEvents(json)`
from the same package: it fills fields older inspect_ai versions omitted.
Never hand the layout raw JSON.

Keep both collapse setters: the layout uses `onSetTranscriptCollapsed` to seed
defaults on the first toggle and for bulk expand of deep-link targets, and
`onCollapseTranscript` for every toggle after that. Switching timelines
already clears the lane selection inside the layout; the host does not
repeat it.

For a plain messages view use `ChatView` under the same provider;
`displayMode="raw"` on the provider renders content unformatted.

### Embedder chrome

If your own UI (rendered as a sibling of `<App />`, not a descendant) calls
the viewer's selection hooks (`useSelectedSampleSummary`,
`useSelectedScores`, `useLogSelection`), wrap that chrome in
`<InspectQueryClientProvider>` so the hooks resolve the viewer's
react-query client, and gate it on `useViewerReady()` — the hooks throw
before the viewer's app config resolves.

See [src/index.ts](src/index.ts) for the full public surface.
