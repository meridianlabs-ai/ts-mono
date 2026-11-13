import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { basename } from "node:path";

import { Browser, expect, Page, test } from "@playwright/test";

import { isRecord } from "@tsmono/util";

// Gates for the copies of Bootstrap in packages/theme (design/bootstrap-removal.md):
// Bootstrap minus the copied part plus our copy must match Bootstrap as shipped.
// Run one with -g "tokens.css" or -g "reset.css".

const rebootCss = readFileSync(
  createRequire(import.meta.url).resolve(
    "bootstrap/dist/css/bootstrap-reboot.css"
  ),
  "utf8"
);

const THEMES = ["light", "dark", "readable-light", "readable-dark"] as const;
const SAMPLE_TABS = ["transcript", "messages", "scoring", "metadata", "info"];
const LOG_TABS = ["info", "models", "task", "json"];
const MAX_LOGS = 3;

const PROPS = [
  "color",
  "background-color",
  "background-image",
  "border-top-color",
  "border-right-color",
  "border-bottom-color",
  "border-left-color",
  "border-top-width",
  "border-top-style",
  "border-top-left-radius",
  "border-bottom-right-radius",
  "outline-color",
  "outline-style",
  "box-shadow",
  "text-decoration-color",
  "text-decoration-line",
  "caret-color",
  "accent-color",
  "fill",
  "stroke",
  "opacity",
  "filter",
  "color-scheme",
  "font-family",
  "font-size",
  "font-weight",
  "line-height",
  "font-style",
  "letter-spacing",
  "text-transform",
  "text-align",
  "vertical-align",
  "white-space",
  "overflow-wrap",
  "list-style-type",
  "cursor",
  "appearance",
  "box-sizing",
  "border-collapse",
  "caption-side",
  "scroll-behavior",
  "top",
  "bottom",
  "float",
  "clear",
  "resize",
  "outline-offset",
  "word-break",
  "min-width",
  "overflow-y",
  "border-top-right-radius",
  "border-bottom-left-radius",
  "-webkit-text-size-adjust",
  "-webkit-tap-highlight-color",
  "margin-top",
  "margin-right",
  "margin-bottom",
  "margin-left",
  "padding-top",
  "padding-right",
  "padding-bottom",
  "padding-left",
  "display",
  "position",
  "overflow-x",
];
const PSEUDO_PROPS = [
  "content",
  "color",
  "background-color",
  "border-top-color",
  "border-bottom-color",
  "box-shadow",
];

interface Screen {
  name: string;
  hash: string;
}

interface StyleDiff {
  element: string;
  prop: string;
  bootstrap: string;
  copy: string;
}

// What to delete from Bootstrap: its :root / [data-bs-theme] variable blocks,
// or every rule of another stylesheet (matched by selector and @media).
type Strip = { variables: true } | { rules: string };

interface Gate {
  copy: string;
  strip: Strip;
}

interface Measurement {
  elements: number;
  tokens: number;
  diffs: StyleDiff[];
  strippedDiffs: number;
}

const settingsFor = (theme: string) =>
  JSON.stringify({ state: { themePreference: theme }, version: 0 });

