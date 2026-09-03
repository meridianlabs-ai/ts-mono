# Flow files

Read-only syntax-highlighted display of an evaluation-set flow YAML file,
reachable from the collection views without leaving the current route family.

## Sub-features

- `flow-discovery` shows the Flow button when the current directory exposes an
  evaluation flow.
- `flow-render` loads `.yaml`/`.yml` as text and highlights it as YAML.
- `flow-navigation` keeps breadcrumbs and back/home behavior consistent in
  Logs and Samples route families.

## How to get to it (user POV)

- Browse a fixture directory with an eval-set flow and choose the Flow button
  in the navbar.
- Direct routes ending in `.yaml` or `.yml` render the flow panel from either
  `/logs/...` or `/samples/...`.

## Driving it with Playwright

- Preconditions: serve a directory whose eval-set response names a real flow
  file. The default rich-log fixtures may not provide one; skip with that
  explicit fixture gap rather than inventing a route.
- Click the visible Flow action and assert a known YAML key/value from the
  fixture inside `code.language-yml`.
- Assert the breadcrumb path and use back once. Repeat from the Samples route
  when both entry points are reachable.
- A highlighted `<span>` structure is implementation detail; the known source
  text and navigation result are the proof.

## Code landmarks

- Surface and route-family choice: `apps/inspect/src/app/flow/FlowPanel.tsx`.
- Fetching: `apps/inspect/src/app/flow/hooks.ts` and
  `apps/inspect/src/app/server/useEvalSet.ts`.
- Entry points: `apps/inspect/src/app/flow/FlowButton.tsx`,
  `apps/inspect/src/app/routing/RouteDispatcher.tsx`, and `SamplesRouter.tsx`.
- Syntax highlighting: `packages/react/src/hooks/usePrismHighlight.ts`.

## Gotchas

- The flow directory, not the YAML filename, keys eval-set discovery.
- The panel subscribes to listing sync so breadcrumb collections stay fresh;
  a loading/fetch storm belongs to `loading-live-refresh.md`, not Prism.
- A missing Flow button can mean the served directory has no eval-set
  metadata, not that the route is broken.
