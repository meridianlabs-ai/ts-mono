/**
 * The sample page's shared scroller: the tabs' lists and the collapsible
 * sample header live in one scroll container.
 */
import { expect, type Page } from "@playwright/test";

export interface ViewState {
  /** First virtual row whose top is at or below the scroller's top edge. */
  index: number | null;
  /** That row's top, in px from the scroller's top edge. */
  top: number | null;
  headerHeight: number;
  scrollTop: number | null;
}

/** The scroller is the nearest scrolling ancestor of the sample header. */
export const viewState = (page: Page): Promise<ViewState> =>
  page.evaluate(() => {
    const header = document.querySelector('[id^="sample-heading-"]');
    let scroller = header?.parentElement ?? null;
    while (scroller && getComputedStyle(scroller).overflowY !== "auto") {
      scroller = scroller.parentElement;
    }
    const viewTop = scroller?.getBoundingClientRect().top ?? 0;
    const first = [
      ...document.querySelectorAll<HTMLElement>("[data-item-index]"),
    ]
      .map((row) => ({
        index: Number(row.dataset.itemIndex),
        top: row.getBoundingClientRect().top - viewTop,
      }))
      .filter((row) => row.top >= 0)
      .sort((a, b) => a.top - b.top)[0];
    return {
      index: first?.index ?? null,
      top: first ? Math.round(first.top) : null,
      headerHeight: Math.round(header?.getBoundingClientRect().height ?? 0),
      scrollTop: scroller?.scrollTop ?? null,
    };
  });

/** The view once two readings 150ms apart agree (a wheel gesture scrolls
 *  asynchronously, so back-to-back readings can both predate its effect). */
export async function settledView(page: Page): Promise<ViewState> {
  let previous: ViewState | null = null;
  await expect
    .poll(
      async () => {
        const now = await viewState(page);
        const same =
          previous !== null && JSON.stringify(now) === JSON.stringify(previous);
        previous = now;
        return same;
      },
      { intervals: [150] }
    )
    .toBe(true);
  return previous!;
}

/** The same row at the same y (within 1px) under the same header state. */
export async function expectSameView(page: Page, before: ViewState) {
  await expect
    .poll(async () => {
      const now = await viewState(page);
      return {
        index: now.index,
        headerHeight: now.headerHeight,
        withinPx:
          now.top !== null &&
          before.top !== null &&
          Math.abs(now.top - before.top) <= 1,
      };
    })
    .toEqual({
      index: before.index,
      headerHeight: before.headerHeight,
      withinPx: true,
    });
}
