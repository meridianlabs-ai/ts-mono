import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SampleRouteSelectionController } from "./SampleRouteSelectionController";

const routeParams = vi.hoisted(() => ({
  samplesPath: "run.eval",
  sampleId: "sample-1",
  epoch: "1",
  tabId: undefined,
}));

vi.mock("../url", () => ({
  useSamplesRouteParams: () => routeParams,
}));

const selectLogFile = vi.hoisted(() => vi.fn());
const selectSample = vi.hoisted(() => vi.fn());
vi.mock("../../../state/actions", () => ({ selectLogFile, selectSample }));

vi.mock("../../../state/store", () => ({
  useStore: (selector: (state: unknown) => unknown) =>
    selector({ logs: { selectedLogFile: undefined } }),
}));

beforeEach(() => {
  selectLogFile.mockReset();
  selectSample.mockReset();
  routeParams.epoch = "1";
});

describe("SampleRouteSelectionController", () => {
  it("selects a sample when the route epoch is numeric", () => {
    render(<SampleRouteSelectionController />);

    expect(selectLogFile).toHaveBeenCalledWith("run.eval");
    expect(selectSample).toHaveBeenCalledWith("sample-1", 1, "run.eval");
  });

  it("does not store a sample handle for a malformed route epoch", () => {
    routeParams.epoch = "abc";

    render(<SampleRouteSelectionController />);

    expect(selectLogFile).toHaveBeenCalledWith("run.eval");
    expect(selectSample).not.toHaveBeenCalled();
  });
});
