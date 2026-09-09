# Sample messages

The Messages tab of a sample detail: the conversation (system/user/
assistant/tool messages) rendered as chat, with markdown, images, and
tool-call formatting.

## Sub-features

- `messages-render` shows every message with its role and content.
- `messages-markdown` renders markdown/code content (not raw text).
- `messages-tools` folds tool calls/results into ordered blocks with rich input,
  output, error, and custom renderers.
- `messages-reasoning-citations` renders reasoning/redaction and reference
  labels without confusing them with assistant text.
- `messages-live` appends ordered messages for a running sample, shows
  loading/generating progress, and follows until terminal handoff.
- `messages-deeplink` `?message=<id>` scrolls to and highlights a message.
- `messages-search` uses the right rail in message scope and labels matches.

## How to get to it (user POV)

- Open a sample, then choose the `Messages` tab.
- Direct: `#/logs/<encodedLogPath>/samples/sample/<id>/<epoch>/messages`.

## Driving it with Playwright

Preconditions:

- Baseline launch; viewer-rich sample 1/epoch 1 as the target.

- **Panel renders.** `page.goto(url)` with the deep link above; the tab
  panel is the stable id `page.locator("#messages-contents")`.
- **Conversation content.** Within the panel,
  `panel.getByText("What is 2+2?")` (user) and
  `panel.getByText("The answer is 4.")` (assistant) are visible.
- **Tab switching.** From another tab,
  `page.getByRole("tab", { name: "Messages" }).click()` selects it
  (`aria-selected="true"`); the tab button's DOM id is the tab id.
- **Proof.** Screenshot the rendered conversation; assert both roles'
  fixture texts, not just one.

- **Rich content.** With a suitable fixture, assert tool name/input/output,
  markdown/code, reasoning, citation, and image behavior. See
  [Rendered content and media](./rendered-content-and-media.md).
- **Search/deep link.** Run [Transcript search and scans](./transcript-search-and-scans.md)
  in Messages scope, then reload a `?message=` link and assert the target below
  sticky chrome.

## Code landmarks

- Tab orchestration, toolbar, live flags, right rail:
  `apps/inspect/src/app/samples/SampleDisplay.tsx`.
- Message acquisition/ordering/export: `apps/inspect/src/log_data/sampleMessages.ts`,
  `messageRowsQuery.ts`, `messagesFromEvents.ts`, and `messagesExport.ts`.
- Conversation renderers: `packages/inspect-components/src/chat/`.
- Shared rich content/media: `packages/inspect-components/src/content/`,
  `packages/inspect-components/src/media/`, and markdown components in
  `packages/react/src/components/`.
- Regression coverage: `apps/inspect/e2e/chat-components.spec.ts`,
  `chat-virtualization.spec.ts`, `message-deeplink.spec.ts`, and colocated
  message/row tests.

## Gotchas

- The chat list's own DOM id embeds a visit counter
  (`sample-display-chat-<id>-<visitId>`) — never select by it; use
  `#messages-contents`.
- The message list is virtualized for long conversations; a message deep in
  the transcript may need `?message=<id>` or scrolling to enter the DOM.
- Images render as `img[src^='data:image']` — assert on that prefix when a
  fixture contains images (viewer-rich does in later samples).
- Running and chunked conversations are paged/assembled behind the same tab.
  The UI should not know which transport supplied a row.
- Message role alone does not identify a visible conversational row; tool rows
  can share role metadata. Match role and message kind/content together.
- Remote media is intentionally not fetched automatically. See
  `rendered-content-and-media.md` before treating a placeholder as broken.
