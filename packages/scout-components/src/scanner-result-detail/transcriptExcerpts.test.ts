import { describe, expect, it } from "vitest";

import { isTranscriptExcerpts } from "./transcriptExcerpts";

describe("isTranscriptExcerpts", () => {
  it.each([
    ["one excerpt", "[M12]: ...except **Exception** as e..."],
    [
      "excerpts from messages and events, with a blank line",
      "[M12]: ...the **error** handling...\n\n[E3]: ...set**Timeout**(resolve...",
    ],
  ])("is true for %s", (_, explanation) => {
    expect(isTranscriptExcerpts(explanation)).toBe(true);
  });

  it.each([
    ["prose", 'The user asked to "think step by step" [M1].'],
    ["prose after an excerpt", "[M1]: ...**error**...\nSo the run failed."],
    ["cited lines without a match", "[M1]: the user asks for a flag"],
    ["another cite kind", "[T1]: ...**error**..."],
  ])("is false for %s", (_, explanation) => {
    expect(isTranscriptExcerpts(explanation)).toBe(false);
  });
});
