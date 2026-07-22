import { describe, expect, it, vi } from "vitest";

import { LogFilesResponse, LogHandle } from "@tsmono/inspect-common";

import { ClientAPI } from "../client/api/types";

import { ListingUpdate } from "./fetchEngine";
import { ListingTarget, syncListing } from "./listingSync";

const handle = (name: string, mtime?: number): LogHandle => ({ name, mtime });

const apiWith = (response: LogFilesResponse): ClientAPI =>
  ({
    get_logs: vi.fn().mockResolvedValue(response),
  }) as unknown as ClientAPI;

const targetWith = (local: LogHandle[]) => {
  const applied: ListingUpdate[] = [];
  const requeueMissing = vi.fn();
  const target: ListingTarget = {
    listing: () => local,
    epoch: () => 7,
    applyListing: (update) => {
      applied.push(update);
      return Promise.resolve(update.listing);
    },
    requeueMissing,
  };
  return { target, applied, requeueMissing };
};

describe("syncListing", () => {
  it("first sync (empty local): full incremental fetch, everything invalidated", async () => {
    const server = [handle("a.eval", 10), handle("b.eval", 20)];
    const { target, applied } = targetWith([]);

    await syncListing(
      apiWith({ files: server, response_type: "full" }),
      target
    );

    expect(applied).toEqual([
      {
        listing: server,
        invalidated: ["a.eval", "b.eval"],
        deleted: [],
        persistListing: true,
        epoch: 7,
      },
    ]);
  });

  it("incremental response: newer/new/missing-mtime files invalidated, no deletes", async () => {
    const local = [
      handle("stale.eval", 10),
      handle("fresh.eval", 30),
      handle("nomtime.eval", 5),
    ];
    const server = [
      handle("stale.eval", 20),
      handle("fresh.eval", 30),
      handle("nomtime.eval"),
      handle("new.eval", 40),
    ];
    const { target, applied } = targetWith(local);

    await syncListing(
      apiWith({ files: server, response_type: "incremental" }),
      target
    );

    expect(applied[0]?.invalidated).toEqual([
      "stale.eval",
      "nomtime.eval",
      "new.eval",
    ]);
    expect(applied[0]?.deleted).toEqual([]);
    expect(applied[0]?.persistListing).toBe(true);
  });

  it("applies no listing on an empty incremental response, but re-arms backfill", async () => {
    const local = [handle("a.eval", 10), handle("b.eval", 20)];
    const { target, applied, requeueMissing } = targetWith(local);

    const result = await syncListing(
      apiWith({ files: [], response_type: "incremental" }),
      target
    );

    expect(result).toEqual(local);
    expect(applied).toEqual([]);
    expect(requeueMissing).toHaveBeenCalledTimes(1);
  });

  it("merges incremental changes into the current listing", async () => {
    const local = [handle("changed.eval", 10), handle("untouched.eval", 30)];
    const changed = handle("changed.eval", 20);
    const { target, applied } = targetWith(local);

    await syncListing(
      apiWith({ files: [changed], response_type: "incremental" }),
      target
    );

    expect(applied).toEqual([
      {
        listing: [changed, local[1]],
        invalidated: ["changed.eval"],
        deleted: [],
        persistListing: true,
        epoch: 7,
      },
    ]);
  });

  it("puts brand-new incremental files at the front, like a full response would", async () => {
    // The server lists newest-first (mtime desc) and an incremental payload
    // only holds files newer than every local mtime, so new files belong at
    // the head. Cache-only scopes render raw listing order — a tail append
    // would pin fresh logs to the bottom of the unsorted list, while DB-mode
    // reads (mtime desc) and full responses put them on top.
    const local = [handle("a.eval", 30), handle("b.eval", 20)];
    const brandNew = handle("new.eval", 50);
    const changed = handle("a.eval", 40);
    const { target, applied } = targetWith(local);

    await syncListing(
      apiWith({ files: [brandNew, changed], response_type: "incremental" }),
      target
    );

    // New file first; the changed file is patched in place.
    expect(applied[0]?.listing).toEqual([brandNew, changed, local[1]]);
  });

  it("does not turn unchanged incremental syncs into a full-list request", async () => {
    const local = [handle("a.eval", 10), handle("b.eval", 25)];
    let current = local;
    const applied: ListingUpdate[] = [];
    const target: ListingTarget = {
      listing: () => current,
      epoch: () => 7,
      applyListing: (update) => {
        applied.push(update);
        current = update.listing;
        return Promise.resolve(current);
      },
      requeueMissing: vi.fn(),
    };
    const api = apiWith({ files: [], response_type: "incremental" });

    await syncListing(api, target);
    await syncListing(api, target);

    expect(api.get_logs).toHaveBeenNthCalledWith(1, 25, 2);
    expect(api.get_logs).toHaveBeenNthCalledWith(2, 25, 2);
    expect(current).toEqual(local);
    expect(applied).toEqual([]);
  });

  it("full response: local files absent from the server are deleted", async () => {
    const local = [handle("keep.eval", 10), handle("gone.eval", 10)];
    const server = [handle("keep.eval", 10)];
    const { target, applied } = targetWith(local);

    await syncListing(
      apiWith({ files: server, response_type: "full" }),
      target
    );

    expect(applied[0]?.deleted).toEqual(["gone.eval"]);
    expect(applied[0]?.invalidated).toEqual([]);
  });

  it("static local list (no mtimes): a changed server list invalidates everything, cache-only", async () => {
    const local = [handle("a.eval"), handle("b.eval")];
    const server = [handle("a.eval"), handle("c.eval")];
    const { target, applied } = targetWith(local);

    await syncListing(
      apiWith({ files: server, response_type: "full" }),
      target
    );

    expect(applied).toEqual([
      {
        listing: server,
        invalidated: ["a.eval", "b.eval"],
        deleted: [],
        persistListing: false,
        epoch: 7,
      },
    ]);
  });

  it("static local list, unchanged names: re-activates the current listing", async () => {
    const local = [handle("a.eval"), handle("b.eval")];
    const { target, applied } = targetWith(local);

    await syncListing(
      apiWith({
        files: [handle("b.eval"), handle("a.eval")],
        response_type: "full",
      }),
      target
    );

    expect(applied).toEqual([
      {
        listing: local,
        invalidated: [],
        deleted: [],
        persistListing: false,
        epoch: 7,
      },
    ]);
  });

  it("asks the server for changes since the newest local mtime", async () => {
    const local = [handle("a.eval", 10), handle("b.eval", 25)];
    const api = apiWith({ files: [], response_type: "incremental" });
    const { target } = targetWith(local);

    await syncListing(api, target);

    expect(api.get_logs).toHaveBeenCalledWith(25, 2);
  });
});
