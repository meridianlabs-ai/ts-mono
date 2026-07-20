/**
 * E2E coverage for transcript turn navigation: j/k keyboard stepping, the
 * per-event-header turn chevrons + focus-view control, and the standalone
 * single-event page.
 */
import { delay, http, HttpResponse } from "msw";

import type {
  ChatMessage,
  EvalSample,
  ModelEvent,
  ModelOutput,
} from "@tsmono/inspect-common/types";

import { expect, test } from "./fixtures/app";
import {
  createEvalLog,
  createEvalSample,
  createLogDetails,
  createModelOutput,
} from "./fixtures/test-data";

const LOG_FILE = "test-turnnav.json";
type Events = EvalSample["events"];

function createModelEvent(uuid: string, content: string): ModelEvent {
  const output: ModelOutput = {
    ...createModelOutput(content),
    usage: { input_tokens: 60, output_tokens: 40, total_tokens: 100 },
    time: 3,
  };
  return {
    event: "model",
    uuid,
    model: "claude-sonnet-4-5-20250929",
    input: [{ role: "user", content: "Question", id: null }],
    output,
    config: {},
    tools: [],
    tool_choice: "auto",
    timestamp: "2025-01-15T10:00:00Z",
    working_start: 0,
    working_time: 3,
    error: null,
    traceback_ansi: null,
  };
}

async function openTranscript(
  page: Parameters<Parameters<typeof test>[2]>[0]["page"],
  network: Parameters<Parameters<typeof test>[2]>[0]["network"],
  events: Events,
  options?: {
    /** Sample user message — becomes the (tall) expanded summary header. */
    userMessage?: string;
    /** Open with an `?event=` deep link instead of at the top. */
    eventId?: string;
    /** Sample-level eval error (the errored/cancelled-sample banner). */
    sampleError?: string;
    /** Delay the log-contents responses the way a real backend's fetch takes
     *  seconds — an instant mock can resolve within a single render pass and
     *  mask stale-offset races. */
    delayMs?: number;
  }
) {
  const messages: ChatMessage[] = options?.userMessage
    ? [{ role: "user", content: options.userMessage, id: "user-1" }]
    : [];
  const sample = createEvalSample({ id: 1, epoch: 1, messages });
  (sample as { events: Events }).events = events;
  if (options?.sampleError) {
    (sample as { error?: unknown }).error = {
      message: options.sampleError,
      traceback: `Traceback: ${options.sampleError}`,
      traceback_ansi: `Traceback: ${options.sampleError}`,
    };
  }
  const evalLog = createEvalLog({ samples: [sample] });
  const logDetails = createLogDetails(evalLog);

  network.use(
    // get_log_root — the dir-mode gate blocks on this.
    http.get("*/api/logs", () => HttpResponse.json({ log_dir: "/logs" })),
    http.get("*/api/log-files*", () =>
      HttpResponse.json({
        files: [{ name: LOG_FILE, task: "turnnav", task_id: "turnnav" }],
        response_type: "full",
      })
    ),
    http.get("*/api/logs/:file", async () => {
      if (options?.delayMs) await delay(options.delayMs);
      return HttpResponse.json(evalLog);
    }),
    http.get("*/api/log-headers*", () =>
      HttpResponse.json([
        {
          eval_id: logDetails.eval.eval_id,
          run_id: logDetails.eval.run_id,
          task: logDetails.eval.task,
          task_id: logDetails.eval.task_id,
          task_version: logDetails.eval.task_version,
          model: logDetails.eval.model,
          status: logDetails.status,
          started_at: logDetails.stats?.started_at,
          completed_at: logDetails.stats?.completed_at,
        },
      ])
    )
  );

  const encodedFile = encodeURIComponent(LOG_FILE);
  const eventParam = options?.eventId ? `?event=${options.eventId}` : "";
  await page.goto(
    `/#/logs/${encodedFile}/samples/sample/1/1/transcript${eventParam}`
  );
}

const longBody = (label: string) =>
  `${label}. ` + "Lorem ipsum dolor sit amet. ".repeat(40);

const threeTurns: Events = [
  createModelEvent("turn-a", longBody("First turn response")),
  createModelEvent("turn-b", longBody("Second turn response")),
  createModelEvent("turn-c", longBody("Third turn response")),
];

// Many tall turns with wildly varying heights so the list virtualizes - needed
// for the "re-navigating to a turn lands at the same position" test below to be
// meaningful (uniform or short rows don't exercise it).
const varyBody = (label: string, lines: number) =>
  `${label}. ` + "Lorem ipsum dolor sit amet consectetur. ".repeat(lines);

// A tall first turn so the focus view's scroll container actually scrolls,
// followed by a short one — for the "focus resets scroll on turn nav" test.
const tallBody = (label: string) =>
  `${label}. ` + "Lorem ipsum dolor sit amet consectetur. ".repeat(300);
