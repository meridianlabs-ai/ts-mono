import { describe, expect, it } from "vitest";

import { buildSearchRequest } from "./searchRequest";

describe("buildSearchRequest", () => {
  it("scopes grep searches to messages on the messages tab", () => {
    expect(
      buildSearchRequest({
        defaultModel: null,
        grepOptions: {
          ignoreCase: true,
          regex: false,
          wordBoundary: true,
        },
        model: "",
        query: "error",
        scope: "messages",
        searchType: "grep",
      })
    ).toEqual({
      ignore_case: true,
      messages: "all",
      query: "error",
      regex: false,
      type: "grep",
      word_boundary: true,
    });
  });

  it("scopes llm searches to events on the events tab", () => {
    expect(
      buildSearchRequest({
        defaultModel: "gpt-5.4-mini",
        grepOptions: {
          ignoreCase: true,
          regex: false,
          wordBoundary: false,
        },
        model: "gpt-5.4",
        query: "What failed?",
        scope: "events",
        searchType: "llm",
      })
    ).toEqual({
      events: "all",
      model: "gpt-5.4",
      query: "What failed?",
      type: "llm",
    });
  });

  it("falls back to the project default model for llm searches", () => {
    expect(
      buildSearchRequest({
        defaultModel: "gpt-5.4-mini",
        grepOptions: {
          ignoreCase: true,
          regex: false,
          wordBoundary: false,
        },
        model: "   ",
        query: "Summarize this transcript",
        scope: "messages",
        searchType: "llm",
      })
    ).toEqual({
      messages: "all",
      model: "gpt-5.4-mini",
      query: "Summarize this transcript",
      type: "llm",
    });
  });
});
