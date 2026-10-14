import { from } from "arquero";
import { http, HttpResponse } from "msw";

import { encodeBase64Url } from "@tsmono/util";

import type {
  AppConfig,
  MessagesEventsResponse,
  ProjectConfig,
  Status,
  TranscriptInfo,
} from "../src/types/api-types";

import { expect, test } from "./fixtures/app";
import {
  createAppConfig,
  createMessagesEventsResponse,
  createModelEvent,
  createProjectConfig,
  createStatus,
  createTranscriptInfo,
} from "./fixtures/test-data";

const TRANSCRIPTS_DIR = "/home/test/project/.transcripts";
const TRANSCRIPT_ID = "t-trust";
const LINK = "https://example.com/exfil";
const CONTENT = `Here is **bold claim** and [a link](${LINK})`;

const transcriptRoute = (suffix: string) =>
  `/#/transcripts/${encodeBase64Url(TRANSCRIPTS_DIR)}/${TRANSCRIPT_ID}${suffix}`;

type Page = Parameters<Parameters<typeof test>[2]>[0]["page"];

declare global {
  interface Window {
    /** Set by recordRichMarkers: every rich marker that entered the DOM. */
    __richMarkers?: string[];
  }
}

// Rich rendering lands within ~50 ms of the raw text on an idle machine and
// under ~300 ms with parallel workers; a plain check waits well past that
// before asserting nothing rich appeared.
const SETTLE_MS = 1000;

/**
 * Records every rich-rendering marker that enters the DOM, by insertion or
 * by a class/href change — rendered bold claims, the content's link,
 * highlighted JSON tokens — including ones a later render removes, so a
 * plain check can't pass before rendering lands.
 */
