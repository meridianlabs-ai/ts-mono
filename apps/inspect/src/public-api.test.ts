import { describe, expect, it } from "vitest";

import {
  ChatView,
  InspectComponentProvider,
  normalizeEvents,
  TranscriptLayout,
  TranscriptOutline,
  TranscriptViewNodes,
  treeifyEvents,
} from "./index";

describe("published viewer API", () => {
  it("exports the reusable transcript rendering surface", () => {
    expect(ChatView).toBeDefined();
    expect(InspectComponentProvider).toBeDefined();
    expect(TranscriptLayout).toBeDefined();
    expect(TranscriptOutline).toBeDefined();
    expect(TranscriptViewNodes).toBeDefined();
    expect(treeifyEvents([], 0)).toEqual([]);
    expect(normalizeEvents({ events: [] })).toEqual([]);
  });
});