// Both turns tall so the focus container is scrollable before AND after the
// jump — otherwise the post-jump scrollTop can't be measured.
const twoTallTurns: Events = [
  createModelEvent("tall", tallBody("Tall first turn")),
  createModelEvent("tall2", tallBody("Tall second turn")),
];

// A leading non-turn (info) row before the first model turn, to exercise the
// "first j from above turn 1 lands on turn 1, not turn 2" case.
// Several pre-turn info rows. Real transcripts open with substantial pre-turn
// content (sample init, system + user messages) that fills the viewport before
// the first model turn; the test below needs turn 1 to genuinely sit BELOW the
// detection line (`offsetTop` + tolerance under the sticky chrome), so a single
// short info row — which renders under the chrome and leaves turn 1 already at
// the top — would make "sit above turn 1" untrue and the result chrome-height
// dependent. A stack of rows reproduces the realistic tall preamble.
const infoRows: Events = Array.from(
  { length: 6 },
  (_, i) =>
    ({
      event: "info",
      uuid: `pre-info-${i}`,
      timestamp: "2025-01-15T09:59:00Z",
      working_start: 0,
      source: null,
      data: `Seed instructions line ${i} shown before the first turn.`,
    }) as unknown as Events[number]
);
const preTurnThenTurns: Events = [...infoRows, ...threeTurns];

const manyTurns: Events = Array.from({ length: 20 }, (_, i) =>
  createModelEvent(
    `turn-${String(i).padStart(2, "0")}`,
    varyBody(`Turn ${i} response`, [3, 160, 8, 220, 30, 120][i % 6] ?? 60)
  )
);

// Top of `#<eventId>` relative to the top of its scroll container, in px.
async function eventTopInScroller(
  page: Parameters<Parameters<typeof test>[2]>[0]["page"],
  eventId: string
): Promise<number> {
  return page.evaluate((id) => {
    const el = document.getElementById(id);
    if (!el) return Number.NaN;
    let sc: HTMLElement | null = el;
    while (sc && !/(auto|scroll)/.test(getComputedStyle(sc).overflowY)) {
      sc = sc.parentElement;
    }
    const scTop = sc ? sc.getBoundingClientRect().top : 0;
    return el.getBoundingClientRect().top - scTop;
  }, eventId);
}

