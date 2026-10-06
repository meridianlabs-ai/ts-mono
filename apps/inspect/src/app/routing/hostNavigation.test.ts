import { expect, it } from "vitest";

import { createWebviewStorage } from "@tsmono/util";

import { createHostCommandFilter } from "./hostNavigation";

it("ignores focus replays across webview recreation but accepts new destinations", () => {
  let saved: unknown;
  const storage = createWebviewStorage({
    getState: () => saved,
    setState: (value) => {
      saved = structuredClone(value);
    },
    postMessage: () => {},
  });
  const initial = {
    type: "updateState",
    url: "file:///logs/one.eval",
  } satisfies Parameters<ReturnType<typeof createHostCommandFilter>>[0];
  const accept = createHostCommandFilter(storage, initial);
  expect(accept(initial)).toBe(false);
  const second = { ...initial, url: "file:///logs/two.eval" };
  expect(accept(second)).toBe(true);
  expect(accept(second)).toBe(false);

  const restored = createHostCommandFilter(storage, initial);
  expect(restored(second)).toBe(false);
  expect(restored({ ...second, sample_id: "1", sample_epoch: "2" })).toBe(true);
  expect(restored(initial)).toBe(true);
});
