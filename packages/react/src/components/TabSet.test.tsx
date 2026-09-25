// @vitest-environment jsdom
import {
  cleanup,
  createEvent,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import type { MouseEvent } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ComponentStateProvider } from "../state/ComponentStateContext";
import { makeStateHooks } from "../test";

import { TabPanel, TabSet } from "./TabSet";

afterEach(cleanup);

const renderTabs = (href?: string) => {
  // Records the selected tab's id (what LogView/SampleDisplay read) while the
  // event is live; React clears currentTarget after dispatch.
  const selectedIds: string[] = [];
  const onSelected = vi.fn((e: MouseEvent<HTMLElement>) => {
    selectedIds.push(e.currentTarget.id);
  });
  render(
    <ComponentStateProvider hooks={makeStateHooks()}>
      <TabSet id="tabs">
        <TabPanel id="one" title="One" selected onSelected={onSelected} />
        <TabPanel id="two" title="Two" onSelected={onSelected} href={href} />
      </TabSet>
    </ComponentStateProvider>
  );
  return {
    tab: screen.getByRole("tab", { name: "Two" }),
    onSelected,
    selectedIds,
  };
};

const click = (el: HTMLElement, init: MouseEventInit) => {
  const event = createEvent.click(el, init);
  fireEvent(el, event);
  return event.defaultPrevented;
};

describe("TabSet tab links", () => {
  it("renders a tab with an href as a link to it", () => {
    const { tab } = renderTabs("#/logs/a.eval/task");
    expect(tab.tagName).toBe("A");
    expect(tab.getAttribute("href")).toBe("#/logs/a.eval/task");
  });

  it("selects the tab in place on a plain click", () => {
    const { tab, selectedIds } = renderTabs("#/logs/a.eval/task");
    expect(click(tab, { button: 0 })).toBe(true);
    expect(selectedIds).toEqual(["two"]);
  });

  it("leaves cmd/ctrl-click to the browser", () => {
    const { tab, onSelected } = renderTabs("#/logs/a.eval/task");
    expect(click(tab, { button: 0, metaKey: true })).toBe(false);
    expect(click(tab, { button: 0, ctrlKey: true })).toBe(false);
    expect(onSelected).not.toHaveBeenCalled();
  });

  it("selects on Space like a button tab", () => {
    const { tab, onSelected } = renderTabs("#/logs/a.eval/task");
    fireEvent.keyDown(tab, { key: " " });
    expect(onSelected).toHaveBeenCalledOnce();
  });

  it("stays a button without an href", () => {
    const { tab } = renderTabs(undefined);
    expect(tab.tagName).toBe("BUTTON");
  });

  it("stays a button inside the VS Code webview", () => {
    document.body.setAttribute("data-vscode-theme-kind", "vscode-dark");
    try {
      expect(renderTabs("#/logs/a.eval/task").tab.tagName).toBe("BUTTON");
    } finally {
      document.body.removeAttribute("data-vscode-theme-kind");
    }
  });
});
