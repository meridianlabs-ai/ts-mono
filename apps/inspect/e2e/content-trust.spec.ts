import type { Page } from "@playwright/test";

import { expect, test } from "./fixtures/app";
import { serveEvalFiles } from "./fixtures/serve-eval-file";

// Real .eval logs from fixtures/content-trust/generate_logs.py. Their model
// output exercises every rich-rendering path; untrusted.eval sets
// ViewerConfig(trust_content=False), trusted.eval has no viewer config.
// Each log's links point under https://example.com/<label>/ and its images
// use a distinct PNG, so rich content can be attributed to the log it came
// from.
type Label = "untrusted" | "trusted";

/** A substring unique to each log's PNG data URI. */
const PNG_MARKERS: Record<Label, string> = {
  untrusted: "CAYAAAAfFcSJ",
  trusted: "CAQAAAC1HAwC",
};

const fixture = (label: Label) => ({
  path: new URL(`./fixtures/content-trust/${label}.eval`, import.meta.url),
  logFile: `${label}.eval`,
  preview: { task: "task", model: "mockllm/model", status: "success" },
});

const serveFixtures = (network: Parameters<typeof serveEvalFiles>[0]) =>
  serveEvalFiles(network, [fixture("trusted"), fixture("untrusted")]);

const logUrl = (label: Label, tab?: string) =>
  `/#/logs/${label}.eval${tab ? `/${tab}` : ""}`;

const sampleUrl = (label: Label, tab: string) =>
  `/#/logs/${label}.eval/samples/sample/1/1/${tab}`;

interface View {
  name: string;
  url: (label: Label) => string;
  ready: RegExp;
  /** Markers the trusted log must show here (the positive control). */
  trustedShows: (keyof Markers)[];
}

const VIEWS: View[] = [
  {
    name: "sample list",
    url: (label) => logUrl(label),
    ready: /Sample 1:/,
    trustedShows: ["links", "markdown"],
  },
  {
    name: "transcript",
    url: (label) => sampleUrl(label, "transcript"),
    ready: /Sample 1:/,
    trustedShows: ["links", "images", "media", "math", "ansi", "markdown"],
  },
  {
    name: "messages",
    url: (label) => sampleUrl(label, "messages"),
    ready: /Sample 1:/,
    trustedShows: ["links", "images", "media", "math", "ansi", "markdown"],
  },
  {
    name: "scoring",
    url: (label) => sampleUrl(label, "scoring"),
    ready: /Score: CORRECT/,
    trustedShows: ["links", "images", "math", "ansi", "markdown"],
  },
  {
    name: "metadata",
    url: (label) => sampleUrl(label, "metadata"),
    ready: /meta link/,
    trustedShows: ["links", "images", "markdown"],
  },
  {
    name: "print view",
    url: (label) => sampleUrl(label, "print"),
    ready: /Score: CORRECT/,
    trustedShows: ["links", "images", "media", "math", "markdown"],
  },
  {
    name: "sample JSON",
    url: (label) => sampleUrl(label, "json"),
    ready: /Sample 1:/,
    trustedShows: ["highlighted"],
  },
  {
    name: "log JSON",
    url: (label) => logUrl(label, "json"),
    ready: /mockllm\/model/,
    trustedShows: ["highlighted"],
  },
];

/** Counts of everything on the page that only rich rendering produces. */
const richMarkers = (page: Page) =>
  page.evaluate(() => {
    const count = (selector: string) =>
      document.querySelectorAll(selector).length;
    return {
      links: Array.from(document.querySelectorAll("a[href]")).filter((a) => {
        const href = a.getAttribute("href") ?? "";
        return href.includes("example.com") || href.includes("-other.eval");
      }).length,
      images: count('img[src^="data:"]'),
      media: count("audio, video"),
      math: count("mjx-container"),
      highlighted: count(".token"),
      ansi: count('[class*="ansiDisplay"] span[style]'),
      markdown: count(
        ".markdown-content :is(h1, h2, h3, strong, em, blockquote, code, a)"
      ),
    };
  });

