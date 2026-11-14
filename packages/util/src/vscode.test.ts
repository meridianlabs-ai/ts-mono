// @vitest-environment jsdom
import { expect, it } from "vitest";

import { getVscodeApi } from "./vscode";

// Browsers expose an element as a window property named by its id, so log
// content with id="acquireVsCodeApi" (TeX's \cssId sets one) becomes a truthy
// global. Vitest's jsdom window doesn't pick up named properties, so the test
// defines one.
it("ignores an element that shadows acquireVsCodeApi", () => {
  Object.defineProperty(window, "acquireVsCodeApi", {
    value: document.createElement("span"),
    configurable: true,
  });

  expect(getVscodeApi()).toBeUndefined();
});
