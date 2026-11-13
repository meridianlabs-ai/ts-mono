import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, join } from "node:path";

import { Browser, CDPSession, expect, Page, test } from "@playwright/test";

import { isRecord } from "@tsmono/util";

// Gate for the copies of Bootstrap in packages/theme (design/bootstrap-removal.md):
// with Bootstrap emptied, the copies alone must match Bootstrap as shipped,
// including under forced :hover, :focus-visible and :active.

const COPIES = ["tokens", "reset", "components", "utilities"].map(
  (name) => `packages/theme/src/${name}.css`
);
const FORCED_STATES = ["hover", "focus", "focus-visible", "active"];
const INTERACTIVE =
  "a, button, input, select, textarea, summary, [role=button], [role=tab], .nav-link, .page-link, .navbar-brand";

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
  "animation-name",
  "z-index",
  "justify-content",
  "align-items",
  "flex-direction",
  "flex-wrap",
  "flex-grow",
  "flex-shrink",
  "max-width",
  "min-height",
  "background-position",
  "background-size",
  "background-repeat",
  "text-overflow",
  "pointer-events",
  "user-select",
  "outline-width",
  "border-right-width",
  "border-bottom-width",
  "border-left-width",
  "border-right-style",
  "border-bottom-style",
  "border-left-style",
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

interface Measurement {
  elements: number;
  tokens: number;
  // Classes from components.css and utilities.css selectors, and which of
  // them were on a measured element.
  copiedClasses: string[];
  renderedClasses: string[];
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
  copies,
}: {
  props: string[];
  pseudoProps: string[];
  copies: string[];
}): Promise<Measurement> => {
  const styleFor = (id: string) => {
    const style = [...document.querySelectorAll("style")].find((element) =>
      (element.getAttribute("data-vite-dev-id") ?? "").includes(id)
    );
    if (!style?.sheet) throw new Error(`no stylesheet for ${id}`);
    return style;
  };
  const bootstrap = styleFor("bootstrap/dist/css/bootstrap.css");
  const copyStyles = copies.map(styleFor);
  const original = new Map(
    [bootstrap, ...copyStyles].map((style) => [style, style.textContent])
  );

  const tokenNames = [...(copyStyles[0]?.sheet?.cssRules ?? [])].flatMap(
    (rule) =>
      rule instanceof CSSStyleRule
        ? [...rule.style].filter((name) => name.startsWith("--"))
        : []
  );

  const selectorsOf = (rules: Iterable<CSSRule>): string[] =>
    [...rules].flatMap((rule) =>
      rule instanceof CSSStyleRule
        ? [rule.selectorText]
        : rule instanceof CSSGroupingRule
          ? selectorsOf(rule.cssRules)
          : []
    );
  const copiedClasses = new Set(
    copyStyles
      .slice(2)
      .flatMap((style) => selectorsOf(style.sheet?.cssRules ?? []))
      .flatMap((selector) => [
        ...selector
          .replace(/:not\([^)]*\)/g, "")
          .matchAll(/\.(-?[_a-zA-Z][\w-]*)/g),
      ])
      .flatMap((match) => (match[1] ? [match[1]] : []))
  );

  const nextFrame = () =>
    new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve))
    );

  const apply = async (withBootstrap: boolean, withCopies: boolean) => {
    bootstrap.textContent = withBootstrap
      ? (original.get(bootstrap) ?? "")
      : "";
    for (const style of copyStyles) {
      style.textContent = withCopies ? (original.get(style) ?? "") : "";
    }
    await nextFrame();
    // Forced states and stylesheet swaps start transitions; measure where
    // they end. Rotating spinners change their bounding box from frame to
    // frame; measure them at their first frame.
    for (const animation of document.getAnimations()) {
      if (animation instanceof CSSTransition) animation.finish();
      if (animation instanceof CSSAnimation) {
        animation.pause();
        animation.currentTime = 0;
      }
    }
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
      values.set(`${index} left`, String(Math.round(rect.left)));
      values.set(`${index} top`, String(Math.round(rect.top)));
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
    await apply(true, false);
    const asShipped = snapshot();
    await apply(false, true);
    const withCopy = snapshot();
    await apply(false, false);
    const stripped = snapshot();
    return {
      elements: elements.length,
      tokens: tokenNames.length,
      copiedClasses: [...copiedClasses],
      renderedClasses: [...copiedClasses].filter((name) =>
        elements.some((element) => element.classList.contains(name))
      ),
      diffs: diff(asShipped, withCopy),
      strippedDiffs: diff(asShipped, stripped).length,
    };
  } finally {
    for (const [style, text] of original) style.textContent = text;
  }
};

const forceState = async (cdp: CDPSession, state: string | undefined) => {
  const { root } = await cdp.send("DOM.getDocument", { depth: 0 });
  const { nodeIds } = await cdp.send("DOM.querySelectorAll", {
    nodeId: root.nodeId,
    selector: INTERACTIVE,
  });
  for (const nodeId of nodeIds) {
    await cdp.send("CSS.forcePseudoState", {
      nodeId,
      forcedPseudoClasses: state ? [state] : [],
    });
  }
};

const measureWithStates = async (page: Page, cdp: CDPSession) => {
  const args = { props: PROPS, pseudoProps: PSEUDO_PROPS, copies: COPIES };
  const result = await page.evaluate(measureInPage, args);
  for (const state of FORCED_STATES) {
    await forceState(cdp, state);
    const forced = await page.evaluate(measureInPage, args);
    result.diffs.push(
      ...forced.diffs.map((d) => ({ ...d, prop: `:${state} ${d.prop}` }))
    );
  }
  await forceState(cdp, undefined);
  return result;
};