type Markers = Awaited<ReturnType<typeof richMarkers>>;

const NONE: Markers = {
  links: 0,
  images: 0,
  media: 0,
  math: 0,
  highlighted: 0,
  ansi: 0,
  markdown: 0,
};

/** Scroll through the view (virtualized lists render lazily), keeping each
 *  marker's maximum. */
const collectMarkers = async (page: Page): Promise<Markers> => {
  let totals = await richMarkers(page);
  for (let step = 0; step < 8; step++) {
    await page.mouse.wheel(0, 800);
    await page.waitForTimeout(100);
    const next = await richMarkers(page);
    totals = {
      links: Math.max(totals.links, next.links),
      images: Math.max(totals.images, next.images),
      media: Math.max(totals.media, next.media),
      math: Math.max(totals.math, next.math),
      highlighted: Math.max(totals.highlighted, next.highlighted),
      ansi: Math.max(totals.ansi, next.ansi),
      markdown: Math.max(totals.markdown, next.markdown),
    };
  }
  return totals;
};

const openView = async (page: Page, url: string, ready: RegExp) => {
  await page.goto(url);
  await expect(page.getByText(ready).first()).toBeVisible();
  // Let async markdown rendering settle before looking for its output.
  await page.waitForTimeout(500);
};

type RichContentLog = Record<string, string[]>;

/**
 * Record, from the first byte of the page, every link or image added to the
 * DOM, attributed to the log it came from — so content that renders richly
 * even for a moment (before a log's trust is known, mid-navigation) is
 * caught, not just what's on screen at the end. Returns a reader for one
 * log's recorded selectors.
 */
const recordRichContent = async (page: Page) => {
  await page.addInitScript((pngMarkers) => {
    const seen: RichContentLog = {};
    const selectors = Object.entries(pngMarkers).flatMap(([label, png]) => {
      seen[label] = [];
      return [
        `a[href*="example.com/${label}/"]`,
        `a[href*="${label}-other.eval"]`,
        `img[src*="${png}"]`,
      ].map((selector) => ({ label, selector }));
    });
    (window as Window & { __richContent?: RichContentLog }).__richContent =
      seen;
    const check = (node: Node) => {
      if (!(node instanceof Element)) return;
      for (const { label, selector } of selectors) {
        if (node.matches(selector) || node.querySelector(selector)) {
          seen[label]?.push(selector);
        }
      }
    };
    new MutationObserver((records) => {
      for (const record of records) {
        record.addedNodes.forEach(check);
        if (record.type === "attributes") check(record.target);
      }
    }).observe(document, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["href", "src"],
    });
  }, PNG_MARKERS);
  return (label: Label) =>
    page.evaluate(
      (logLabel) =>
        (window as Window & { __richContent?: RichContentLog }).__richContent?.[
          logLabel
        ] ?? [],
      label
    );
};

/** Open the focus view of the sample's final model call. */
const openEventFocus = async (page: Page, label: Label) => {
  await openView(page, sampleUrl(label, "transcript"), /Sample 1:/);
  const focusHref = await page
    .locator('a[href*="/event?event="]')
    .last()
    .getAttribute("href");
  expect(focusHref).toBeTruthy();
  await page.goto(`/${focusHref}`);
  await expect(page.getByText(/Score: CORRECT/).first()).toBeVisible();
  await page.waitForTimeout(500);
};

