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
    state.searches.grep.hasSearched = true;
    state.searches.llm.query = "summarize the failure";

    expect(state.searches.grep.query).toBe("literal text");
    expect(state.searches.grep.hasSearched).toBe(true);
    expect(state.searches.llm.query).toBe("summarize the failure");
    expect(state.searches.llm.hasSearched).toBe(false);
  });

  it("migrates legacy flat grep state into the grep branch", () => {
    const legacy = {
      searchType: "grep",
      query: "error",
      hasSearched: true,
      grepOptions: { regex: true },
    } satisfies StoredSearchPanelState;

    const state = normalizeSearchPanelState(legacy);

    expect(state.searchType).toBe("grep");
    expect(state.searches.grep).toEqual({
      query: "error",
      hasSearched: true,
      currentSearch: null,
      grepOptions: {
        ignoreCase: true,
        regex: true,
        wordBoundary: false,
      },
    });
    expect(state.searches.llm.query).toBe("");
    expect(state.searches.llm.hasSearched).toBe(false);
  });

  it("fills missing nested fields without mixing branches", () => {
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
        },
      },
    } satisfies StoredSearchPanelState;

    const state = normalizeSearchPanelState(persisted);

    expect(state.searchType).toBe("llm");
    expect(state.searches.grep.query).toBe("stack trace");
    expect(state.searches.grep.grepOptions).toEqual({
      ignoreCase: false,
      regex: false,
      wordBoundary: false,
    });
    expect(state.searches.llm.query).toBe("what happened?");
    expect(state.searches.llm.model).toBe("gpt-5.4");
    expect(state.searches.llm.hasSearched).toBe(false);
  });
});
