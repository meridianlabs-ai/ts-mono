import { describe, expect, it } from "vitest";

import { activities, visibleActivities } from "./activities";

describe("visibleActivities", () => {
  it("hides backend-dependent activities in static bundles", () => {
    expect(visibleActivities(true).map((a) => a.id)).toEqual([
      "transcripts",
      "scans",
    ]);
  });

  it("shows the full activity list outside static bundles", () => {
    expect(visibleActivities(false)).toEqual(activities);
    expect(visibleActivities(false).map((a) => a.id)).toEqual(
      expect.arrayContaining(["project", "validation"])
    );
  });
});
