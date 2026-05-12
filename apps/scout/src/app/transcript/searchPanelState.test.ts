import { describe, expect, it } from "vitest";

import {
  createInitialSearchPanelState,
  normalizeSearchPanelState,
  type StoredSearchPanelState,
} from "./searchPanelState";

describe("search panel state", () => {
  it("stores grep and llm search state separately", () => {
    const state = createInitialSearchPanelState();
    state.searches.grep.query = "literal text";
    state.searches.grep.searchId = "grep-1";
    state.searches.llm.query = "summarize the failure";

    expect(state.searches.grep.query).toBe("literal text");
    expect(state.searches.grep.searchId).toBe("grep-1");
    expect(state.searches.llm.query).toBe("summarize the failure");
    expect(state.searches.llm.searchId).toBeNull();
  });

  it("fills missing fields with defaults", () => {
    const state = normalizeSearchPanelState();

    expect(state).toEqual(createInitialSearchPanelState());
  });

  it("normalizes a partially-stored state without mixing branches", () => {
    const persisted = {
      searchType: "llm",
      searches: {
        grep: {
          query: "stack trace",
          grepOptions: { ignoreCase: false },
        },
        llm: {
          query: "what happened?",
          model: "gpt-5.4",
          searchId: "llm-7",
        },
      },
    } satisfies StoredSearchPanelState;

    const state = normalizeSearchPanelState(persisted);

    expect(state.searchType).toBe("llm");
    expect(state.searches.grep.query).toBe("stack trace");
    expect(state.searches.grep.searchId).toBeNull();
    expect(state.searches.grep.grepOptions).toEqual({
      ignoreCase: false,
      regex: false,
      wordBoundary: false,
    });
    expect(state.searches.llm.query).toBe("what happened?");
    expect(state.searches.llm.model).toBe("gpt-5.4");
    expect(state.searches.llm.searchId).toBe("llm-7");
  });
});
