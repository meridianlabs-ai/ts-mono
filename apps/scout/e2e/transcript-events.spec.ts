/**
 * E2E tests for transcript event rendering components.
 *
 * These tests verify that each event type renders correctly in the
 * transcript Events tab. They serve as a baseline before extracting
 * transcript components into the shared inspect-components package.
 */
import { delay, http, HttpResponse } from "msw";

import type {
  ErrorEvent,
  Event,
  ScoreEvent,
  ToolEvent,
} from "@tsmono/inspect-common/types";
import { encodeBase64Url } from "@tsmono/util";

import type {
  MessagesEventsResponse,
  TranscriptInfo,
  TranscriptsResponse,
} from "../src/types/api-types";

import { expect, test } from "./fixtures/app";
import {
  createMessagesEventsResponse,
  createModelEvent,
  createTimeline,
  createTimelineScenario,
  createTimelineSpan,
  createTranscriptInfo,
  createTranscriptsResponse,
} from "./fixtures/test-data";

const TRANSCRIPTS_DIR = "/home/test/project/.transcripts";
const TRANSCRIPT_ID = "t-events-001";

/**
 * Mock the transcript info + messages-events endpoints for any transcript id.
 */
function mockTranscript(
  network: Parameters<Parameters<typeof test>[2]>[0]["network"],
  events: Event[],
  options?: {
    messages?: MessagesEventsResponse["messages"];
    timelines?: MessagesEventsResponse["timelines"];
  }
) {
  network.use(
    http.get("*/api/v2/transcripts/:dir/:id/info", () =>
      HttpResponse.json<TranscriptInfo>(
        createTranscriptInfo({
          transcript_id: TRANSCRIPT_ID,
          task_id: "test-task",
          model: "claude-3",
        })
      )
    ),
    http.get("*/api/v2/transcripts/:dir/:id/messages-events", () =>
      HttpResponse.json<MessagesEventsResponse>(
        createMessagesEventsResponse({
          messages: options?.messages ?? [],
          events,
          timelines: options?.timelines ?? [],
        })
      )
    )
  );
}

/**
 * Navigate directly to a transcript's Events tab.
 */
async function goToTranscriptEvents(
  page: Parameters<Parameters<typeof test>[2]>[0]["page"],
  network: Parameters<Parameters<typeof test>[2]>[0]["network"],
  events: Event[],
  options?: {
    messages?: MessagesEventsResponse["messages"];
    timelines?: MessagesEventsResponse["timelines"];
    messageId?: string;
    eventId?: string;
  }
) {
  const encodedDir = encodeBase64Url(TRANSCRIPTS_DIR);

  mockTranscript(network, events, options);

  const params = new URLSearchParams({ tab: "transcript-events" });
  if (options?.messageId) params.set("message", options.messageId);
  if (options?.eventId) params.set("event", options.eventId);
  await page.goto(
    `/#/transcripts/${encodedDir}/${TRANSCRIPT_ID}?${params.toString()}`
  );
}

// ---------------------------------------------------------------------------
// Event factories
// ---------------------------------------------------------------------------

function createToolEvent(
  overrides?: Partial<ToolEvent> & { uuid?: string }
): ToolEvent {
  return {
    event: "tool",
    uuid: overrides?.uuid ?? "tool-evt-1",
    function: "bash",
    arguments: { cmd: "ls -la" },
    type: "function",
    id: "tool-call-1",
    result: "total 42\ndrwxr-xr-x 3 user staff 96 Jan 15 10:00 .",
    events: [],
    timestamp: "2025-01-15T10:00:05Z",
    working_start: 5,
    working_time: 2,
    ...overrides,
  };
}

function createScoreEvent(
  overrides?: Partial<ScoreEvent> & { uuid?: string }
): ScoreEvent {
  return {
    event: "score",
    uuid: overrides?.uuid ?? "score-evt-1",
    score: {
      value: "C",
      answer: "The answer is 42",
      explanation: "Correct based on the reference",
      history: [],
    },
    intermediate: false,
    timestamp: "2025-01-15T10:00:10Z",
    working_start: 10,
    ...overrides,
  };
}

