import { describe, expect, it } from "vitest";

import type { Event } from "@tsmono/inspect-common/types";

import { dynamicDefaultExcludeEvents } from "./eventFilter";
import { kDefaultExcludeEvents } from "./types";

const storeEvent = (changes: { op: string; path: string; value?: unknown }[]) =>
  ({ event: "store", changes }) as unknown as Event;

const toolEvent = () => ({ event: "tool" }) as unknown as Event;

describe("dynamicDefaultExcludeEvents", () => {
  it("keeps store events visible when a human-baseline session is present", () => {
    const events = [
      toolEvent(),
      storeEvent([
        { op: "add", path: "/HumanAgentState:logs", value: {} },
        { op: "add", path: "/HumanAgentState:answer", value: "x" },
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
      storeEvent([{ op: "add", path: "/SomeOtherState:counter", value: 1 }]),
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
    const stateEvent = {
      event: "state",
      changes: [{ op: "add", path: "/store/HumanAgentState:logs", value: {} }],
    } as unknown as Event;
    expect(dynamicDefaultExcludeEvents([stateEvent])).toEqual([
      ...kDefaultExcludeEvents,
    ]);
  });
});
