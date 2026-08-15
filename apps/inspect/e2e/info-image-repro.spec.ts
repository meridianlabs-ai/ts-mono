/**
 * Repro for: info events with image-heavy markdown show no "more" toggle
 * even though content is clipped.
 */
import { deflateSync } from "node:zlib";

import { http, HttpResponse } from "msw";

import type { EvalSample, InfoEvent } from "@tsmono/inspect-common/types";

import { expect, test } from "./fixtures/app";
import {
  createEvalLog,
  createEvalSample,
  createLogDetails,
} from "./fixtures/test-data";

const LOG_FILE = "test-info-image.json";

// Build a real 256x192 PNG (solid-ish color) so <img> gets true intrinsic size.
function makePng(width: number, height: number, rgb: [number, number, number]) {
  const crcTable: number[] = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crcTable[n] = c >>> 0;
  }
  const crc = (buf: Buffer) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff]! ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crcBuf = Buffer.alloc(4);
    crcBuf.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, crcBuf]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type RGB
  const raw = Buffer.alloc(height * (1 + width * 3));
  for (let y = 0; y < height; y++) {
    const rowStart = y * (1 + width * 3);
    raw[rowStart] = 0;
    for (let x = 0; x < width; x++) {
      const p = rowStart + 1 + x * 3;
      raw[p] = rgb[0];
      raw[p + 1] = rgb[1];
      raw[p + 2] = (rgb[2] + y) % 256;
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

test("info event with images shows a more toggle when clipped", async ({
  page,
  network,
}) => {
  const img1 = `data:image/png;base64,${makePng(256, 192, [200, 180, 40]).toString("base64")}`;
  const img2 = `data:image/png;base64,${makePng(256, 192, [90, 90, 220]).toString("base64")}`;
  const img3 = `data:image/png;base64,${makePng(256, 192, [40, 200, 120]).toString("base64")}`;

  const markdown =
    `**mitsuba3-examples1-simple**\n\n- **accuracy**: 0.000\n\n` +
    `target | response | difference\n\n` +
    `![target](${img1})\n\n![response](${img2})\n\n![difference](${img3})`;

  const infoEvent: InfoEvent = {
    event: "info",
    data: markdown,
    source: "MITSUBA3",
    timestamp: "2025-01-15T10:00:05Z",
    working_start: 5,
    uuid: "info-img-1",
  };

  // Surround with filler events so the transcript virtualizes and the user
  // must scroll to reach the info event.
  const filler = (i: number): InfoEvent => ({
    event: "info",
    data: `filler event ${i}\n\n${"lorem ipsum dolor sit amet. ".repeat(20)}`,
    source: `FILLER${i}`,
    timestamp: "2025-01-15T10:00:01Z",
    working_start: 1,
    uuid: `info-filler-${i}`,
  });
  const before = Array.from({ length: 30 }, (_, i) => filler(i));
  const after = Array.from({ length: 30 }, (_, i) => filler(100 + i));

  const sample = createEvalSample({
    id: 1,
    epoch: 1,
    messages: [
      { role: "user", content: "Hello", source: "input" },
      { role: "assistant", content: "Hi there", source: "generate" },
    ],
  });
  (sample as { events: EvalSample["events"] }).events = [
    ...before,
    infoEvent,
    ...after,
  ];

  const evalLog = createEvalLog({ samples: [sample] });
  const logDetails = createLogDetails(evalLog);

  network.use(
    http.get("*/api/logs", () => HttpResponse.json({ log_dir: "/logs" })),
    http.get("*/api/log-files*", () =>
      HttpResponse.json({
        files: [{ name: LOG_FILE, task: "chat-test", task_id: "chat-test" }],
        response_type: "full",
      })
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

  // Scroll down through the virtualized transcript like a user would,
  // until the MITSUBA3 info event is on screen.
  await expect(page.getByText("Info: FILLER0")).toBeVisible();
  await page.mouse.move(640, 400);
  for (let i = 0; i < 200; i++) {
    const visible = await page
      .getByText("Info: MITSUBA3")
      .isVisible()
      .catch(() => false);
    if (visible) break;
    await page.mouse.wheel(0, 300);
    await page.waitForTimeout(50);
  }
  await expect(page.getByText("Info: MITSUBA3")).toBeVisible();
  // Nudge so the panel sits fully in view, then let images/RO settle.
  await page.mouse.wheel(0, 200);
  await page.waitForTimeout(2500);

  // Bring the info panel fully into view, like the user's screenshot.
  await page.evaluate(() => {
    const wrap = Array.from(
      document.querySelectorAll('[data-expandable-panel="true"]')
    )
      .map((p) => p.firstElementChild as HTMLElement)
      .find((w) => w && w.querySelector("img"));
    wrap?.scrollIntoView({ block: "center" });
  });
  await page.waitForTimeout(1000);

  const report = await page.evaluate(() => {
    const wrap = Array.from(
      document.querySelectorAll('[data-expandable-panel="true"]')
    )
      .map((p) => p.firstElementChild as HTMLElement)
      .find((w) => w && w.querySelector("img"));
    if (!wrap) return { found: false };
    const panel = wrap.parentElement!;
    const btn = panel.querySelector("button") as HTMLElement | null;
    const r = btn?.getBoundingClientRect();
    const hit = r
      ? document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)
      : null;
    const imgs = Array.from(wrap.querySelectorAll("img")).map((i) => ({
      w: i.getBoundingClientRect().width,
      h: i.getBoundingClientRect().height,
      complete: (i as HTMLImageElement).complete,
    }));
    const rect = (el: Element | null) => {
      if (!el) return null;
      const b = el.getBoundingClientRect();
      return { x: b.x, y: b.y, w: b.width, h: b.height };
    };
    const holder = btn?.closest("[class*=inlineToggleHolder]") ?? null;
    const sticky = btn?.closest("[class*=inlineToggleSticky]") ?? null;
    const chain: string[] = [];
    let el: HTMLElement | null = btn;
    while (el && chain.length < 14) {
      const b = el.getBoundingClientRect();
      chain.push(
        `${el.tagName}.${el.className && typeof el.className === "string" ? el.className.split(" ")[0] : ""} pos=${getComputedStyle(el).position} rect=(${b.x.toFixed(0)},${b.y.toFixed(0)},${b.width.toFixed(0)}x${b.height.toFixed(0)})`
      );
      el = el.parentElement;
    }
    return {
      found: true,
      wrapClass: wrap.className,
      wrapStyle: wrap.getAttribute("style"),
      wrapRect: rect(wrap),
      panelRect: rect(panel),
      holderRect: rect(holder),
      stickyRect: rect(sticky),
      wrapScrollH: wrap.scrollHeight,
      btnInDom: !!btn,
      btnRect: r ? { x: r.x, y: r.y, w: r.width, h: r.height } : null,
      elementAtBtnCenter: hit
        ? `${hit.tagName}.${(hit as HTMLElement).className}`
        : "none",
      ancestorChain: chain,
      outerComputed: (() => {
        const outer = panel.parentElement!;
        const cs = getComputedStyle(outer);
        const pcs = getComputedStyle(outer.parentElement!);
        return {
          outerDisplay: cs.display,
          outerWidth: cs.width,
          parentClass: outer.parentElement!.className,
          parentDisplay: pcs.display,
          parentFlexDirection: pcs.flexDirection,
          parentAlignItems: pcs.alignItems,
        };
      })(),
      imgs,
    };
  });
  console.log("REPORT:", JSON.stringify(report, null, 2));

  // Verify fix hypothesis: give the ExpandablePanel root full width so it
  // doesn't shrink-wrap inside the flex tab-pane.
  const fixed = await page.evaluate(() => {
    const style = document.createElement("style");
    style.textContent = `[class*="_outer_"] { width: 100%; }`;
    document.head.appendChild(style);
    return new Promise((resolve) => {
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          const wrap = Array.from(
            document.querySelectorAll('[data-expandable-panel="true"]')
          )
            .map((p) => p.firstElementChild as HTMLElement)
            .find((w) => w && w.querySelector("img"))!;
          const panel = wrap.parentElement!;
          const btn = panel.querySelector("button")!;
          const r = btn.getBoundingClientRect();
          const hit = document.elementFromPoint(
            r.x + r.width / 2,
            r.y + r.height / 2
          );
          resolve({
            panelW: panel.getBoundingClientRect().width,
            btnRect: { x: r.x, y: r.y },
            hit: hit ? `${hit.tagName}.${(hit as HTMLElement).className}` : "none",
          });
        })
      );
    });
  });
  console.log("AFTER FIX:", JSON.stringify(fixed));
  await page.screenshot({ path: "e2e-info-image-fixed.png" });

  await page.screenshot({
    path: "e2e-info-image-repro.png",
    fullPage: false,
  });

  expect(report.found).toBe(true);
  expect(report.btnInDom).toBe(true);
});