const discoverScreens = async (page: Page): Promise<Screen[]> => {
  const response = await page.request.get("/api/logs");
  const listing: unknown = await response.json();
  const files: unknown[] =
    isRecord(listing) && Array.isArray(listing.files) ? listing.files : [];
  const logs = files
    .flatMap((file) =>
      isRecord(file) && typeof file.name === "string"
        ? [basename(file.name)]
        : []
    )
    .filter((name) => name.endsWith(".eval"))
    .slice(0, MAX_LOGS);
  if (logs.length === 0) throw new Error("VERIFY_LOG_DIR has no .eval logs");

  const screens: Screen[] = [{ name: "log-list", hash: "#/logs/" }];
  for (const [index, log] of logs.entries()) {
    const logHash = `#/logs/${encodeURIComponent(log)}`;
    screens.push({ name: `${log}:samples`, hash: `${logHash}/samples/` });
    await page.goto(`/${logHash}/samples/`);
    await page.getByRole("gridcell").first().click({ timeout: 30_000 });
    await page.waitForURL(/\/samples\/sample\//);
    const url = new URL(page.url());
    const sampleHash = url.hash.replace(/\/[^/]*$/, "/");
    for (const tab of SAMPLE_TABS) {
      screens.push({ name: `${log}:sample-${tab}`, hash: sampleHash + tab });
    }
    for (const tab of index === 0 ? LOG_TABS : []) {
      screens.push({ name: `${log}:log-${tab}`, hash: `${logHash}/${tab}` });
    }
  }
  return screens;
};

// Runs in the page. Swaps stylesheet contents in place and snapshots computed
// styles under each variant, so element identity is stable across variants.
const measureInPage = async ({
  props,
  pseudoProps,
  gate,
}: {
  props: string[];
  pseudoProps: string[];
  gate: Gate;
}): Promise<Measurement> => {
  const styleFor = (id: string) => {
    const style = [...document.querySelectorAll("style")].find((element) =>
      (element.getAttribute("data-vite-dev-id") ?? "").includes(id)
    );
    if (!style?.sheet) throw new Error(`no stylesheet for ${id}`);
    return style;
  };
  const bootstrap = styleFor("bootstrap/dist/css/bootstrap.css");
  const copy = styleFor(gate.copy);
  const originals = [bootstrap.textContent, copy.textContent] as const;

  const tokenNames = [...(copy.sheet?.cssRules ?? [])].flatMap((rule) =>
    rule instanceof CSSStyleRule
      ? [...rule.style].filter((name) => name.startsWith("--"))
      : []
  );

  const isVariableBlock = (rule: CSSRule) =>
    rule instanceof CSSStyleRule &&
    rule.selectorText
      .split(",")
      .every((selector) =>
        /^(:root|\[data-bs-theme="?\w+"?\])$/.test(selector.trim())
      );

  const nextFrame = () =>
    new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve))
    );

  const selectorParts = (selectorText: string) =>
    selectorText.match(/(?:[^,(]|\([^)]*\))+/g)?.map((part) => part.trim()) ??
    [];
  const styleRules = (rules: CSSRuleList) =>
    [...rules].flatMap((rule) =>
      rule instanceof CSSMediaRule
        ? [...rule.cssRules].flatMap((inner) =>
            inner instanceof CSSStyleRule
              ? [{ rule: inner, media: rule.conditionText }]
              : []
          )
        : rule instanceof CSSStyleRule
          ? [{ rule, media: "" }]
          : []
    );

  const stripRules = (sheet: CSSStyleSheet, css: string) => {
    const source = new CSSStyleSheet();
    source.replaceSync(css);
    // Counts, not a set: Reboot repeats selectors across rules (`button`
    // is in four), and each occurrence must be removed.
    const remaining = new Map<string, number>();
    for (const { rule, media } of styleRules(source.cssRules)) {
      if (rule.parentRule === null && isVariableBlock(rule)) continue;
      for (const part of selectorParts(rule.selectorText)) {
        const key = `${media}|${part}`;
        remaining.set(key, (remaining.get(key) ?? 0) + 1);
      }
    }
    for (const { rule, media } of styleRules(sheet.cssRules)) {
      const kept = selectorParts(rule.selectorText).filter((part) => {
        const key = `${media}|${part}`;
        const count = remaining.get(key) ?? 0;
        if (count === 0) return true;
        remaining.set(key, count - 1);
        return false;
      });
      rule.selectorText = kept.length > 0 ? kept.join(", ") : ":not(*)";
    }
    const missing = [...remaining].filter(([, count]) => count > 0);
    if (missing.length > 0) {
      throw new Error(`not found in Bootstrap: ${missing.join("; ")}`);
    }
  };

  const apply = async (withCopy: boolean, stripBootstrap: boolean) => {
    bootstrap.textContent = originals[0];
    copy.textContent = withCopy ? originals[1] : "";
    const sheet = bootstrap.sheet;
    if (stripBootstrap && sheet && "variables" in gate.strip) {
      for (let i = sheet.cssRules.length - 1; i >= 0; i--) {
        const rule = sheet.cssRules[i];
        if (rule && isVariableBlock(rule)) sheet.deleteRule(i);
      }
    }
    if (stripBootstrap && sheet && "rules" in gate.strip) {
      stripRules(sheet, gate.strip.rules);
    }
    await nextFrame();
  };

  const elements = [
    document.documentElement,
    document.body,
    ...document.body.querySelectorAll("*"),
  ].filter(
    (element) =>
      !["SCRIPT", "STYLE"].includes(element.tagName) &&
      element.getClientRects().length > 0
  );
  const label = (element: Element) =>
    element.tagName.toLowerCase() +
    [...element.classList]
      .slice(0, 3)
      .map((name) => `.${name}`)
      .join("") +
    (element.id ? `#${element.id}` : "");

  const probe = document.createElement("div");
  probe.hidden = true;
  const looksLikeColor = (value: string) =>
    /^(#|rgba?\(|hsla?\(|light-dark\()/.test(value);
  const resolveToken = (name: string) => {
    const raw = getComputedStyle(probe)
      .getPropertyValue(name)
      .replace(/\s+/g, " ")
      .replace(/\s*([,()])\s*/g, "$1")
      .trim();
    if (!looksLikeColor(raw)) return raw;
    probe.style.color = `var(${name})`;
    const color = getComputedStyle(probe).color;
    probe.style.color = "";
    return color;
  };

  const snapshot = () => {
    document.body.append(probe);
    const values = new Map<string, string>();
    for (const name of tokenNames) {
      values.set(`body ${name}`, resolveToken(name));
    }
    probe.remove();
    elements.forEach((element, index) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      values.set(`${index} width`, String(Math.round(rect.width)));
      values.set(`${index} height`, String(Math.round(rect.height)));
      for (const prop of props) {
        values.set(`${index} ${prop}`, style.getPropertyValue(prop));
      }
      for (const pseudo of ["::before", "::after"]) {
        const pseudoStyle = getComputedStyle(element, pseudo);
        for (const prop of pseudoProps) {
          values.set(
            `${index} ${pseudo} ${prop}`,
            pseudoStyle.getPropertyValue(prop)
          );
        }
      }
    });
    return values;
  };

  const diff = (a: Map<string, string>, b: Map<string, string>) =>
    [...a].flatMap(([key, value]): StyleDiff[] => {
      const other = b.get(key) ?? "";
      if (value === other) return [];
      const [where = "", ...rest] = key.split(" ");
      const element = elements[Number(where)];
      return [
        {
          element: element ? label(element) : where,
          prop: rest.join(" "),
          bootstrap: value,
          copy: other,
        },
      ];
    });

  try {
    await apply(false, false);
    const asShipped = snapshot();
    await apply(true, true);
    const withCopy = snapshot();
    await apply(false, true);
    const stripped = snapshot();
    return {
      elements: elements.length,
      tokens: tokenNames.length,
      diffs: diff(asShipped, withCopy),
      strippedDiffs: diff(asShipped, stripped).length,
    };
  } finally {
    bootstrap.textContent = originals[0];
    copy.textContent = originals[1];
  }
};

