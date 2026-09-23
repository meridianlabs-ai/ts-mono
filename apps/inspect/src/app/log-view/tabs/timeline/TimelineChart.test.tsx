// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ComponentIconProvider } from "@tsmono/react/components";
import { testIcons } from "@tsmono/react/testing";

import { TimelineChart } from "./TimelineChart";
import type { TimeWindow } from "./timelineData";

afterEach(cleanup);

describe("invalid timeline window", () => {
  it.each<TimeWindow>([
    { start: 2 ** 57, end: 2 ** 57 + 64 },
    { start: -Infinity, end: 0 },
    { start: 0, end: Infinity },
    { start: NaN, end: 0 },
    { start: 0, end: NaN },
    { start: 1, end: 1 },
    { start: 2, end: 1 },
  ])("shows an explicit error for $start .. $end", (window) => {
    // No visible bands/measurement: the old implementation fails safely
    // without entering its non-terminating tick loop.
    render(
      <ComponentIconProvider icons={testIcons}>
        <TimelineChart
          window={window}
          showActiveSamples={false}
          showTerminations={false}
          connectionModels={[]}
          activeSeries={[]}
          samplesGuide={[]}
          terminationDots={[]}
          lanes={{}}
          retunes={{}}
          markers={[]}
          selectedMarker={null}
          onSelectMarker={() => {}}
        />
      </ComponentIconProvider>
    );
    expect(screen.getByText("Unable to display timeline")).toBeVisible();
    expect(screen.getByTestId("error-panel")).toHaveTextContent(
      "Invalid timeline"
    );
    expect(screen.getByTestId("error-panel")).not.toHaveTextContent(/\bat /);
  });
});