test.describe("transcript turn navigation", () => {
  test("model headers show turn nav chevrons + focus-view link", async ({
    page,
    network,
  }) => {
    await openTranscript(page, network, threeTurns);
    await expect(page.getByText("turn 1/3").first()).toBeVisible();

    await expect(
      page.getByRole("button", { name: "Next turn" }).first()
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Previous turn" }).first()
    ).toBeVisible();

    const openLink = page
      .getByRole("link", { name: "Open focused turn view" })
      .first();
    await expect(openLink).toHaveAttribute("href", /\/event\?event=/);
  });

  test("first j from a fresh load lands on turn 1; second j on turn 2", async ({
    page,
    network,
  }) => {
    // A preamble (like the neighboring "first j from above turn 1" test)
    // makes turn 1 genuinely sit below the detection line at load — without
    // it (a bare threeTurns fixture with no pre-turn content), a slow-enough
    // paint can let the scroll tracker report turn-a as already at the top
    // BEFORE this test's first keypress, which makes first-j legitimately
    // land turn-b instead of turn-a: a real race, not a wrong expectation,
    // and flaky under load rather than reliably red or green.
    await openTranscript(page, network, preTurnThenTurns);
    await expect(page.getByText("turn 1/3").first()).toBeVisible();

    const maxScrollTop = () =>
      page.evaluate(() =>
        Array.from(document.querySelectorAll<HTMLElement>("*")).reduce(
          (max, el) => Math.max(max, el.scrollTop),
          0
        )
      );

    const before = await maxScrollTop();
    // vim-style: j = next turn (down); k = previous (up). At a fresh load,
    // the scroll tracker hasn't reported the turn at the top yet, so current
    // is "unknown" (index -1) — the same state the pre-turn preamble (sample
    // init, system/user messages) leaves it in. j steps from there, so the
    // FIRST j lands on turn 1 (turn-a), not turn 2; only a SECOND j reaches
    // turn-b. (No wait before this first press — asserting it fires
    // instantly, before any report, is the point.)
    await page.keyboard.press("j");
    await page.waitForTimeout(800);
    const afterFirst = await maxScrollTop();
    expect(afterFirst).toBeGreaterThan(before);
    // Turn 1's landing, not just "scrolled somewhere".
    const firstArrival = await eventTopInScroller(page, "turn-a");
    expect(firstArrival).toBeGreaterThan(-30);
    expect(firstArrival).toBeLessThan(130);

    await page.keyboard.press("j");
    await page.waitForTimeout(800);
    const afterSecond = await maxScrollTop();
    expect(afterSecond).toBeGreaterThan(afterFirst);
    // And now TURN 2's landing (no persistent selection carried the index
    // past where it belongs).
    const secondArrival = await eventTopInScroller(page, "turn-b");
    expect(secondArrival).toBeGreaterThan(-30);
    expect(secondArrival).toBeLessThan(130);
  });

  test("re-navigating to a turn lands at the same position every time", async ({
    page,
    network,
  }) => {
    await page.setViewportSize({ width: 1200, height: 800 });
    await openTranscript(page, network, manyTurns);
    await expect(page.getByText("turn 1/20").first()).toBeVisible();

    // Land on a far turn via deep-link (the fresh-page-load reference), then
    // bounce away and back to the same turn in-page (no reload). Both arrivals
    // must land at the same spot.
    const encodedFile = encodeURIComponent(LOG_FILE);
    await page.goto(
      `/#/logs/${encodedFile}/samples/sample/1/1/transcript?event=turn-15`
    );
    await expect(page.locator("#turn-15")).toBeVisible();
    await page.waitForTimeout(900);
    const firstArrival = await eventTopInScroller(page, "turn-15");

    await page.keyboard.press("j");
    await page.waitForTimeout(800);
    // The bounce must actually leave turn-15 (a no-op j+k would vacuously
    // "land at the same position").
    const away = await eventTopInScroller(page, "turn-15");
    expect(Math.abs(away - firstArrival)).toBeGreaterThan(100);
    await page.keyboard.press("k");
    await page.waitForTimeout(800);
    const secondArrival = await eventTopInScroller(page, "turn-15");

    expect(Math.abs(secondArrival - firstArrival)).toBeLessThan(2);
  });

  test("first j from above turn 1 lands on turn 1 (not turn 2)", async ({
    page,
    network,
  }) => {
    await openTranscript(page, network, preTurnThenTurns);
    await expect(page.getByText("turn 1/3").first()).toBeVisible();

    // Sit at the very top, where the pre-turn info rows are the topmost content
    // and turn 1 is below the fold. Dispatch a scroll so the scroll-spy that
    // feeds currentTurnIndex re-evaluates against this position.
    await page.evaluate(() => {
      const sc = Array.from(document.querySelectorAll<HTMLElement>("*")).find(
        (e) =>
          /(auto|scroll)/.test(getComputedStyle(e).overflowY) &&
          e.scrollHeight > e.clientHeight + 50
      );
      if (sc) {
        sc.scrollTop = 0;
        sc.dispatchEvent(new Event("scroll"));
      }
    });
    await page.locator("body").click({ position: { x: 700, y: 400 } });
    // Press immediately: initial navigation state must already represent
    // "above turn 1", without waiting for the scroll tracker's backstop.
    await page.keyboard.press("j");
    await page.waitForTimeout(700);

    // Literal fixture id: turn 1 is "turn-a" — deriving the expectation from
    // the page's own focus links could share a wrong anchor list with j.
    const ev = page.url().match(/event=([^&]+)/)?.[1];
    expect(ev).toBe("turn-a"); // turn 1, not "turn-b" (turn 2)
  });

  test("deep-link landing stays on target while the summary header collapses", async ({
    page,
    network,
  }) => {
    // Deep-link landings force-collapse the summary header (chrome follows
    // navigation); the landing settle re-issues the jump each frame, so any
    // chrome height change during it is re-corrected. Two invariants:
    //
    // 1. No expanded flash: a deep-link mount renders the header collapsed
    //    from the FIRST frame (useScrollDirection's initialHidden in
    //    SampleDisplay) instead of painting the expanded header and blinking
    //    it away when the landing force-collapses it. SampleSummaryView
    //    renders both variants as the same heading <div> whose child div
    //    carries `_layout_` (expanded) or `_collapsedMeta_` (collapsed);
    //    React reconciles them into one element, so a mount-expanded →
    //    force-collapse transition is a class flip. The MutationObserver
    //    below records the variant's class at DOM insertion and, via
    //    attributeOldValue, the PRE-change class of every flip (live reads
    //    post-date the microtask batch — a same-batch flip is only visible
    //    through oldValue) — verified to fail with initialHidden disabled.
    //    Class matching relies on dev-server CSS-module naming
    //    (`_layout_hash` / `_collapsedMeta_hash`), which is what the
    //    Playwright webServer (`pnpm dev`) serves. The swimlane headroom is
    //    NOT observed: this fixture (bare model events, no timeline spans)
    //    never shows the swimlane strip, so its marker can't flip here.
    //
    // 2. End state (the poll below): the target row sits at the viewport top
    //    band. Still an invariant guard for the GEOMETRY race — this fixture
    //    could not reproduce the original bug (the late-collapse shift
    //    self-heals via the virtualizer's reconcile here, and the mocks
    //    serve summary+events in one response, so the cached-summary blink
    //    can't occur).
    await page.addInitScript(() => {
      const log: string[] = [];
      (window as unknown as { __headerClassLog: string[] }).__headerClassLog =
        log;
      const cls = (el: Element) => el.getAttribute("class") ?? "";
      const isVariant = (c: string) =>
        c.includes("_layout_") || c.includes("_collapsedMeta_");
      // Scope to the summary heading so `_layout_` classes from other
      // CSS modules (none today, but hashes only namespace per-file locals)
      // can never satisfy or trip the invariant.
      const inHeading = (el: Element) =>
        !!el.closest("[id^='sample-heading-']");
      const observer = new MutationObserver((mutations) => {
        for (const m of mutations) {
          if (m.type === "attributes" && m.target instanceof Element) {
            const oldClass = m.oldValue ?? "";
            const newClass = cls(m.target);
            if (
              (isVariant(oldClass) || isVariant(newClass)) &&
              inHeading(m.target)
            ) {
              log.push(oldClass);
              log.push(newClass);
            }
          }
          // If React ever swaps the variant nodes instead of flipping the
          // class in place, the childList records catch it: an added node
          // logs its (live) class, a removed expanded node is direct proof.
          for (const node of m.addedNodes) {
            if (!(node instanceof Element)) continue;
            const candidates = [
              node,
              ...node.querySelectorAll(
                "[class*='_layout_'], [class*='_collapsedMeta_']"
              ),
            ];
            for (const el of candidates) {
              if (isVariant(cls(el)) && inHeading(el)) log.push(cls(el));
            }
          }
          for (const node of m.removedNodes) {
            // Detached nodes have no heading ancestor; the variant classes
            // are unique to SampleSummaryView, so match on class alone.
            if (node instanceof Element && isVariant(cls(node)))
              log.push(cls(node));
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

    await openTranscript(page, network, manyTurns, {
      userMessage:
        "Sample input. " +
        "A long wordy question that makes the expanded header tall. ".repeat(
          20
        ),
      eventId: "turn-10",
    });
    await expect(page.getByText("Turn 10 response").first()).toBeVisible();

    // Poll until the landing + chrome geometry settle, then assert the first
    // turn row at the viewport top band is the target (not turn-09).
    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const sc = Array.from(
              document.querySelectorAll<HTMLElement>("*")
            ).find(
              (e) =>
                /(auto|scroll)/.test(getComputedStyle(e).overflowY) &&
                e.scrollHeight > e.clientHeight + 50
            );
            const top = sc ? sc.getBoundingClientRect().top : 0;
            for (let y = top + 4; y < top + 500; y += 8) {
              const row = document
                .elementFromPoint(700, y)
                ?.closest?.('[id^="turn-"]');
              if (row) return row.id;
            }
            return null;
          }),
        { timeout: 5000 }
      )
      .toBe("turn-10");

    // No-flash invariant: the header variant was already collapsed when it
    // entered the DOM, and every observed pre-change state during the landing
    // was collapsed too. A single `_layout_` sighting — as an insertion, an
    // attributeOldValue, or a removed node — is the expanded flash.
    const log = await page.evaluate(
      () =>
        (window as unknown as { __headerClassLog: string[] }).__headerClassLog
    );
    expect(log.shift()).toBe("__observer_installed__");
    // Non-vacuous: the collapsed variant must actually have been observed —
    // an empty log means the class markers drifted, not that nothing flashed.
    expect(log.length).toBeGreaterThan(0);
    for (const entry of log) {
      expect(entry).toContain("_collapsedMeta_");
      expect(entry).not.toContain("_layout_");
    }
  });

  test("chevron-click navigation lands on target while the chrome collapses", async ({
    page,
    network,
  }) => {
    // A click-initiated navigation starts inside its own pointerdown
    // interaction window; the landing settle must still correct the forced
    // chrome collapse (expanded header at top -> collapse shifts the target).
    await openTranscript(page, network, manyTurns, {
      userMessage:
        "Sample input. " +
        "A long wordy question that makes the expanded header tall. ".repeat(
          20
        ),
    });
    await expect(page.getByText("Turn 0 response").first()).toBeVisible();

    await page.getByRole("button", { name: "Next turn" }).first().click();
    await page.waitForTimeout(900);

    // The target's top must sit at the canonical landing (just under the
    // collapsed chrome, tuck included) — a settle aborted by the click's own
    // interaction window parks it a full expanded-header delta lower.
    const arrival = await eventTopInScroller(page, "turn-01");
    expect(arrival).toBeGreaterThan(-30);
    expect(arrival).toBeLessThan(130);
  });

  // Removed: "tab flips keep the position; scrolling between flips updates it".
  // Sample-tab pixel restore is main-parity; drift under latency is pre-existing
  // upstream — not a guarantee of this branch (owner descope ruling). The three
  // legs (return-from-Messages restore, hold-release, debounce-flush) all pinned
  // that deleted machinery; the surviving inspect guarantees (fresh-visit/sibling/
  // reload land at top) are covered by "scroll position does not leak between
  // samples" and "next-sample arrow starts the new sample at the top".

  test("exit from focus lands on the focused turn, not a stale saved position", async ({
    page,
    network,
  }) => {
    // The per-tab scroll restore must stand down on nav-owned (?event=)
    // mounts: exiting focus mode remounts the transcript deep-linked at the
    // focused turn, and a late restore of the pre-focus scroll position would
    // drag the view away from the landing (seen as "returns to turn 1").
    await openTranscript(page, network, manyTurns, { eventId: "turn-15" });
    await expect(page.getByText("Turn 15 response").first()).toBeVisible();
    await page.waitForTimeout(1400);

    // Scroll well away from the landing and let the debounced recorder save it.
    await page.mouse.move(700, 400);
    await page.mouse.wheel(0, -2500);
    await page.waitForTimeout(1300);

    await page.keyboard.press("f");
    await expect(page).toHaveURL(/\/event\?/);
    // Step several turns inside focus so the exit target is far from the
    // saved pre-focus position — a restore win is then clearly visible.
    for (let i = 0; i < 5; i++) {
      await page.keyboard.press("j");
      await page.waitForTimeout(80);
    }
    const focused = new URL(page.url().replace("/#/", "/")).searchParams.get(
      "event"
    );
    expect(focused).toBeTruthy();

    await page.keyboard.press("Escape");
    await expect(page).toHaveURL(/transcript\?event=/);
    // Wait out both the landing settle and the restore's polling window.
    await page.waitForTimeout(2000);
    const top = await eventTopInScroller(page, focused!);
    expect(top).toBeGreaterThanOrEqual(-5);
    expect(top).toBeLessThanOrEqual(120);
  });

  test("double f from a focus deep link round-trips to the same turn, not turn 1", async ({
    page,
    network,
  }) => {
    // User repro: on a focus page (?event=<id>&tab=Summary), pressing `f`
    // twice quickly must round-trip (exit to the transcript deep-linked at
    // the focused turn, then re-enter focus on that SAME turn) — not clamp to
    // turn 1. The second `f` can land on the freshly re-mounted transcript
    // before its scroll tracker's first report, while currentTurnIndexRef is
    // still its just-mounted "unknown" (-1); the buggy code then clamps `f`
    // to turn 1 exactly like it does for a genuine "above turn 1" viewport.
    // Deep-link straight to turn 2's focus page (not turn 1) so a wrong
    // landing on turn 1 is actually visible.
    await openTranscript(page, network, threeTurns);
    const encodedFile = encodeURIComponent(LOG_FILE);
    await page.goto(
      `/#/logs/${encodedFile}/samples/sample/1/1/event?event=turn-b&tab=Summary`
    );
    await expect(page.getByText("Second turn response").first()).toBeVisible();

    // First `f` exits to the transcript. Wait for a control unique to the
    // transcript's OWN chrome (not "Next turn", which both views render) so
    // the second `f` reliably reaches the NEW mount rather than a not-yet-
    // unmounted focus page — then fire it immediately, no extra sleep: that
    // mount's scroll tracker may not have reported yet, which is the gap this
    // test targets. A longer sleep here would dodge the race instead of
    // hitting it.
    await page.keyboard.press("f");
    await expect(page).toHaveURL(/transcript\?event=/);
    await expect(
      page.getByRole("link", { name: "Open focused turn view" }).first()
    ).toBeVisible();
    await page.keyboard.press("f");
    await page.waitForTimeout(700);

    await expect(page).toHaveURL(/\/event\?/);
    const ev = page.url().match(/event=([^&]+)/)?.[1];
    expect(ev).toBe("turn-b"); // turn 2, not "turn-a" (turn 1)
  });

  test("scroll position does not leak between samples", async ({
    page,
    network,
  }) => {
    // Four legs of delayed (800ms) loads plus real-time debounce/settle
    // windows put this journey past the default budget under parallel load.
    test.slow();
    // Fresh landings never inherit an earlier visit's offset. One journey,
    // under realistic backend latency (instant mocks can resolve within one
    // render pass and mask carried-over offsets):
    // 1) a DIFFERENT sample opens at the top, not the previous one's offset;
    // 2) returning to a previously-visited sample opens at the top too;
    // 3) leaving for the samples list and re-opening the SAME sample opens
    //    at the top (the sample's identity never changes on this path, so
    //    identity-keyed clearing alone cannot cover it);
    // 4) a reload opens at the top (the snapshots are in-memory state — no
    //    storage-backed persistence).
    const messages: ChatMessage[] = [];
    const sampleA = createEvalSample({ id: 1, epoch: 1, messages });
    (sampleA as { events: Events }).events = manyTurns;
    const sampleB = createEvalSample({ id: 2, epoch: 1, messages });
    (sampleB as { events: Events }).events = manyTurns;
    const evalLog = createEvalLog({ samples: [sampleA, sampleB] });
    const logDetails = createLogDetails(evalLog);
    network.use(
      http.get("*/api/logs", () => HttpResponse.json({ log_dir: "/logs" })),
      http.get("*/api/log-files*", () =>
        HttpResponse.json({ files: [{ name: LOG_FILE }] })
      ),
      http.get("*/api/logs/:file", async () => {
        await delay(800);
        return HttpResponse.json(evalLog);
      }),
      http.get("*/api/log-headers*", () =>
        HttpResponse.json([
          {
            eval_id: logDetails.eval.eval_id,
            run_id: logDetails.eval.run_id,
            task: logDetails.eval.task,
            task_id: logDetails.eval.task_id,
            task_version: logDetails.eval.task_version,
            model: logDetails.eval.model,
            status: logDetails.status,
            started_at: logDetails.stats?.started_at,
            completed_at: logDetails.stats?.completed_at,
          },
        ])
      )
    );
    const mainScrollTop = () =>
      page.evaluate(() => {
        const scrollers = Array.from(document.querySelectorAll("*")).filter(
          (el) =>
            /(auto|scroll)/.test(getComputedStyle(el).overflowY) &&
            el.scrollHeight > el.clientHeight + 50
        );
        const sc = scrollers.sort((a, b) => b.scrollHeight - a.scrollHeight)[0];
        return sc ? sc.scrollTop : -1;
      });
    const scrollDeepAndRecord = async () => {
      await page.mouse.move(700, 400);
      await page.mouse.wheel(0, 3000);
      await page.waitForTimeout(1300); // real time: the recorder debounces
      expect(await mainScrollTop()).toBeGreaterThan(1000);
    };
    // The offset must not just start near the top and drift back later —
    // poll until it SETTLES at the top (restores fire on delayed frames).
    const expectSettledAtTop = async () => {
      await page.waitForTimeout(1500);
      await expect
        .poll(mainScrollTop, { timeout: 4000 })
        .toBeLessThanOrEqual(150);
      expect(await mainScrollTop()).toBeGreaterThanOrEqual(0);
    };

    const encodedFile = encodeURIComponent(LOG_FILE);
    await page.goto(`/#/logs/${encodedFile}/samples/sample/1/1/transcript`);
    await expect(page.getByText("Turn 0 response").first()).toBeVisible({
      timeout: 15000,
    });
    await page.waitForTimeout(600);
    await scrollDeepAndRecord();

    // 1) In-SPA navigation to sample 2 (a reload would clear the in-memory
    // store and mask the leak).
    await page.evaluate(() => {
      window.location.hash = window.location.hash.replace(
        "/sample/1/1/",
        "/sample/2/1/"
      );
    });
    await expect(page.getByText("Sample 2")).toBeVisible();
    await expectSettledAtTop();

    // 2) Scroll sample 2 too, then RETURN to sample 1: a previously-visited
    // sample is a fresh visit — neither its own saved offset nor sample 2's
    // live one may show through.
    await scrollDeepAndRecord();
    await page.evaluate(() => {
      window.location.hash = window.location.hash.replace(
        "/sample/2/1/",
        "/sample/1/1/"
      );
    });
    await expect(page.getByText("Sample 1")).toBeVisible();
    await expectSettledAtTop();

    // 3) Leave for the samples list and re-open the SAME sample.
    await scrollDeepAndRecord();
    await page.evaluate(() => {
      window.location.hash = window.location.hash.replace(
        /\/samples\/sample\/1\/1\/transcript$/,
        "/samples"
      );
    });
    await expect(page).toHaveURL(/\/samples$/);
    await page.waitForTimeout(600);
    await page.evaluate(() => {
      window.location.hash = window.location.hash.replace(
        /\/samples$/,
        "/samples/sample/1/1/transcript"
      );
    });
    await expect(page.getByText("Turn 0 response").first()).toBeVisible({
      timeout: 15000,
    });
    await expectSettledAtTop();

    // 4) Reload coherence: a reload is a fresh visit too.
    await scrollDeepAndRecord();
    await page.reload();
    await expect(page.getByText("Turn 0 response").first()).toBeVisible({
      timeout: 15000,
    });
    await expectSettledAtTop();
  });

  test("next-sample arrow starts the new sample at the top", async ({
    page,
    network,
  }) => {
    // The header > navigation (unlike a URL hop) must not inherit the
    // previous sample's scroll offset or land mid-content.
    const messages: ChatMessage[] = [];
    const sampleA = createEvalSample({ id: 1, epoch: 1, messages });
    (sampleA as { events: Events }).events = manyTurns;
    const sampleB = createEvalSample({ id: 2, epoch: 1, messages });
    (sampleB as { events: Events }).events = manyTurns;
    const evalLog = createEvalLog({ samples: [sampleA, sampleB] });
    const logDetails = createLogDetails(evalLog);
    network.use(
      http.get("*/api/logs", () => HttpResponse.json({ log_dir: "/logs" })),
      http.get("*/api/log-files*", () =>
        HttpResponse.json({ files: [{ name: LOG_FILE }] })
      ),
      http.get("*/api/logs/:file", () => HttpResponse.json(evalLog)),
      http.get("*/api/log-headers*", () =>
        HttpResponse.json([
          {
            eval_id: logDetails.eval.eval_id,
            run_id: logDetails.eval.run_id,
            task: logDetails.eval.task,
            task_id: logDetails.eval.task_id,
            task_version: logDetails.eval.task_version,
            model: logDetails.eval.model,
            status: logDetails.status,
            started_at: logDetails.stats?.started_at,
            completed_at: logDetails.stats?.completed_at,
          },
        ])
      )
    );
    const encodedFile = encodeURIComponent(LOG_FILE);
    await page.goto(`/#/logs/${encodedFile}/samples/sample/1/1/transcript`);
    await expect(page.getByText("Turn 0 response").first()).toBeVisible();
    await page.waitForTimeout(600);
    await page.mouse.move(700, 400);
    await page.mouse.wheel(0, 3000);
    await page.waitForTimeout(1300);

    await page.getByRole("button", { name: "Next sample" }).click();
    await expect(page.getByText("Sample 2")).toBeVisible();
    // ArrowLeft / ArrowRight step samples from the keyboard (same actions).
    await page.keyboard.press("ArrowLeft");
    await expect(page.getByText("Sample 1")).toBeVisible();
    // User decree (t.60): the retired Shift+H/L chord must NOT navigate.
    await page.keyboard.press("Shift+L");
    await page.waitForTimeout(300);
    await expect(page.getByText("Sample 1")).toBeVisible();
    await page.keyboard.press("ArrowRight");
    await expect(page.getByText("Sample 2")).toBeVisible();
    await page.waitForTimeout(800);

    // REVISIT rule: coming back to a sample lands at the top — per-sample
    // position memory must not survive sample navigation (only tab flips
    // within one sample restore).
    await page.mouse.move(700, 400);
    await page.mouse.wheel(0, 2500);
    await page.waitForTimeout(1300);
    await page.keyboard.press("ArrowLeft");
    await expect(page.getByText("Sample 1")).toBeVisible();
    await page.waitForTimeout(800);
    await page.keyboard.press("ArrowRight");
    await expect(page.getByText("Sample 2")).toBeVisible();
    await page.waitForTimeout(1500);
    const revisitTop = await page.evaluate(() => {
      const scrollers = Array.from(document.querySelectorAll("*")).filter(
        (el) =>
          /(auto|scroll)/.test(getComputedStyle(el).overflowY) &&
          el.scrollHeight > el.clientHeight + 50
      );
      const sc = scrollers.sort((a, b) => b.scrollHeight - a.scrollHeight)[0];
      return sc ? sc.scrollTop : -1;
    });
    expect(revisitTop).toBeGreaterThanOrEqual(0);
    expect(revisitTop).toBeLessThanOrEqual(150);
    await page.waitForTimeout(1500);
    const scrollTop = await page.evaluate(() => {
      const scrollers = Array.from(document.querySelectorAll("*")).filter(
        (el) =>
          /(auto|scroll)/.test(getComputedStyle(el).overflowY) &&
          el.scrollHeight > el.clientHeight + 50
      );
      const sc = scrollers.sort((a, b) => b.scrollHeight - a.scrollHeight)[0];
      return sc ? sc.scrollTop : -1;
    });
    expect(scrollTop).toBeGreaterThanOrEqual(0);
    expect(scrollTop).toBeLessThanOrEqual(150);
  });

  test("focus view surfaces the sample error from every turn", async ({
    page,
    network,
  }) => {
    // A sample-level error is a property of the whole sample: the focus view
    // shows a persistent strip on every turn, and the LAST turn's slice keeps
    // the error card itself (the transcript renders it right after that turn).
    const errorEvent = {
      event: "error",
      uuid: "sample-err",
      timestamp: "2025-01-15T10:30:00Z",
      working_start: 0,
      error: {
        message: "Something exploded",
        traceback: "Traceback: Something exploded",
        traceback_ansi: "Traceback: Something exploded",
      },
    } as unknown as Events[number];
    await openTranscript(page, network, [...manyTurns, errorEvent], {
      eventId: "turn-05",
      sampleError: "Something exploded",
    });
    await expect(page.getByText("Turn 5 response").first()).toBeVisible();

    await page.keyboard.press("f");
    await expect(page).toHaveURL(/\/event\?/);
    // Strip is visible on a turn that is NOT the last one.
    const strip = page.getByRole("button", { name: /Sample error/ });
    await expect(strip).toBeVisible();

    // Clicking jumps to the last turn, whose slice carries the error card.
    await strip.click();
    await expect(page.getByText("Turn 19 response").first()).toBeVisible();
    await expect(
      page.getByText("Traceback: Something exploded").first()
    ).toBeVisible();
  });

  test("focus view resets scroll to top when navigating turns", async ({
    page,
    network,
  }) => {
    // Short viewport so the focused turn's content overflows and the focus
    // container actually scrolls.
    await page.setViewportSize({ width: 1000, height: 320 });
    await openTranscript(page, network, twoTallTurns);
    const href = await page
      .getByRole("link", { name: "Open focused turn view" })
      .first()
      .getAttribute("href");
    await page.goto(href!.replace(/^#/, "/#"));
    await expect(page.getByText("Tall first turn").first()).toBeVisible();

    // The focus scroll container is the one with overflow-y whose content
    // exceeds it; fall back to null so the assertion reports -1 clearly.
    const scrollTop = () =>
      page.evaluate(() => {
        const sc = Array.from(document.querySelectorAll<HTMLElement>("*")).find(
          (e) =>
            /(auto|scroll)/.test(getComputedStyle(e).overflowY) &&
            e.scrollHeight > e.clientHeight + 20
        );
        return sc ? sc.scrollTop : -1;
      });

    await page.evaluate(() => {
      const sc = Array.from(document.querySelectorAll<HTMLElement>("*")).find(
        (e) =>
          /(auto|scroll)/.test(getComputedStyle(e).overflowY) &&
          e.scrollHeight > e.clientHeight + 20
      );
      if (sc) sc.scrollTop = 150;
    });
    await page.waitForTimeout(200);
    expect(await scrollTop()).toBeGreaterThan(30);

    await page.locator("body").click({ position: { x: 500, y: 160 } });
    await page.keyboard.press("j"); // next turn
    await expect(page.getByText("Tall second turn").first()).toBeVisible();
    await page.waitForTimeout(700);
    expect(await scrollTop()).toBe(0);
  });

  test("single-event page renders only the target event", async ({
    page,
    network,
  }) => {
    await openTranscript(page, network, threeTurns);
    await expect(page.getByText("turn 1/3").first()).toBeVisible();

    const href = await page
      .getByRole("link", { name: "Open focused turn view" })
      .first()
      .getAttribute("href");
    expect(href).toMatch(/\/event\?event=/);

    await page.goto(href!.replace(/^#/, "/#"));

    await expect(page.getByText("Model Call:").first()).toBeVisible();
    await expect(page.getByText("First turn response").first()).toBeVisible();
    await expect(page.getByText("Third turn response")).toHaveCount(0);
  });

  test("held k (auto-repeat) steps back exactly once per press, not fewer", async ({
    page,
    network,
  }) => {
    // Ground truth is the `?event=` URL param — the same signal
    // onNavigatedToEvent writes on every landing — not DOM geometry, which
    // virtualizer overscan makes unreliable for "which turn is current".
    const currentEvent = () => page.url().match(/event=([^&]+)/)?.[1] ?? null;

    await openTranscript(page, network, manyTurns, { eventId: "turn-14" });
    await expect(page.getByText("turn 15/20").first()).toBeVisible();
    await page.waitForTimeout(600);
    expect(currentEvent()).toBe("turn-14");

    // 8 presses at 30ms (approximating OS key-repeat) must land exactly 8
    // turns back, same as a fully-settled slow press would — regardless of
    // press cadence. (k is a synchronous index decision, same as j — no
    // settle to race.)
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press("k");
      await page.waitForTimeout(30);
    }
    await page.waitForTimeout(1500);
    expect(currentEvent()).toBe("turn-06");
  });

  test("held j and held k traverse the same number of turns for the same press count", async ({
    page,
    network,
  }) => {
    // k is the exact mirror of j (goToTurn(idx - 1) vs goToTurn(idx + 1)), so
    // a held burst of either must move the same distance, just in opposite
    // directions — no asymmetric settle/confirm step on either side.
    const currentEvent = () => page.url().match(/event=([^&]+)/)?.[1] ?? null;

    await openTranscript(page, network, manyTurns, { eventId: "turn-10" });
    await expect(page.getByText("turn 11/20").first()).toBeVisible();
    await page.waitForTimeout(600);
    expect(currentEvent()).toBe("turn-10");

    for (let i = 0; i < 6; i++) {
      await page.keyboard.press("j");
      await page.waitForTimeout(30);
    }
    await page.waitForTimeout(1500);
    expect(currentEvent()).toBe("turn-16");

    for (let i = 0; i < 6; i++) {
      await page.keyboard.press("k");
      await page.waitForTimeout(30);
    }
    await page.waitForTimeout(1500);
    expect(currentEvent()).toBe("turn-10");
  });
});
