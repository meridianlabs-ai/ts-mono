// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import {
  ComponentIconProvider,
  ComponentIcons,
} from "@tsmono/react/components";

import {
  renderChatEmptyState,
  renderChatLiveIndicator,
} from "./ChatViewVirtualList";

// NoContentsPanel (used by the non-backfilling branches) reads icons via
// context, so tests need a provider even though this suite isn't about icons.
const icons: ComponentIcons = {
  chevronDown: "icon-chevron-down",
  chevronUp: "icon-chevron-up",
  clearText: "icon-clear-text",
  close: "icon-close",
  code: "icon-code",
  confirm: "icon-confirm",
  copy: "icon-copy",
  error: "icon-error",
  menu: "icon-menu",
  next: "icon-next",
  noSamples: "icon-no-samples",
  play: "icon-play",
  previous: "icon-previous",
  toggleRight: "icon-toggle-right",
};

const renderWithIcons = (ui: ReturnType<typeof renderChatEmptyState>) =>
  render(<ComponentIconProvider icons={icons}>{ui}</ComponentIconProvider>);

describe("renderChatEmptyState", () => {
  afterEach(() => cleanup());

  it("shows Loading messages while backfilling", () => {
    renderWithIcons(renderChatEmptyState({ running: true, backfilling: true }));
    expect(screen.getByText("Loading messages")).toBeDefined();
  });

  it("shows Waiting for messages when live and running", () => {
    renderWithIcons(
      renderChatEmptyState({ running: true, backfilling: false })
    );
    expect(screen.getByText("Waiting for messages")).toBeDefined();
  });

  it("shows No messages when not running", () => {
    renderWithIcons(
      renderChatEmptyState({ running: false, backfilling: false })
    );
    expect(screen.getByText("No messages")).toBeDefined();
  });
});

describe("renderChatLiveIndicator", () => {
  afterEach(() => cleanup());

  it("shows Loading messages while backfilling", () => {
    render(renderChatLiveIndicator(true));
    expect(screen.getByText("Loading messages")).toBeDefined();
  });

  it("shows the default generating label when not backfilling", () => {
    render(renderChatLiveIndicator(false));
    expect(screen.getByText("generating")).toBeDefined();
  });

  it("shows a custom generating label when not backfilling", () => {
    render(renderChatLiveIndicator(false, "running"));
    expect(screen.getByText("running")).toBeDefined();
  });
});
