import { describe, expect, it } from "vitest";

import { isCurrentSample } from "./sample";

const handle = (id: string | number, epoch: number) => ({
  id,
  epoch,
  logFile: "log.eval",
});

describe("isCurrentSample", () => {
  it("matches on equal id (string-normalized) and epoch", () => {
    expect(isCurrentSample(handle(1, 0), 1, 0)).toBe(true);
    expect(isCurrentSample(handle("1", 0), 1, 0)).toBe(true);
  });

  it("rejects differing id or epoch, or an undefined handle", () => {
    expect(isCurrentSample(handle(1, 0), 2, 0)).toBe(false);
    expect(isCurrentSample(handle(1, 0), 1, 1)).toBe(false);
    expect(isCurrentSample(undefined, 1, 0)).toBe(false);
  });
});
