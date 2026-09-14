import { describe, expect, it } from "vitest";

import {
  testAssistantMessage,
  testInfoEvent,
  testModelEvent,
  testModelOutput,
} from "@tsmono/inspect-common/testing";
import type { Event } from "@tsmono/inspect-common/types";

import { buildScanReferencePreviews } from "./scanReferencePreviews";
import { buildScoreMarkdownRefs } from "./scanReferences";

const makeUrl = () => undefined;

const previewFor = (
  events: Event[],
  id: string,
  type: "message" | "event" = "event"
) =>
  buildScoreMarkdownRefs(
    { scanner_references: [{ type, id, cite: "[X1]" }] },
    makeUrl,
    buildScanReferencePreviews(events)
  )[0]?.citePreview;

const prototypeNames = [
  "constructor",
  "valueOf",
  "__proto__",
  "__defineGetter__",
  "hasOwnProperty",
  "toString",
];

// Reference ids, event uuids and message ids are all log-authored. An id
// that names an Object.prototype member must yield a preview only when the
// sample really contains an event or message with that id.
describe("buildScanReferencePreviews", () => {
  const events = [testInfoEvent({ uuid: "e1" })];

  it("previews an event that is present and nothing for one that is not", () => {
    expect(previewFor(events, "e1")).toBeTypeOf("function");
    expect(previewFor(events, "missing")).toBeUndefined();
  });

  it.each(prototypeNames)(
    "yields no preview for reference id %s when no such event exists",
    (id) => {
      expect(previewFor(events, id)).toBeUndefined();
      expect(previewFor([], id)).toBeUndefined();
    }
  );

  it.each(prototypeNames)("previews an event whose uuid is %s", (uuid) => {
    expect(previewFor([testInfoEvent({ uuid })], uuid)).toBeTypeOf("function");
  });

  it.each(prototypeNames)(
    "previews a model output message whose id is %s",
    (id) => {
      const event = testModelEvent({
        uuid: "m1",
        output: testModelOutput({
          choices: [
            { message: testAssistantMessage({ id }), stop_reason: "stop" },
          ],
        }),
      });
      expect(previewFor([event], id, "message")).toBeTypeOf("function");
    }
  );
});
