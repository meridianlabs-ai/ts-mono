// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import { FindController } from "./FindController";
import type { FindSegment, FindSource } from "./types";

// Fake source with no DOM: getElement always misses, so navigation is
// observable through which keys the controller asks for.
const makeSource = (texts: string[]) => {
  let segments: FindSegment[] = texts.map((t, i) => ({
    key: `k${i}`,
    lowerText: t,
  }));
  const listeners = new Set<() => void>();
  const elementRequests: string[] = [];
  const source: FindSource = {
    getSegments: () => segments,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    reveal: (_key, onSettled) => onSettled(),
    getContainer: () => null,
    getElement: (key) => {
      elementRequests.push(key);
      return null;
    },
    cleanup: () => undefined,
  };
  return {
    source,
    elementRequests,
    setTexts: (next: string[]) => {
      segments = next.map((t, i) => ({ key: `k${i}`, lowerText: t }));
      for (const listener of listeners) listener();
    },
  };
};

describe("FindController live-corpus repair", () => {
  it("re-resolves the cursor when the painted occurrence disappears", () => {
    const controller = new FindController();
    const { source, elementRequests, setTexts } = makeSource(["x x", "x"]);
    controller.setActive(true);
    const unregister = controller.registerSource(source);

    controller.setTerm("x");
    controller.step(1); // term !== query -> immediate search, lands match 1
    expect(controller.getSnapshot().total).toBe(3);
    expect(controller.getSnapshot().ordinal).toBe(1);

    controller.step(1); // match 2 = k0, occurrence 1
    expect(controller.getSnapshot().ordinal).toBe(2);
    expect(elementRequests.at(-1)).toBe("k0");

    // k0 loses its second occurrence; the cursor ordinal (2) still exists —
    // it must re-resolve onto k1 rather than keep painting the dead target.
    setTexts(["x", "x"]);
    expect(controller.getSnapshot().total).toBe(2);
    expect(controller.getSnapshot().ordinal).toBe(2);
    expect(elementRequests.at(-1)).toBe("k1");

    unregister();
  });

  it("keeps the ordinal attached to the painted match when matches renumber", () => {
    const controller = new FindController();
    const { source, elementRequests, setTexts } = makeSource(["y", "x"]);
    controller.setActive(true);
    const unregister = controller.registerSource(source);

    controller.setTerm("x");
    controller.step(1);
    expect(controller.getSnapshot().ordinal).toBe(1);
    expect(elementRequests.at(-1)).toBe("k1");

    // A match appears BEFORE the painted one: its ordinal becomes 2 but the
    // paint target must not move.
    setTexts(["y x", "x"]);
    expect(controller.getSnapshot().total).toBe(2);
    expect(controller.getSnapshot().ordinal).toBe(2);
    expect(elementRequests.at(-1)).toBe("k1");

    unregister();
  });
});
