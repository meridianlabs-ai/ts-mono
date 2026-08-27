import { describe, expect, it } from "vitest";

import {
  testStateEvent,
  testStoreEvent,
  testToolEvent,
} from "@tsmono/inspect-common/testing";
import type { Event, JsonChange } from "@tsmono/inspect-common/types";

import { dynamicDefaultExcludeEvents } from "./eventFilter";
import { kDefaultExcludeEvents } from "./types";

const storeEvent = (changes: JsonChange[]): Event =>
  testStoreEvent({ changes });

const toolEvent = (): Event => testToolEvent();

describe("dynamicDefaultExcludeEvents", () => {
  it("keeps store events visible when a human-baseline session is present", () => {
    const events = [
      toolEvent(),
      storeEvent([
        { op: "add", path: "/HumanAgentState:logs", value: {}, replaced: null },
        {
          op: "add",
          path: "/HumanAgentState:answer",
          value: "x",
          replaced: null,
        },
      ]),
    ];
    const excluded = dynamicDefaultExcludeEvents(events);
    expect(excluded).not.toContain("store");
    // everything else in the default set is untouched
    for (const type of kDefaultExcludeEvents) {
      if (type !== "store") {
        expect(excluded).toContain(type);
      }
    }
  });

  it("excludes store events for ordinary store diffs", () => {
    const events = [
      storeEvent([
        {
          op: "add",
          path: "/SomeOtherState:counter",
          value: 1,
          replaced: null,
        },
      ]),
    ];
    expect(dynamicDefaultExcludeEvents(events)).toEqual([
      ...kDefaultExcludeEvents,
    ]);
  });

  it("returns the static defaults when events are missing or empty", () => {
    expect(dynamicDefaultExcludeEvents(undefined)).toEqual([
      ...kDefaultExcludeEvents,
    ]);
    expect(dynamicDefaultExcludeEvents([])).toEqual([...kDefaultExcludeEvents]);
  });

  it("ignores non-store events even when their paths match", () => {
    const stateEvent = testStateEvent({
      changes: [
        {
          op: "add",
          path: "/store/HumanAgentState:logs",
          value: {},
          from: null,
          replaced: null,
        },
      ],
    });
    expect(dynamicDefaultExcludeEvents([stateEvent])).toEqual([
      ...kDefaultExcludeEvents,
    ]);
  });
});
