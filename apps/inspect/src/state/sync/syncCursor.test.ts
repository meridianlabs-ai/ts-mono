import { describe, expect, it } from "vitest";

import { LogHandle } from "@tsmono/inspect-common/types";

import { computeInvalidations, computeSyncCursor } from "./syncCursor";

const log = (name: string, mtime: number | null): LogHandle => ({
  name,
  task: null,
  task_id: null,
  mtime,
});

describe("computeSyncCursor", () => {
  it("returns a zero cursor for an empty list", () => {
    expect(computeSyncCursor([])).toEqual({
      mtime: 0,
      clientFileCount: 0,
      staticList: false,
    });
  });

  it("uses the max mtime and the file count", () => {
    const logs = [log("a.eval", 100), log("b.eval", 250)];
    expect(computeSyncCursor(logs)).toEqual({
      mtime: 250,
      clientFileCount: 2,
      staticList: false,
    });
  });

  it("flags a static list when files exist but no mtimes are present", () => {
    const logs = [log("a.eval", null), log("b.eval", null)];
    expect(computeSyncCursor(logs)).toEqual({
      mtime: 0,
      clientFileCount: 2,
      staticList: true,
    });
  });

  it("is not static when at least one file has an mtime", () => {
    const logs = [log("a.eval", null), log("b.eval", 300)];
    expect(computeSyncCursor(logs)).toEqual({
      mtime: 300,
      clientFileCount: 2,
      staticList: false,
    });
  });
});

describe("computeInvalidations", () => {
  it("treats a remote log with no local copy as new", () => {
    expect(
      computeInvalidations([log("a.eval", 100)], []).map((l) => l.name)
    ).toEqual(["a.eval"]);
  });

  it("invalidates when the remote mtime is newer than local", () => {
    expect(
      computeInvalidations([log("a.eval", 200)], [log("a.eval", 100)]).map(
        (l) => l.name
      )
    ).toEqual(["a.eval"]);
  });

  it("does not invalidate when local is current", () => {
    expect(
      computeInvalidations([log("a.eval", 100)], [log("a.eval", 100)])
    ).toEqual([]);
  });

  it("invalidates when either mtime is missing", () => {
    expect(
      computeInvalidations([log("a.eval", null)], [log("a.eval", 100)]).map(
        (l) => l.name
      )
    ).toEqual(["a.eval"]);
  });

  it("invalidates when the local mtime is missing but the remote has one", () => {
    expect(
      computeInvalidations([log("a.eval", 200)], [log("a.eval", null)]).map(
        (l) => l.name
      )
    ).toEqual(["a.eval"]);
  });
});
