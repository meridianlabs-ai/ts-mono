# Sample messages

The Messages tab of a sample detail: the conversation (system/user/
assistant/tool messages) rendered as chat, with markdown, images, and
tool-call formatting.

## Sub-features

- `messages-render` shows every message with its role and content.
- `messages-markdown` renders markdown/code content (not raw text).
- `messages-deeplink` `?message=<id>` scrolls to and highlights a message.

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

## Gotchas

- The chat list's own DOM id embeds a visit counter
  (`sample-display-chat-<id>-<visitId>`) — never select by it; use
  `#messages-contents`.
- The message list is virtualized for long conversations; a message deep in
  the transcript may need `?message=<id>` or scrolling to enter the DOM.
- Images render as `img[src^='data:image']` — assert on that prefix when a
  fixture contains images (viewer-rich does in later samples).
