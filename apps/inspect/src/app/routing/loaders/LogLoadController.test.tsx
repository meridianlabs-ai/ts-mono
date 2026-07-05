import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { LogDetails } from "../../../client/api/types";

import { LogLoadController } from "./LogLoadController";

// The controller's settle signal is `details_settled_seq`, not `detail.data`
// identity — a running log's details cache entry also receives poll-tick
// merges, which must not re-run the settle effect. Mock the log_data hooks so
// the two signals (data identity, settled seq) can be driven independently.
const useLogDetail = vi.hoisted(() => vi.fn());
const resolveLogKey = vi.hoisted(() => vi.fn());
const useLogFetchState = vi.hoisted(() => vi.fn());
vi.mock("../../../log_data", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../log_data")>()),
  useLogDetail,
  resolveLogKey,
  useLogFetchState,
}));

vi.mock("../../../app_config", () => ({
  useLogDir: () => "/logs",
}));

const setLoadedLog = vi.hoisted(() => vi.fn());
const clearSelectedScores = vi.hoisted(() => vi.fn());
const setWorkspaceTab = vi.hoisted(() => vi.fn());
vi.mock("../../../state/store", () => ({
  useStore: (selector: (state: unknown) => unknown) =>
    selector({
      logs: { selectedLogFile: "run.eval" },
      logActions: { setLoadedLog, clearSelectedScores },
      appActions: { setWorkspaceTab },
    }),
}));

const makeDetails = (n: number): LogDetails =>
  ({
    version: 2,
    status: "started",
    eval: { eval_id: `e${n}`, run_id: `r${n}`, task: "t", model: "m" },
    sampleSummaries: [],
  }) as unknown as LogDetails;

beforeEach(() => {
  setLoadedLog.mockReset();
  clearSelectedScores.mockReset();
  setWorkspaceTab.mockReset();
  useLogDetail.mockReset();
  resolveLogKey.mockReset();
  resolveLogKey.mockReturnValue("run.eval");
  useLogFetchState.mockReset();
});

describe("LogLoadController", () => {
  it("refires the settle effect on a settled-seq bump, not on a data-identity-only change", () => {
    useLogDetail.mockReturnValue({
      data: makeDetails(1),
      loading: false,
      error: undefined,
    });
    useLogFetchState.mockReturnValue({ details_settled_seq: 1 });

    const { rerender } = render(<LogLoadController />);
    expect(setLoadedLog).toHaveBeenCalledTimes(1);
    expect(clearSelectedScores).toHaveBeenCalledTimes(1);

    // Poll-tick merge: a new details object, same settled seq — must NOT refire.
    useLogDetail.mockReturnValue({
      data: makeDetails(2),
      loading: false,
      error: undefined,
    });
    rerender(<LogLoadController />);
    expect(setLoadedLog).toHaveBeenCalledTimes(1);
    expect(clearSelectedScores).toHaveBeenCalledTimes(1);

    // A waitered fetch settling bumps the seq — must refire.
    useLogFetchState.mockReturnValue({ details_settled_seq: 2 });
    rerender(<LogLoadController />);
    expect(setLoadedLog).toHaveBeenCalledTimes(2);
    expect(clearSelectedScores).toHaveBeenCalledTimes(2);
  });

  it("does not run the settle effect while settledSeq is undefined", () => {
    useLogDetail.mockReturnValue({
      data: makeDetails(1),
      loading: false,
      error: undefined,
    });
    useLogFetchState.mockReturnValue(undefined);

    render(<LogLoadController />);

    expect(setLoadedLog).not.toHaveBeenCalled();
    expect(clearSelectedScores).not.toHaveBeenCalled();
  });
});