test.describe("an untrusted log", () => {
  for (const view of VIEWS) {
    test(`renders nothing richly in the ${view.name}`, async ({
      page,
      network,
    }) => {
      serveFixtures(network);
      await openView(page, view.url("untrusted"), view.ready);
      expect(await collectMarkers(page)).toEqual(NONE);
    });
  }

  test("shows model output as its literal source with hidden characters revealed", async ({
    page,
    network,
  }) => {
    serveFixtures(network);
    // The print view renders the whole sample at once (no virtualization).
    await openView(page, sampleUrl("untrusted", "print"), /Score: CORRECT/);
    const text = await page.locator("body").innerText();
    expect(text).toContain(
      "[Click to verify](https://example.com/untrusted/phish)"
    );
    expect(text).toContain("zero⟨U+200B⟩width");
    expect(text).toContain("⟨U+202E⟩gnp.exe⟨U+202C⟩");
    expect(text).toContain("[image not shown: log content is untrusted]");
  });

  test("renders nothing richly in the event focus view", async ({
    page,
    network,
  }) => {
    serveFixtures(network);
    await openEventFocus(page, "untrusted");
    expect(await collectMarkers(page)).toEqual(NONE);
  });

  test("never renders its content richly, even transiently", async ({
    page,
    network,
  }) => {
    serveFixtures(network);
    const recorded = await recordRichContent(page);
    for (const view of VIEWS) {
      await openView(page, view.url("untrusted"), view.ready);
      await collectMarkers(page);
    }
    expect(await recorded("untrusted")).toEqual([]);
  });

  test("stays plain when navigated to from a trusted log", async ({
    page,
    network,
  }) => {
    serveFixtures(network);
    const recorded = await recordRichContent(page);
    await openView(page, sampleUrl("trusted", "messages"), /Sample 1:/);
    // In-app navigation (no reload) between logs and into a sample.
    await page.evaluate(() => {
      window.location.hash = "#/logs/untrusted.eval";
    });
    await expect(page.getByText(/Sample 1:/).first()).toBeVisible();
    await page.evaluate(() => {
      window.location.hash =
        "#/logs/untrusted.eval/samples/sample/1/1/messages";
    });
    await expect(page.getByText(/Sample 1:/).first()).toBeVisible();
    await collectMarkers(page);
    expect(await recorded("untrusted")).toEqual([]);
  });
});

test.describe("a trusted log", () => {
  for (const view of VIEWS) {
    test(`renders richly in the ${view.name}`, async ({ page, network }) => {
      serveFixtures(network);
      await openView(page, view.url("trusted"), view.ready);
      const markers = await collectMarkers(page);
      for (const marker of view.trustedShows) {
        expect(markers[marker], marker).toBeGreaterThan(0);
      }
    });
  }

  test("renders richly in the event focus view", async ({ page, network }) => {
    serveFixtures(network);
    await openEventFocus(page, "trusted");
    const markers = await collectMarkers(page);
    expect(markers.links).toBeGreaterThan(0);
    expect(markers.markdown).toBeGreaterThan(0);
  });

  test("renders richly when navigated to from an untrusted log", async ({
    page,
    network,
  }) => {
    serveFixtures(network);
    const recorded = await recordRichContent(page);
    await openView(page, sampleUrl("untrusted", "messages"), /Sample 1:/);
    await page.evaluate(() => {
      window.location.hash = "#/logs/trusted.eval/samples/sample/1/1/messages";
    });
    await expect(page.getByText(/Sample 1:/).first()).toBeVisible();
    await collectMarkers(page);
    const trusted = await recorded("trusted");
    expect(trusted.some((selector) => selector.startsWith("a["))).toBe(true);
    expect(trusted.some((selector) => selector.startsWith("img["))).toBe(true);
    // Nothing from the untrusted log it came from renders richly on the way.
    expect(await recorded("untrusted")).toEqual([]);
  });

  test("isn't held plain by an untrusted sample viewed earlier", async ({
    page,
    network,
  }) => {
    serveFixtures(network);
    await openView(page, sampleUrl("untrusted", "messages"), /Sample 1:/);
    await page.evaluate(() => {
      window.location.hash = "#/logs/trusted.eval/json";
    });
    await expect(page.getByText(/mockllm\/model/).first()).toBeVisible();
    await expect
      .poll(async () => (await richMarkers(page)).highlighted)
      .toBeGreaterThan(0);
  });
});
