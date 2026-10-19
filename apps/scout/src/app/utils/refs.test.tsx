import { describe, expect, it } from "vitest";

import { createScanResultSummary } from "../../test/objectFactories";

import { toMarkdownRefs } from "./refs";

describe("toMarkdownRefs", () => {
  // Reference ids come from the scan result. One named after an
  // Object.prototype member has no preview unless the input defines it.
  it.each(["constructor", "valueOf", "__proto__"])(
    "gives a %s reference no preview",
    (id) => {
      const summary = createScanResultSummary({
        messageReferences: [{ type: "message", id, cite: "[M1]" }],
        eventReferences: [{ type: "event", id, cite: "[E1]" }],
      });

      expect(toMarkdownRefs(summary, () => undefined)).toEqual([]);
    }
  );
});
