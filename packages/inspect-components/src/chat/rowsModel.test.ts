import { describe, expect, it } from "vitest";

import { messageRowOptions } from "./rowsModel";

describe("messageRowOptions", () => {
  it("fills the fold defaults", () => {
    expect(messageRowOptions()).toEqual({
      toolCallStyle: "complete",
      collapseToolMessages: true,
    });
  });

  it("honors explicit tool options", () => {
    expect(
      messageRowOptions({ callStyle: "compact", collapseToolMessages: false })
    ).toEqual({
      toolCallStyle: "compact",
      collapseToolMessages: false,
    });
  });
});
