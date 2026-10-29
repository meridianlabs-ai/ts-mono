// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, it } from "vitest";

import {
  createAppConfig,
  createScanResultData,
} from "../../test/objectFactories";

import { ScannerResultHeader } from "./ScannerResultHeader";

afterEach(cleanup);

// A transcript row whose input is still loading, failed to load, or is
// stored by reference: no input data, only the row's own columns.
const transcriptRow = createScanResultData({
  inputType: "transcript",
  transcriptTaskSet: "mirrorcode",
  transcriptModel: "openai/gpt-5",
});

const renderHeader = (collapsed: boolean) =>
  render(
    <ScannerResultHeader
      resultData={transcriptRow}
      appConfig={createAppConfig()}
      collapsed={collapsed}
    />
  );

describe("ScannerResultHeader without input data", () => {
  it("shows the transcript headings from the row", () => {
    renderHeader(false);
    screen.getByText("Model");
    screen.getByText("openai/gpt-5");
    screen.getByText("mirrorcode");
  });

  it("shows the collapsed transcript bar from the row", () => {
    renderHeader(true);
    screen.getByText("mirrorcode");
  });
});
