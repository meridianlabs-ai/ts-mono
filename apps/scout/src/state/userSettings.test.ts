// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";

import { useUserSettings } from "./userSettings";

describe("useUserSettings", () => {
  beforeEach(() => {
    localStorage.clear();
    useUserSettings.setState({
      dataframeColumnPresets: [],
      searchModelHistory: [],
    });
  });

  it("records search models as a deduped MRU list", () => {
    const { recordSearchModel } = useUserSettings.getState();

    recordSearchModel("gpt-5.4");
    recordSearchModel("gpt-5.4-mini");
    recordSearchModel(" GPT-5.4 ");

    expect(useUserSettings.getState().searchModelHistory).toEqual([
      "GPT-5.4",
      "gpt-5.4-mini",
    ]);
  });

  it("ignores blank search models", () => {
    const { recordSearchModel } = useUserSettings.getState();

    recordSearchModel("   ");

    expect(useUserSettings.getState().searchModelHistory).toEqual([]);
  });
});
