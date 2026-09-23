// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ComponentNavigationProvider } from "@tsmono/react/components";
import { ComponentStateProvider } from "@tsmono/react/state";
import { makeStateHooks } from "@tsmono/react/testing";
import { Value } from "@tsmono/scout-components/scanner-result-detail";

import { ScanResultSummary } from "../types";

import { normalizeScanValue } from "./normalizeScanRow";

afterEach(cleanup);

describe("Value rendering of normalized mixed-scanner cells", () => {
  it.each<{
    raw: unknown;
    tag: ScanResultSummary["valueType"];
    text: string;
  }>([
    { raw: "1", tag: "number", text: "1.0" },
    { raw: "0.5", tag: "number", text: "0.5" },
    { raw: "n/a", tag: "number", text: "n/a" },
    { raw: "false", tag: "boolean", text: "false" },
    { raw: 3, tag: "string", text: "3.0" },
  ])("renders $raw under a $tag tag", async ({ raw, tag, text }) => {
    const { value, valueType } = await normalizeScanValue(raw, tag);
    const { container } = render(
      <ComponentStateProvider hooks={makeStateHooks()}>
        <ComponentNavigationProvider navigation={{ navigate: () => {} }}>
          <Value value={value} valueType={valueType} />
        </ComponentNavigationProvider>
      </ComponentStateProvider>
    );
    expect(container.textContent).toBe(text);
  });
});