const measureScreen = async (page: Page, screen: Screen, gate: Gate) => {
  await page.goto("about:blank");
  await page.goto(`/${screen.hash}`);
  // No single element marks every screen as loaded, so wait until the DOM
  // stops growing.
  let previous = -1;
  await expect
    .poll(
      async () => {
        const count = await page.locator("body *").count();
        const settled = count === previous;
        previous = count;
        return settled;
      },
      { intervals: [750], timeout: 30_000 }
    )
    .toBe(true);
  return page.evaluate(measureInPage, {
    props: PROPS,
    pseudoProps: PSEUDO_PROPS,
    gate,
  });
};

const measureAllScreens = async (
  browser: Browser,
  theme: (typeof THEMES)[number],
  gate: Gate
) => {
  const context = await browser.newContext({
    colorScheme: theme.endsWith("dark") ? "dark" : "light",
  });
  await context.addInitScript(
    (settings) => localStorage.setItem("inspect-view-user-settings", settings),
    settingsFor(theme)
  );
  const page = await context.newPage();
  const screens = await discoverScreens(page);
  const results: (Measurement & { screen: string })[] = [];
  for (const screen of screens) {
    results.push({
      screen: screen.name,
      ...(await measureScreen(page, screen, gate)),
    });
  }
  await context.close();
  writeFileSync(
    test.info().outputPath("measurements.json"),
    JSON.stringify(results, null, 1)
  );
  return results;
};

const firstDiffs = (results: (Measurement & { screen: string })[]) =>
  results.flatMap((r) =>
    r.diffs.slice(0, 20).map((d) => ({ screen: r.screen, ...d }))
  );

test.describe("tokens.css replaces Bootstrap's variable blocks", () => {
  for (const theme of THEMES) {
    test(`no computed-style change (${theme})`, async ({ browser }) => {
      test.setTimeout(10 * 60_000);
      const results = await measureAllScreens(browser, theme, {
        copy: "packages/theme/src/tokens.css",
        strip: { variables: true },
      });
      // The comparison only means something if stripping without the copy
      // visibly breaks every screen.
      expect(results.filter((r) => r.strippedDiffs === 0)).toEqual([]);
      expect(results.filter((r) => r.elements === 0 || r.tokens === 0)).toEqual(
        []
      );
      expect(firstDiffs(results)).toEqual([]);
    });
  }
});

test.describe("reset.css replaces Bootstrap's Reboot", () => {
  for (const theme of THEMES) {
    test(`no computed-style change (${theme})`, async ({ browser }) => {
      test.setTimeout(10 * 60_000);
      const results = await measureAllScreens(browser, theme, {
        copy: "packages/theme/src/reset.css",
        strip: { rules: rebootCss },
      });
      expect(results.filter((r) => r.strippedDiffs === 0)).toEqual([]);
      expect(results.filter((r) => r.elements === 0)).toEqual([]);
      expect(firstDiffs(results)).toEqual([]);
    });
  }
});
