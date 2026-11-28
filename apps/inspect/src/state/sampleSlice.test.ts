import { describe, expect, it } from "vitest";

import { createTestStore } from "./testStore";

describe("sampleSlice collapseEvent", () => {
  it("records an expand, so it can override a node that starts collapsed", () => {
    const store = createTestStore();

    store
      .getState()
      .sampleActions.collapseEvent("transcript", "state-1", false);

    expect(store.getState().sample.collapsedEvents).toEqual({
      transcript: { "state-1": false },
    });
  });
});
