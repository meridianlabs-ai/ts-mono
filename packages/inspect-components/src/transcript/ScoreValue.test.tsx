// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import {
  ComponentIconProvider,
  ComponentIcons,
  ComponentNavigationProvider,
} from "@tsmono/react/components";
import {
  ComponentStateHooks,
  ComponentStateProvider,
} from "@tsmono/react/state";

import { ScoreValue } from "./ScoreValue";

const icons: ComponentIcons = {
  arrowDown: "icon-arrow-down",
  arrowUp: "icon-arrow-up",
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

const stateHooks: ComponentStateHooks = {
  useValue: (_id, _prop, defaultValue) => defaultValue,
  useSetValue: () => () => {},
  useRemoveValue: () => () => {},
  useEntries: () => undefined,
  useRemoveAll: () => () => {},
  useRemoveByPrefix: () => () => {},
};

const renderScore = (expandable?: boolean) =>
  render(
    <ComponentStateProvider hooks={stateHooks}>
      <ComponentIconProvider icons={icons}>
        <ComponentNavigationProvider navigation={{ navigate: () => {} }}>
          <ScoreValue
            score={{ first: "one", second: "two", third: "three" }}
            className={["score", "preview"]}
            maxRows={2}
            expandable={expandable}
          />
        </ComponentNavigationProvider>
      </ComponentIconProvider>
    </ComponentStateProvider>
  );

afterEach(() => {
  cleanup();
});

describe("ScoreValue object rows", () => {
  it("expands rows beyond maxRows by default", () => {
    const { container } = renderScore();

    expect(container.firstElementChild?.classList.contains("score")).toBe(true);
    expect(container.firstElementChild?.classList.contains("preview")).toBe(
      true
    );
    expect(screen.getByText("first")).toBeDefined();
    expect(screen.getByText("second")).toBeDefined();
    expect(screen.queryByText("third")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /1 more/i }));

    expect(screen.getByText("third")).toBeDefined();
    expect(screen.getByRole("button", { name: /less/i })).toBeDefined();
  });

  it("renders a fixed preview when expandable is false", () => {
    renderScore(false);

    expect(screen.getByText("first")).toBeDefined();
    expect(screen.getByText("second")).toBeDefined();
    expect(screen.queryByText("third")).toBeNull();
    expect(screen.queryByRole("button", { name: /more|less/i })).toBeNull();
  });
});