function createErrorEvent(
  overrides?: Partial<ErrorEvent> & { uuid?: string }
): ErrorEvent {
  return {
    event: "error",
    uuid: overrides?.uuid ?? "error-evt-1",
    error: {
      message: "RuntimeError: division by zero",
      traceback:
        'Traceback (most recent call last):\n  File "eval.py", line 42\n    result = x / 0\nRuntimeError: division by zero',
      traceback_ansi:
        'Traceback (most recent call last):\n  File "eval.py", line 42\n    result = x / 0\nRuntimeError: division by zero',
    },
    timestamp: "2025-01-15T10:00:15Z",
    working_start: 15,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe("transcript event rendering", () => {
  test("model event renders with chat messages and usage", async ({
    page,
    network,
  }) => {
    const modelEvent = createModelEvent({
      uuid: "model-evt-1",
      startSec: 2,
      endSec: 5,
      tokens: 500,
      content: "Here is my analysis of the code.",
    });

    // Add a user message to the model input
    modelEvent.input = [
      {
        role: "user",
        content: "Analyze this code for bugs",
        id: null,
      },
    ];

    await goToTranscriptEvents(page, network, [modelEvent]);

    // Model event panel should be visible with title
    await expect(page.getByText("Model Call:")).toBeVisible();

    // Output message should render (first match — Summary tab)
    await expect(
      page.getByText("Here is my analysis of the code.").first()
    ).toBeVisible();
  });

  test("?message= lands below the sticky event header", async ({
    page,
    network,
  }) => {
    const modelEvent = createModelEvent({
      uuid: "model-evt-1",
      startSec: 2,
      endSec: 5,
      content: "Target assistant message",
    });
    modelEvent.input = [
      {
        role: "user",
        content: Array.from({ length: 120 }, (_, i) => `Spacer line ${i}`).join(
          "\n\n"
        ),
        id: "input-message",
      },
    ];
    modelEvent.output.choices[0]!.message.id = "target-message";
    const trailingEvents = Array.from({ length: 4 }, (_, i) =>
      createModelEvent({
        uuid: `model-evt-${i + 2}`,
        startSec: 10 + i * 3,
        endSec: 12 + i * 3,
        content: Array.from(
          { length: 80 },
          (_, line) => `Trailing ${i}-${line}`
        ).join("\n\n"),
      })
    );

    await goToTranscriptEvents(page, network, [modelEvent, ...trailingEvents], {
      messageId: "target-message",
    });

    const message = page.locator("[data-message-id='target-message']");
    await expect(message).toBeVisible();
    await expect
      .poll(async () => {
        const geometry = await message.evaluate((el) => {
          let scrollContainer: HTMLElement | null = el.parentElement;
          while (
            scrollContainer &&
            !/(auto|scroll)/.test(getComputedStyle(scrollContainer).overflowY)
          ) {
            scrollContainer = scrollContainer.parentElement;
          }
          const scrollTop = scrollContainer?.getBoundingClientRect().top ?? 0;
          const header = document
            .getElementById("model-evt-1")
            ?.querySelector<HTMLElement>("[data-sticky-stuck]");
          return {
            messageTop: el.getBoundingClientRect().top - scrollTop,
            headerBottom: header
              ? header.getBoundingClientRect().bottom - scrollTop
              : 0,
          };
        });
        return (
          geometry.headerBottom > 10 &&
          geometry.messageTop >= geometry.headerBottom - 2
        );
      })
      .toBe(true);
  });

  test("tool event renders with function name and output", async ({
    page,
    network,
  }) => {
    const modelEvent = createModelEvent({
      uuid: "model-evt-1",
      startSec: 0,
      endSec: 2,
      content: "Let me check the files.",
    });
    modelEvent.output.choices[0]!.message.tool_calls = [
      {
        id: "tool-call-1",
        function: "bash",
        arguments: { cmd: "ls -la" },
        type: "function",
      },
    ];

    const toolEvent = createToolEvent();

    await goToTranscriptEvents(page, network, [modelEvent, toolEvent]);

    // Tool event panel should show tool name in title
    await expect(page.getByText("Tool: Bash")).toBeVisible();

    // Tool output should be visible
    await expect(page.getByText("total 42")).toBeVisible();
  });

  test("score event renders value and explanation", async ({
    page,
    network,
  }) => {
    const scoreEvent = createScoreEvent();

    await goToTranscriptEvents(page, network, [scoreEvent]);

    // Score panel should be visible
    await expect(page.getByText("Score").first()).toBeVisible();

    // Score value should render
    await expect(page.getByText("C").first()).toBeVisible();

    // Explanation should be visible
    await expect(
      page.getByText("Correct based on the reference")
    ).toBeVisible();
  });

  test("error event renders traceback", async ({ page, network }) => {
    const errorEvent = createErrorEvent();

    await goToTranscriptEvents(page, network, [errorEvent]);

    // Error panel should be visible
    await expect(page.getByText("Error").first()).toBeVisible();

    // Error message should render
    await expect(
      page.getByText("RuntimeError: division by zero")
    ).toBeVisible();
  });

  test("events can be collapsed and expanded", async ({ page, network }) => {
    const modelEvent = createModelEvent({
      uuid: "model-evt-1",
      startSec: 0,
      endSec: 3,
      content: "Model response content here",
    });

    await goToTranscriptEvents(page, network, [modelEvent]);

    // Content should be visible initially (first match — Summary tab)
    await expect(
      page.getByText("Model response content here").first()
    ).toBeVisible();

    // Click the collapse toggle (the panel title area)
    const collapseToggle = page
      .locator('[data-collapse-toggle="true"]')
      .first();
    if (await collapseToggle.isVisible()) {
      await collapseToggle.click();

      // Content should be hidden after collapse
      await expect(
        page.getByText("Model response content here").first()
      ).not.toBeVisible();

      // Click again to expand
      await collapseToggle.click();

      // Content should be visible again
      await expect(
        page.getByText("Model response content here").first()
      ).toBeVisible();
    }
  });

  test("?event= deep link lands below the pinned chrome", async ({
    page,
    network,
  }) => {
    // Landing math relies on the host collapsing the chrome on navigation
    // (onHeadroomSetHidden); without it the target parks at the container top
    // and the sticky swimlane/tab chrome occludes it.
    const tall = (label: string) =>
      `${label}. ` + "Lorem ipsum dolor sit amet consectetur. ".repeat(120);
    const events = Array.from({ length: 8 }, (_, i) =>
      createModelEvent({
        uuid: `evt-lane-${i}`,
        startSec: i * 5 + 2,
        endSec: i * 5 + 4,
        tokens: 100,
        content: tall(`Lane turn ${i}`),
        spanId: "lane",
      })
    );
    const laneSpan = createTimelineSpan({
      id: "lane",
      name: "Lane",
      span_type: "agent",
      content: events.map((e) => ({
        type: "event" as const,
        event: e.uuid!,
      })),
    });
    const scenario = createMessagesEventsResponse({
      messages: [{ role: "user", content: "deep link landing" }],
      events,
      timelines: [createTimeline(laneSpan)],
    });
    await goToTranscriptEvents(page, network, scenario.events, {
      messages: scenario.messages,
      timelines: scenario.timelines,
      eventId: "evt-lane-5",
    });
    await expect(page.getByText("Lane turn 5").first()).toBeVisible();

    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const el = document.getElementById("evt-lane-5");
            if (!el) return null;
            let sc: HTMLElement | null = el;
            while (sc && !/(auto|scroll)/.test(getComputedStyle(sc).overflowY))
              sc = sc.parentElement;
            if (!sc) return null;
            const scTop = sc.getBoundingClientRect().top;
            let chromeBottom = 0;
            for (const node of sc.querySelectorAll<HTMLElement>("*")) {
              const st = getComputedStyle(node);
              if (st.position !== "sticky") continue;
              const r = node.getBoundingClientRect();
              if (r.top - scTop <= 2 && r.height > 4 && !el.contains(node))
                chromeBottom = Math.max(chromeBottom, r.bottom - scTop);
            }
            // tuck allowance: the row's top sits ~20px above the pin line
            // by design, so "not occluded" means rowTop >= chromeBottom - 25.
            const rowTop = el.getBoundingClientRect().top - scTop;
            return `rowTop=${Math.round(rowTop)} chromeBottom=${Math.round(
              chromeBottom
            )} ok=${rowTop >= chromeBottom - 25}`;
          }),
        { timeout: 5000 }
      )
      .toMatch(/ok=true$/);
  });

  test("?event= deep link mounts with the chrome collapsed (no expanded flash)", async ({
    page,
    network,
  }) => {
    // Deep-link mounts render the chrome collapsed from the FIRST frame
    // (initialHidden). The observer records the headroom's class at DOM
    // insertion and, via attributeOldValue, the pre-change class of every
    // flip — verified to fail pre-fix (mount expanded, force-collapse a
    // commit later). Pins DOM state, not pixels; class matching relies on
    // dev-server CSS-module naming (`_titleHeadroom_hash`).
    await page.addInitScript(() => {
      const log: string[] = [];
      (window as unknown as { __chromeClassLog: string[] }).__chromeClassLog =
        log;
      const cls = (el: Element) => el.getAttribute("class") ?? "";
      // `_titleHeadroom_` (trailing underscore) excludes `_titleHeadroomInner_`.
      const isHeadroom = (el: Element) => cls(el).includes("_titleHeadroom_");
      const observer = new MutationObserver((mutations) => {
        for (const m of mutations) {
          if (
            m.type === "attributes" &&
            m.target instanceof Element &&
            isHeadroom(m.target)
          ) {
            // The PRE-change class is the flash evidence: mutation callbacks
            // run after the microtask batch, so added-node records read the
            // element live (already re-collapsed) — a mount-expanded →
            // force-collapse flip is only visible via attributeOldValue.
            log.push(m.oldValue ?? "");
            log.push(cls(m.target));
          }
          for (const node of m.addedNodes) {
            if (!(node instanceof Element)) continue;
            if (isHeadroom(node)) log.push(cls(node));
            for (const el of node.querySelectorAll(
              "[class*='_titleHeadroom_']"
            )) {
              log.push(cls(el));
            }
          }
        }
      });
      log.push("__observer_installed__");
      // Observe the Document node: at init-script time (before any of the
      // page's own scripts) document.documentElement may not exist yet.
      observer.observe(document, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["class"],
        attributeOldValue: true,
      });
    });

    const tall = (label: string) =>
      `${label}. ` + "Lorem ipsum dolor sit amet consectetur. ".repeat(120);
    const events = Array.from({ length: 8 }, (_, i) =>
      createModelEvent({
        uuid: `evt-lane-${i}`,
        startSec: i * 5 + 2,
        endSec: i * 5 + 4,
        tokens: 100,
        content: tall(`Lane turn ${i}`),
        spanId: "lane",
      })
    );
    const laneSpan = createTimelineSpan({
      id: "lane",
      name: "Lane",
      span_type: "agent",
      content: events.map((e) => ({
        type: "event" as const,
        event: e.uuid!,
      })),
    });
    const scenario = createMessagesEventsResponse({
      messages: [{ role: "user", content: "deep link landing" }],
      events,
      timelines: [createTimeline(laneSpan)],
    });
    await goToTranscriptEvents(page, network, scenario.events, {
      messages: scenario.messages,
      timelines: scenario.timelines,
      eventId: "evt-lane-5",
    });
    await expect(page.getByText("Lane turn 5").first()).toBeVisible();

    // End state: the title headroom is collapsed (the swimlane strip hangs
    // off the same hidden signal; its landing geometry is pinned by the
    // "lands below the pinned chrome" test above).
    await expect(page.locator("[class*='_titleHeadroom_']")).toHaveClass(
      /titleHidden/
    );

    // No-flash invariant: the headroom was already collapsed when it entered
    // the DOM, and never left the collapsed state during the landing.
    const log = await page.evaluate(
      () =>
        (window as unknown as { __chromeClassLog: string[] }).__chromeClassLog
    );
    expect(log.shift()).toBe("__observer_installed__");
    expect(log.length).toBeGreaterThan(0);
    for (const entry of log) {
      expect(entry).toContain("titleHidden");
    }
  });

  test("agent card renders for agent spans", async ({ page, network }) => {
    const scenario = createTimelineScenario();

    await goToTranscriptEvents(page, network, scenario.events, {
      messages: scenario.messages,
      timelines: scenario.timelines,
    });

    // Agent span names should render
    await expect(page.getByText("Explore").first()).toBeVisible();
    await expect(page.getByText("Build").first()).toBeVisible();
  });

  test("ArrowRight navigates to the next transcript", async ({
    page,
    network,
  }) => {
    const nextTranscriptId = "t-events-002";
    network.use(
      http.post("*/api/v2/transcripts/:dir", () =>
        HttpResponse.json<TranscriptsResponse>(
          createTranscriptsResponse([
            createTranscriptInfo({ transcript_id: TRANSCRIPT_ID }),
            createTranscriptInfo({ transcript_id: nextTranscriptId }),
          ])
        )
      )
    );

    const modelEvent = createModelEvent({
      uuid: "model-evt-1",
      startSec: 2,
      endSec: 5,
    });
    await goToTranscriptEvents(page, network, [modelEvent]);
    await expect(page.getByText("Model Call:")).toBeVisible();
    expect(page.url()).toContain(TRANSCRIPT_ID);

    // The adjacent-ids query resolves asynchronously; retry until the
    // shortcut has its next target and the URL flips to the sibling.
    await expect(async () => {
      await page.keyboard.press("ArrowRight");
      expect(page.url()).toContain(nextTranscriptId);
    }).toPass();
  });

  test("ArrowRight on the focus page lands on the sibling's focus route", async ({
    page,
    network,
  }) => {
    const nextTranscriptId = "t-events-002";
    network.use(
      http.post("*/api/v2/transcripts/:dir", () =>
        HttpResponse.json<TranscriptsResponse>(
          createTranscriptsResponse([
            createTranscriptInfo({ transcript_id: TRANSCRIPT_ID }),
            createTranscriptInfo({ transcript_id: nextTranscriptId }),
          ])
        )
      )
    );

    const modelEvent = createModelEvent({
      uuid: "model-evt-1",
      startSec: 2,
      endSec: 5,
      content: "Here is my analysis of the code.",
    });
    mockTranscript(network, [modelEvent]);

    const encodedDir = encodeBase64Url(TRANSCRIPTS_DIR);
    await page.goto(
      `/#/transcripts/${encodedDir}/${TRANSCRIPT_ID}/event?event=model-evt-1`
    );
    await expect(
      page.getByText("Here is my analysis of the code.").first()
    ).toBeVisible();

    // Sibling navigation must stay in focus mode: same single-event route
    // pattern, different transcript id.
    await expect(async () => {
      await page.keyboard.press("ArrowRight");
      expect(page.url()).toMatch(
        new RegExp(`/transcripts/[^/]+/${nextTranscriptId}/event`)
      );
    }).toPass();
    await expect(
      page.getByText("Here is my analysis of the code.").first()
    ).toBeVisible();
  });

  test("sibling hop and return open at the top with expanded chrome; within-visit tab flips restore the position", async ({
    page,
    network,
  }) => {
    // Delayed (800ms) loads on every hop plus real-time debounce/settle
    // windows put this journey past the default budget under parallel load.
    test.slow();
    // TranscriptPanel isn't remounted across an ArrowRight sibling hop: same
    // route element, only :transcriptId changes. The scroll container and the
    // VirtualList's position snapshot (keyed by list id + swimlane selection,
    // NOT transcript id) both survive the hop, so a bare landing on the
    // sibling can inherit transcript A's offset clamped to B's shorter
    // content. The delayed response mirrors the real multi-second fetch — an
    // instant mock can resolve within one render pass and mask the carried
    // offset. Origin lands via a deep link (nav-owned, collapsed chrome) and
    // is then scrolled further down by hand, covering both the nav-ownership
    // and natural-scroll paths before the hop.
    const nextTranscriptId = "t-events-002";

    // Long, varied turns: the within-visit flip legs below need real scroll
    // room (and re-measure drift potential) on transcript A.
    const aEvents = Array.from({ length: 25 }, (_, i) =>
      createModelEvent({
        uuid: `model-evt-a-${i}`,
        startSec: i * 3,
        endSec: i * 3 + 2,
        content:
          `A turn ${i} response. ` +
          "Lorem ipsum dolor sit amet consectetur. ".repeat(
            [3, 60, 8, 90, 30, 45][i % 6] ?? 30
          ),
      })
    );
    const aMessages = Array.from({ length: 30 }, (_, i) => ({
      role: i % 2 === 0 ? ("user" as const) : ("assistant" as const),
      content:
        `flip message ${i}. ` +
        "Lorem ipsum dolor sit amet consectetur. ".repeat(15),
    }));
    // Enough turns to be genuinely scrollable (but far shorter than A's 25),
    // so a mis-scoped restore/carryover clamps to a visibly non-zero offset
    // instead of landing at 0 by sheer coincidence of B fitting the viewport.
    const bEvents = Array.from({ length: 8 }, (_, i) =>
      createModelEvent({
        uuid: `model-evt-b-${i}`,
        startSec: i * 3,
        endSec: i * 3 + 2,
        content: `B turn ${i} response`,
      })
    );

    network.use(
      http.post("*/api/v2/transcripts/:dir", () =>
        HttpResponse.json<TranscriptsResponse>(
          createTranscriptsResponse([
            createTranscriptInfo({ transcript_id: TRANSCRIPT_ID }),
            createTranscriptInfo({ transcript_id: nextTranscriptId }),
          ])
        )
      ),
      http.get("*/api/v2/transcripts/:dir/:id/info", ({ params }) =>
        HttpResponse.json<TranscriptInfo>(
          createTranscriptInfo({
            transcript_id: params.id as string,
          })
        )
      ),
      http.get(
        "*/api/v2/transcripts/:dir/:id/messages-events",
        async ({ params }) => {
          const isNext = params.id === nextTranscriptId;
          // Realistic per-transcript latency: the user's reality is
          // seconds, and an instant response can resolve within a single
          // render pass (no intervening commit), which masks the stale
          // offset (and the record/restore races) this test targets.
          await delay(800);
          return HttpResponse.json<MessagesEventsResponse>(
            createMessagesEventsResponse({
              events: isNext ? bEvents : aEvents,
              messages: isNext ? [] : aMessages,
            })
          );
        }
      )
    );

    const encodedDir = encodeBase64Url(TRANSCRIPTS_DIR);
    await page.goto(
      `/#/transcripts/${encodedDir}/${TRANSCRIPT_ID}?tab=transcript-events&event=model-evt-a-10`
    );
    await expect(page.getByText("A turn 10 response").first()).toBeVisible();

    const isChromeCollapsed = () =>
      page.evaluate(() => {
        const el = Array.from(document.querySelectorAll("div")).find((e) =>
          (e.getAttribute("class") ?? "").includes("_titleHeadroom_")
        );
        return (
          !!el && (el.getAttribute("class") ?? "").includes("_titleHidden_")
        );
      });
    // Sanity: the deep-link landing itself starts collapsed (nav-owned).
    await expect.poll(isChromeCollapsed).toBe(true);

    const findScroller = () =>
      page.evaluate(() => {
        const scrollers = Array.from(
          document.querySelectorAll<HTMLElement>("*")
        ).filter(
          (el) =>
            /(auto|scroll)/.test(getComputedStyle(el).overflowY) &&
            el.scrollHeight > el.clientHeight + 50
        );
        return scrollers.sort((a, b) => b.scrollHeight - a.scrollHeight)[0]
          ?.dataset.e2eScrollerId;
      });

    // Tag the scroller so it can be reliably reselected after the sibling
    // hop swaps its content (element identity may or may not survive).
    await page.evaluate(() => {
      const scrollers = Array.from(
        document.querySelectorAll<HTMLElement>("*")
      ).filter(
        (el) =>
          /(auto|scroll)/.test(getComputedStyle(el).overflowY) &&
          el.scrollHeight > el.clientHeight + 50
      );
      const sc = scrollers.sort((a, b) => b.scrollHeight - a.scrollHeight)[0];
      if (sc) sc.dataset.e2eScrollerId = "transcript-scroller";
    });
    expect(await findScroller()).toBe("transcript-scroller");

    // Scroll deep into transcript A, well past the fold.
    await page.evaluate(() => {
      const sc = document.querySelector<HTMLElement>(
        '[data-e2e-scroller-id="transcript-scroller"]'
      );
      // Deep, but not all the way to the very bottom — the headroom's
      // scroll-direction tracker treats the true bottom as overscroll
      // bounce and ignores it (never collapses from there).
      if (sc)
        sc.scrollTop = Math.max(0, sc.scrollHeight - sc.clientHeight - 400);
    });
    await page.waitForTimeout(1300); // let the debounced position-snapshot record
    const deepScrollTop = await page.evaluate(() => {
      const sc = document.querySelector<HTMLElement>(
        '[data-e2e-scroller-id="transcript-scroller"]'
      );
      return sc?.scrollTop ?? 0;
    });
    expect(deepScrollTop).toBeGreaterThan(300);
    // Still collapsed after the extra manual scroll (natural-scroll path
    // agrees with the nav-owned path from the deep-link landing).
    await expect.poll(isChromeCollapsed).toBe(true);

    await expect(async () => {
      await page.keyboard.press("ArrowRight");
      expect(page.url()).toContain(nextTranscriptId);
    }).toPass();
    expect(page.url()).not.toMatch(/[?&](event|message)=/);

    await expect(page.getByText("B turn 0 response").first()).toBeVisible({
      timeout: 5000,
    });

    const topScrollTop = () =>
      page.evaluate(() => {
        const scrollers = Array.from(
          document.querySelectorAll<HTMLElement>("*")
        ).filter(
          (el) =>
            /(auto|scroll)/.test(getComputedStyle(el).overflowY) &&
            el.scrollHeight > el.clientHeight + 50
        );
        const sc = scrollers.sort((a, b) => b.scrollHeight - a.scrollHeight)[0];
        return sc?.scrollTop ?? -1;
      });

    // Must land at the TOP, not transcript A's stale offset clamped to B's
    // (much shorter) content.
    await expect.poll(topScrollTop, { timeout: 3000 }).toBeLessThanOrEqual(10);

    // ...and expanded chrome, matching a fresh/direct visit.
    await expect.poll(isChromeCollapsed).toBe(false);

    // RETURNING to A must not restore its earlier visit's offset either: a
    // return is a fresh visit and opens at the top — the per-transcript
    // snapshot recorded during A's deep scroll above must not resurface on
    // the remounted list.
    await expect(async () => {
      await page.keyboard.press("ArrowLeft");
      expect(page.url()).toContain(TRANSCRIPT_ID);
    }).toPass();
    await expect(page.getByText("A turn 0 response").first()).toBeVisible({
      timeout: 5000,
    });
    // Give any late restore its window, then require a SETTLED top.
    await page.waitForTimeout(1500);
    await expect.poll(topScrollTop, { timeout: 3000 }).toBeLessThanOrEqual(10);

    // WITHIN-VISIT tab flips still restore — the deliberate counterpart of
    // the fresh-visit top landing above. Two regressions, on this same
    // (fresh) visit to A:
    // 1) events -> messages -> events lands back where the user was (a
    //    one-shot scrollTop write against a freshly remounted virtualized
    //    list lands on interim row measurements and drifts by the re-measure
    //    delta);
    // 2) a flip INSIDE the recorder's debounce window must not lose the
    //    position — the pending record is flushed with the value captured at
    //    scroll time, not cancelled.
    //
    // Tolerance: the restore is a single scrollTop write against a freshly
    // remounted virtualizer (DEFAULT_ITEM_HEIGHT_PX estimate, no re-issue/
    // settle loop — pixel accuracy is deliberately not guaranteed), so it
    // lands within the straddling row's re-measure delta of the recorded
    // offset — deterministic
    // ~77/94px here on CI Linux font metrics (deeper scroll -> taller straddle
    // row). 120px stays well under one 400px row, so it still fails a top reset
    // (~1000px off) or a full-row miss; it only tolerates the sub-row drift.
    const RESTORE_REMEASURE_TOLERANCE_PX = 120;
    const flipToMessagesAndBack = async () => {
      await page.getByRole("tab", { name: "Messages" }).first().click();
      await expect(page.getByText("flip message 0").first()).toBeVisible();
      await page.waitForTimeout(400);
      await page.getByRole("tab", { name: "Events" }).first().click();
      // Not turn 0's text: a successful restore lands deep, where turn 0 is
      // virtualized out. The tab state is the reliable switch signal.
      await expect(
        page.getByRole("tab", { name: "Events" }).first()
      ).toHaveAttribute("aria-selected", "true");
    };

    // 1) Scroll deep, let the recorder save it (real time: it debounces),
    // and flip.
    await page.mouse.move(700, 400);
    await page.mouse.wheel(0, 3000);
    await page.waitForTimeout(1300);
    const scrolled = await topScrollTop();
    expect(scrolled).toBeGreaterThan(1000);
    await flipToMessagesAndBack();
    await expect
      .poll(async () => Math.abs((await topScrollTop()) - scrolled), {
        timeout: 4000,
      })
      .toBeLessThanOrEqual(RESTORE_REMEASURE_TOLERANCE_PX);
    // The position must SETTLE there, not drift after the poll first matches.
    await page.waitForTimeout(800);
    expect(Math.abs((await topScrollTop()) - scrolled)).toBeLessThanOrEqual(
      RESTORE_REMEASURE_TOLERANCE_PX
    );

    // 2) Scroll further and flip almost immediately — inside the debounce
    // window (deliberately NOT waiting for the record; that gap is the pin).
    await page.mouse.wheel(0, 1500);
    await page.waitForTimeout(150);
    const quickScrolled = await topScrollTop();
    expect(quickScrolled).toBeGreaterThan(scrolled + 500);
    await flipToMessagesAndBack();
    await expect
      .poll(async () => Math.abs((await topScrollTop()) - quickScrolled), {
        timeout: 4000,
      })
      .toBeLessThanOrEqual(RESTORE_REMEASURE_TOLERANCE_PX);
    await page.waitForTimeout(800);
    expect(
      Math.abs((await topScrollTop()) - quickScrolled)
    ).toBeLessThanOrEqual(RESTORE_REMEASURE_TOLERANCE_PX);
  });
});