const measureScreen = async (page: Page, cdp: CDPSession, screen: Screen) => {
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
  return measureWithStates(page, cdp);
};

const measureAllScreens = async (
  browser: Browser,
  theme: (typeof THEMES)[number]
) => {
  const context = await browser.newContext({
    colorScheme: theme.endsWith("dark") ? "dark" : "light",
  });
  await context.addInitScript(
    (settings) => localStorage.setItem("inspect-view-user-settings", settings),
    settingsFor(theme)
  );
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send("DOM.enable");
  await cdp.send("CSS.enable");
  const screens = await discoverScreens(page);
  const results: (Measurement & { screen: string })[] = [];
  for (const screen of screens) {
    results.push({
      screen: screen.name,
      ...(await measureScreen(page, cdp, screen)),
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

test.describe("packages/theme copies replace Bootstrap", () => {
  for (const theme of THEMES) {
    test(`no computed-style change (${theme})`, async ({ browser }) => {
      test.setTimeout(30 * 60_000);
      const results = await measureAllScreens(browser, theme);
      // The comparison only means something if emptying Bootstrap without
      // the copies visibly breaks every screen.
      expect(results.filter((r) => r.strippedDiffs === 0)).toEqual([]);
      expect(results.filter((r) => r.elements === 0 || r.tokens === 0)).toEqual(
        []
      );
      expect(firstDiffs(results)).toEqual([]);

      // Not an assertion: some families only render in dialogs or while an
      // eval runs. The PR lists what this run left unchecked.
      const rendered = new Set(results.flatMap((r) => r.renderedClasses));
      test.info().annotations.push({
        type: "copied classes not rendered",
        description: (results[0]?.copiedClasses ?? [])
          .filter((name) => !rendered.has(name))
          .join(" "),
      });
    });
  }
});

const repoRoot = join(import.meta.dirname, "../../../../../..");
const bootstrapCss = readFileSync(
  createRequire(import.meta.url).resolve("bootstrap/dist/css/bootstrap.css"),
  "utf8"
);

// Markup for every copied class, shaped like the apps' own use, so families
// that only appear in dialogs, running evals or scout are still compared.
const FIXTURE = `
<div class="container"><div class="container-fluid">
  <nav class="navbar"><div class="navbar-brand">Brand</div><span class="navbar-text">Text</span></nav>
  <ol class="breadcrumb"><li class="breadcrumb-item"><a href="#">logs</a></li><li class="breadcrumb-item active">file.eval</li></ol>
  <button class="btn btn-primary">Save</button>
  <button class="btn btn-secondary">Cancel</button>
  <button class="btn btn-outline-primary">Outline</button>
  <button class="btn btn-primary" disabled>Disabled</button>
  <div class="card"><div>Card</div></div>
  <input class="form-control" value="Text" />
  <textarea class="form-control">Area</textarea>
  <input class="form-control" value="Disabled" disabled />
  <select class="form-select"><option>One</option></select>
  <select class="form-select form-select-sm"><option>Small</option></select>
  <ul class="nav nav-tabs" role="tablist">
    <li class="nav-item"><button class="nav-link active" role="tab">Active</button></li>
    <li class="nav-item"><button class="nav-link" role="tab">Other</button></li>
    <li class="nav-item"><button class="nav-link disabled" role="tab">Disabled</button></li>
  </ul>
  <ul class="nav nav-pills" role="tablist">
    <li class="nav-item"><button class="nav-link active" role="tab">Active</button></li>
    <li class="nav-item"><button class="nav-link" role="tab">Other</button></li>
  </ul>
  <div class="tab-content"><div class="tab-pane show active">Shown</div><div class="tab-pane">Hidden</div></div>
  <ul class="pagination">
    <li class="disabled"><a class="page-link">Previous</a></li>
    <li class="active"><a class="page-link" href="#">1</a></li>
    <li><a class="page-link" href="#">2</a></li>
  </ul>
  <div class="spinner-border" role="status"><span class="visually-hidden">Loading</span></div>
  <div class="sticky-top">Sticky</div>
  <p class="mb-0 text-danger">Danger</p>
  <p class="text-secondary font-monospace">Secondary</p>
  <div class="text-truncate" style="width: 4rem">A long line that truncates</div>
</div></div>`;

const fixturePage = (theme: "light" | "dark") => {
  const style = (id: string, css: string) =>
    `<style data-vite-dev-id="${id}">${css}</style>`;
  const copies = COPIES.map((id) =>
    style(id, readFileSync(join(repoRoot, id), "utf8"))
  );
  return `<!doctype html><html data-bs-theme="${theme}" style="color-scheme: ${theme}"><head>${style("bootstrap/dist/css/bootstrap.css", bootstrapCss)}${copies.join("")}</head><body>${FIXTURE}</body></html>`;
};

test.describe("packages/theme copies replace Bootstrap on a fixture page", () => {
  for (const theme of ["light", "dark"] as const) {
    test(`no computed-style change (${theme})`, async ({ browser }) => {
      const context = await browser.newContext({ colorScheme: theme });
      const page = await context.newPage();
      await page.setContent(fixturePage(theme));
      const cdp = await context.newCDPSession(page);
      await cdp.send("DOM.enable");
      await cdp.send("CSS.enable");
      const result = await measureWithStates(page, cdp);
      await context.close();
      writeFileSync(
        test.info().outputPath("measurements.json"),
        JSON.stringify(result, null, 1)
      );

      expect(result.renderedClasses.toSorted()).toEqual(
        result.copiedClasses.toSorted()
      );
      expect(result.strippedDiffs).toBeGreaterThan(0);
      expect(result.diffs.slice(0, 20)).toEqual([]);
    });
  }
});