const recordRichMarkers = async (page: Page) => {
  await page.addInitScript((link) => {
    const seen: string[] = [];
    window.__richMarkers = seen;
    const markers: [string, (el: Element) => boolean][] = [
      [
        "bold",
        (el) => el.tagName === "STRONG" && el.textContent.includes("claim"),
      ],
      ["link", (el) => el.matches(`a[href="${link}"]`)],
      ["token", (el) => el.matches("#task-json-contents .token")],
    ];
    const check = (node: Node) => {
      if (!(node instanceof Element)) return;
      for (const el of [node, ...Array.from(node.querySelectorAll("*"))]) {
        for (const [name, matches] of markers) {
          if (matches(el)) seen.push(name);
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
      attributeFilter: ["class", "href"],
    });
  }, LINK);
  return () => page.evaluate(() => window.__richMarkers ?? []);
};

type RichMarkers = Awaited<ReturnType<typeof recordRichMarkers>>;

/** After rendering has had time to land, no rich marker ever appeared. */
const expectNoRichMarkers = async (page: Page, markers: RichMarkers) => {
  await page.waitForTimeout(SETTLE_MS);
  expect(await markers()).toEqual([]);
};

const pages = [
  { name: "transcript messages", suffix: "?tab=transcript-messages" },
  { name: "focused event", suffix: "/event?event=model-1&tab=Summary" },
];

/** How CONTENT must appear: rendered markdown, or literal text with no link. */
const expectRendering = {
  rich: async (page: Page, markers: RichMarkers) => {
    await expect(
      page.locator("strong", { hasText: "bold claim" }).first()
    ).toBeVisible();
    expect(await markers()).toContain("bold");
  },
  plain: async (page: Page, markers: RichMarkers) => {
    await expect(page.getByText("**bold claim**").first()).toBeVisible();
    await expectNoRichMarkers(page, markers);
  },
};

const expectContent = (
  page: Page,
  rendering: keyof typeof expectRendering,
  markers: RichMarkers
) => expectRendering[rendering](page, markers);

const cases: {
  name: string;
  viewer: boolean | null;
  transcript: boolean | null;
  rendering: keyof typeof expectRendering;
}[] = [
  {
    name: "trusted transcript",
    viewer: null,
    transcript: null,
    rendering: "rich",
  },
  {
    name: "untrusted transcript",
    viewer: null,
    transcript: false,
    rendering: "plain",
  },
  {
    name: "untrusted viewer",
    viewer: false,
    transcript: null,
    rendering: "plain",
  },
  {
    name: "trusted flag can't raise",
    viewer: false,
    transcript: true,
    rendering: "plain",
  },
];

for (const { name: pageName, suffix } of pages) {
  for (const { name, viewer, transcript, rendering } of cases) {
    test(`${pageName}: ${name} renders ${rendering}`, async ({
      page,
      network,
    }) => {
      network.use(
        http.get("*/api/v2/app-config", () =>
          HttpResponse.json<AppConfig>(
            createAppConfig({
              transcripts: { dir: TRANSCRIPTS_DIR, source: "project" },
              trust_content: viewer,
            })
          )
        ),
        http.get("*/api/v2/transcripts/:dir/:id/info", () =>
          HttpResponse.json<TranscriptInfo>(
            createTranscriptInfo({
              transcript_id: TRANSCRIPT_ID,
              trust_content: transcript,
            })
          )
        ),
        http.get("*/api/v2/transcripts/:dir/:id/messages-events", () =>
          HttpResponse.json<MessagesEventsResponse>(
            createMessagesEventsResponse({
              messages: [{ id: "m-1", role: "assistant", content: CONTENT }],
              events: [
                createModelEvent({
                  uuid: "model-1",
                  startSec: 0,
                  endSec: 1,
                  content: CONTENT,
                }),
              ],
            })
          )
        )
      );

      const markers = await recordRichMarkers(page);
      await page.goto(transcriptRoute(suffix));

      await expectContent(page, rendering, markers);
    });
  }
}

test.describe("project settings trust toggle", () => {
  const setup = (
    network: Parameters<Parameters<typeof test>[2]>[0]["network"],
    projectTrust: boolean | null,
    viewerTrust: boolean | null
  ) => {
    const saved: unknown[] = [];
    network.use(
      http.get("*/api/v2/app-config", () =>
        HttpResponse.json<AppConfig>(
          createAppConfig({ trust_content: viewerTrust })
        )
      ),
      http.get("*/api/v2/project/config", () =>
        HttpResponse.json<ProjectConfig>(
          { ...createProjectConfig(), trust_content: projectTrust },
          { headers: { ETag: '"etag-1"' } }
        )
      ),
      http.put("*/api/v2/project/config", async ({ request }) => {
        const body: unknown = await request.json();
        saved.push(body);
        return HttpResponse.json<ProjectConfig>(
          { ...createProjectConfig() },
          { headers: { ETag: '"etag-2"' } }
        );
      })
    );
    return saved;
  };

  test("turning trust off needs no confirmation and saves false", async ({
    page,
    network,
  }) => {
    const saved = setup(network, null, null);
    await page.goto("/#/project");

    await page.locator("#field-trust-content").click();
    await expect(page.getByText("Trust Model Output?")).toHaveCount(0);
    await page.getByText("Save Changes").click();

    await expect.poll(() => saved.length).toBe(1);
    expect(saved[0]).toMatchObject({ trust_content: false });
  });

  test("turning trust on asks first; cancel leaves it off", async ({
    page,
    network,
  }) => {
    const saved = setup(network, false, null);
    await page.goto("/#/project");

    const checkbox = page.locator("#field-trust-content");
    await checkbox.click();
    await expect(page.getByText("Trust Model Output?")).toBeVisible();
    await page.getByRole("button", { name: "Cancel" }).click();

    await expect(page.getByText("Trust Model Output?")).toHaveCount(0);
    await expect(checkbox).not.toHaveAttribute("checked");
    await expect(page.getByText("Save Changes")).toHaveAttribute(
      "disabled",
      ""
    );
    expect(saved).toHaveLength(0);
  });

  test("confirming trust removes the key on save", async ({
    page,
    network,
  }) => {
    const saved = setup(network, false, null);
    await page.goto("/#/project");

    await page.locator("#field-trust-content").click();
    await page.getByRole("button", { name: "Trust Content" }).click();
    await page.getByText("Save Changes").click();

    await expect.poll(() => saved.length).toBe(1);
    expect(saved[0]).toMatchObject({ trust_content: null });
  });

  test("shows untrusted mode instead of the toggle when the viewer forces plain text", async ({
    page,
    network,
  }) => {
    setup(network, null, false);
    await page.goto("/#/project");

    await expect(page.getByText("running in untrusted mode")).toBeVisible();
    await expect(page.locator("#field-trust-content")).toHaveCount(0);
  });
});

const SCANS_DIR = "/home/test/project/.scans";
const scanRoute = `/#/scan/${encodeBase64Url(SCANS_DIR)}/scan_id=aBcDeFgHiJkLmNoPqRsTuV?scanner=trust`;

const mockScan = (
  network: Parameters<Parameters<typeof test>[2]>[0]["network"],
  viewer: boolean | null
) => {
  const row = (uuid: string, trust: boolean | null) => ({
    uuid,
    identifier: uuid,
    transcript_id: `transcript-${uuid}`,
    transcript_trust_content: trust,
    value: true,
    value_type: "boolean",
    explanation: `The **${uuid} claim** holds`,
    metadata: "{}",
    transcript_metadata: "{}",
    message_references: "[]",
    event_references: "[]",
  });
  const rows = from([
    row("trusted", true),
    row("untrusted", false),
    row("unrecorded", null),
  ]);
  network.use(
    http.get("*/api/v2/app-config", () =>
      HttpResponse.json<AppConfig>(createAppConfig({ trust_content: viewer }))
    ),
    http.get("*/api/v2/scans/:dir/:scanPath", () =>
      HttpResponse.json<Status>(
        createStatus({
          summary: {
            complete: true,
            scanners: {
              trust: {
                scans: 3,
                results: 3,
                tokens: 0,
                errors: 0,
                model_usage: {},
              },
            },
          },
        })
      )
    ),
    http.get("*/api/v2/scans/:dir/:scanPath/trust", () =>
      HttpResponse.arrayBuffer(Uint8Array.from(rows.toArrowIPC()).buffer)
    ),
    http.get("*/api/v2/scans/:dir/:scanPath/trust/:uuid", () =>
      HttpResponse.json({
        input_type: "message",
        input: {
          id: "m-1",
          role: "assistant",
          content: "The **input claim** holds",
        },
      })
    )
  );
};

test("scan results rows each follow their own transcript's trust", async ({
  page,
  network,
}) => {
  mockScan(network, null);
  await page.goto(scanRoute);

  await expect(
    page.locator("strong", { hasText: "trusted claim" }).first()
  ).toBeVisible();
  await expect(
    page.locator("strong", { hasText: "unrecorded claim" }).first()
  ).toBeVisible();
  await expect(page.getByText("**untrusted claim**").first()).toBeVisible();
  await expect(
    page.locator("strong", { hasText: "untrusted claim" })
  ).toHaveCount(0);

  await page.getByText("**untrusted claim**").first().click();
  await expect(page).toHaveURL(/\/untrusted\?/);
  await expect(page.getByText("**input claim**").first()).toBeVisible();
  await expect(page.locator("strong", { hasText: "input claim" })).toHaveCount(
    0
  );
  await expect(page.getByText("**untrusted claim**").first()).toBeVisible();
  await expect(
    page.locator("strong", { hasText: "untrusted claim" })
  ).toHaveCount(0);
});

test("an untrusted viewer shows trusted scan results as plain text", async ({
  page,
  network,
}) => {
  mockScan(network, false);
  const markers = await recordRichMarkers(page);
  await page.goto(scanRoute);

  await expect(page.getByText("**trusted claim**").first()).toBeVisible();
  await expect(page.getByText("**unrecorded claim**").first()).toBeVisible();
  await expectNoRichMarkers(page, markers);

  await page.getByText("**trusted claim**").first().click();
  await expect(page).toHaveURL(/\/trusted\?/);
  await expect(page.getByText("**input claim**").first()).toBeVisible();
  await expectNoRichMarkers(page, markers);
});

test("scan JSON is app data: highlighted", async ({ page, network }) => {
  mockScan(network, null);
  const markers = await recordRichMarkers(page);
  await page.goto(scanRoute);
  await page.getByRole("tab", { name: "JSON" }).click();

  const json = page.locator("#task-json-contents");
  await expect(json).toContainText("scan_id");
  await expect(json.locator(".token").first()).toBeVisible();
  expect(await markers()).toContain("token");
});

test("scan JSON is app data: plain under an untrusted viewer", async ({
  page,
  network,
}) => {
  mockScan(network, false);
  const markers = await recordRichMarkers(page);
  await page.goto(scanRoute);
  await page.getByRole("tab", { name: "JSON" }).click();

  await expect(page.locator("#task-json-contents")).toContainText("scan_id");
  await expectNoRichMarkers(page, markers);
});
