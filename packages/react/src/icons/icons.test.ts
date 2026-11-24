import { describe, expect, it } from "vitest";

import { logLevelIcon } from "./icons";

describe("logLevelIcon", () => {
  it("maps logger levels case-insensitively", () => {
    expect(logLevelIcon("WARNING")).toBe("logWarning");
    expect(logLevelIcon("info")).toBe("logInfo");
  });

  it("returns undefined for unknown levels, including Object.prototype keys", () => {
    expect(logLevelIcon("trace")).toBeUndefined();
    expect(logLevelIcon("constructor")).toBeUndefined();
    expect(logLevelIcon("__proto__")).toBeUndefined();
  });
});
