// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { JsonValue } from "@tsmono/inspect-common/types";
import {
  ComponentIconProvider,
  ComponentNavigationProvider,
} from "@tsmono/react/components";
import { ComponentStateProvider } from "@tsmono/react/state";
import { makeStateHooks, testIcons } from "@tsmono/react/testing";

import { ScoreValue } from "./ScoreValue";

const defaultScore = { first: "one", second: "two", third: "three" };

const renderScore = (
  expandable?: boolean,
  score: JsonValue = defaultScore,
  maxRows = 2
) =>
  render(
    <ComponentStateProvider hooks={makeStateHooks()}>
      <ComponentIconProvider icons={testIcons}>
        <ComponentNavigationProvider navigation={{ navigate: () => {} }}>
          <ScoreValue
            score={score}
            className={["score", "preview"]}
            maxRows={maxRows}
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

  it("counts nested groups toward the fixed-preview maxRows", () => {
    renderScore(
      false,
      { first: "one", details: { nested: "value" }, third: "three" },
      1
    );

    expect(screen.getByText("first")).toBeDefined();
    expect(screen.queryByText("details")).toBeNull();
    expect(screen.queryByText("nested")).toBeNull();
    expect(screen.queryByText("third")).toBeNull();
    expect(screen.queryByRole("button", { name: /more|less/i })).toBeNull();
  });
});
