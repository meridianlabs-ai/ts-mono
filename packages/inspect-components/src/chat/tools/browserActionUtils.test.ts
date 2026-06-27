import { describe, expect, it } from "vitest";

import {
  buildSelfAnnotation,
  isBrowserScreenshot,
  isVisualBrowserAction,
} from "./browserActionUtils";

describe("isVisualBrowserAction", () => {
  it("is true for browser/computer visual actions", () => {
    expect(isVisualBrowserAction("browser", { action: "left_click" })).toBe(
      true
    );
    expect(isVisualBrowserAction("computer", { action: "scroll" })).toBe(true);
    expect(isVisualBrowserAction("computer", { action: "type" })).toBe(true);
  });

  it("is false for screenshots, non-browser tools, and missing actions", () => {
    expect(isVisualBrowserAction("browser", { action: "screenshot" })).toBe(
      false
    );
    expect(isVisualBrowserAction("bash", { action: "left_click" })).toBe(false);
    expect(isVisualBrowserAction("browser", {})).toBe(false);
  });
});

describe("isBrowserScreenshot", () => {
  it("is true only for a browser/computer screenshot action", () => {
    expect(isBrowserScreenshot("browser", { action: "screenshot" })).toBe(true);
    expect(isBrowserScreenshot("computer", { action: "screenshot" })).toBe(
      true
    );
    expect(isBrowserScreenshot("browser", { action: "left_click" })).toBe(
      false
    );
    expect(isBrowserScreenshot("bash", { action: "screenshot" })).toBe(false);
  });
});

describe("buildSelfAnnotation", () => {
  it("maps click coordinates", () => {
    expect(
      buildSelfAnnotation("browser", {
        action: "left_click",
        coordinate: [10, 20],
      })
    ).toEqual({
      action: "left_click",
      coordinate: [10, 20],
      text: undefined,
      scrollDirection: undefined,
    });
  });

  it("maps typed text and scroll direction", () => {
    expect(
      buildSelfAnnotation("computer", { action: "type", text: "hi" })
    ).toEqual({
      action: "type",
      coordinate: undefined,
      text: "hi",
      scrollDirection: undefined,
    });
    expect(
      buildSelfAnnotation("browser", {
        action: "scroll",
        coordinate: [1, 2],
        scroll_direction: "down",
      })
    ).toEqual({
      action: "scroll",
      coordinate: [1, 2],
      text: undefined,
      scrollDirection: "down",
    });
  });

  it("returns undefined for non-visual actions", () => {
    expect(
      buildSelfAnnotation("browser", { action: "screenshot" })
    ).toBeUndefined();
    expect(
      buildSelfAnnotation("bash", { action: "left_click" })
    ).toBeUndefined();
  });
});

describe("argument narrowing (malformed args)", () => {
  it("treats a non-string action as not a visual action", () => {
    expect(isVisualBrowserAction("browser", { action: 123 })).toBe(false);
    expect(buildSelfAnnotation("browser", { action: 123 })).toBeUndefined();
  });

  it("drops a coordinate that is not a finite [number, number] pair", () => {
    const expected = {
      action: "left_click",
      coordinate: undefined,
      text: undefined,
      scrollDirection: undefined,
    };
    expect(
      buildSelfAnnotation("browser", {
        action: "left_click",
        coordinate: "10,20",
      })
    ).toEqual(expected);
    expect(
      buildSelfAnnotation("browser", { action: "left_click", coordinate: [10] })
    ).toEqual(expected);
    expect(
      buildSelfAnnotation("browser", {
        action: "left_click",
        coordinate: ["10", "20"],
      })
    ).toEqual(expected);
    expect(
      buildSelfAnnotation("browser", {
        action: "left_click",
        coordinate: [Number.NaN, 20],
      })
    ).toEqual(expected);
  });

  it("drops a non-string text or scroll_direction", () => {
    expect(
      buildSelfAnnotation("computer", { action: "type", text: 123 })
    ).toEqual({
      action: "type",
      coordinate: undefined,
      text: undefined,
      scrollDirection: undefined,
    });
    expect(
      buildSelfAnnotation("browser", {
        action: "scroll",
        coordinate: [1, 2],
        scroll_direction: 5,
      })
    ).toEqual({
      action: "scroll",
      coordinate: [1, 2],
      text: undefined,
      scrollDirection: undefined,
    });
  });
});
