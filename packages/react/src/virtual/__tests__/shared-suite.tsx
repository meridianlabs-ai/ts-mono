// @vitest-environment jsdom
import type { ReactNode, RefObject } from "react";
import { describe, expect, it } from "vitest";

export type HarnessHandle = {
  scrollToIndex(opts: {
    index: number;
    align?: "start" | "center" | "end";
    behavior?: "auto" | "smooth";
    offset?: number;
  }): void;
  scrollTo(opts: { top: number; behavior?: "auto" | "smooth" }): void;
};

export type HarnessAdapter<T> = {
  name: "LiveVirtualList" | "VirtualList";
  render(opts: {
    persistenceKey: string;
    data: T[];
    renderRow: (index: number, item: T) => ReactNode;
    live?: boolean;
    initialIndex?: number;
    scrollToTopOnFinish?: boolean;
    handleRef: RefObject<HarnessHandle | null>;
    scrollRef: RefObject<HTMLDivElement | null>;
  }): { unmount: () => void; container: HTMLElement };
};

export type SuiteOptions<T> = {
  adapter: HarnessAdapter<T>;
  skip?: string[];
};

const tags = {
  preserved: "preserved",
  legacyOnly: "legacy-only",
  newOnly: "new-only",
} as const;

type TagKey = keyof typeof tags;

function maybe(
  tag: TagKey,
  testId: string,
  skip: string[] | undefined,
  body: () => void | Promise<void>
) {
  const skipped = skip?.includes(testId);
  if (skipped) {
    it.skip(`[${tags[tag]}] ${testId}`, body);
  } else {
    it(`[${tags[tag]}] ${testId}`, body);
  }
}

export function createVirtualListTestSuite<T = { id: number; text: string }>(
  opts: SuiteOptions<T>
) {
  const { adapter, skip } = opts;
  void adapter;
  void skip;
  void maybe;
  void expect;

  describe(`virtual-list contract — ${adapter.name}`, () => {
    // Stub test — real coverage lands in Task 1.H.
    it("[preserved] harness-bootstraps", () => {
      expect(true).toBe(true);
    });
  });
}
