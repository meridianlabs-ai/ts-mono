import { always, eventually } from "@antithesishq/bombadil";
import {
  actions,
  extract,
  getFingerprint,
  registerCustomAction,
  weighted,
} from "@antithesishq/bombadil/browser";
import {
  back,
  forward,
  scroll,
  waitOnce,
} from "@antithesishq/bombadil/browser/defaults/actions";

export {
  noUncaughtExceptions,
  noUnhandledPromiseRejections,
} from "@antithesishq/bombadil/browser/defaults/properties";

const state = extract(({ document, window }) => ({
  hash: window.location.hash,
  evidence: Array.from(
    document.body.innerText.matchAll(/EVIDENCE_(red|blue)_(\d)/g),
    (match) => `${match[1]}_${match[2]}`
  ),
  executed: document.documentElement.dataset.bombadilExecuted ?? null,
  unsafeLinks: Array.from(document.querySelectorAll("a[href]"))
    .map((a) => a.getAttribute("href") ?? "")
    .filter((href) =>
      /^(?:javascript|vbscript|data):/i.test(
        Array.from(href)
          .filter((character) => character.charCodeAt(0) > 32)
          .join("")
      )
    ),
  error: document.body.innerText.includes("Unexpected Application Error!"),
}));
export const noContentExecution = always(() => state.current.executed === null);
export const noUnsafeLinks = always(
  () => state.current.unsafeLinks.length === 0
);
export const noErrorBoundary = always(() => !state.current.error);
export const correctSample = always(() => {
  const hash = state.current.hash;
  const route = /\/logs\/(red|blue)\.json\/samples\/sample\/(\d)\//.exec(hash);
  const expected = route ? `${route[1]}_${route[2]}` : null;
  return eventually(
    () =>
      state.current.hash !== hash ||
      expected === null ||
      state.current.evidence.every((value) => value === expected)
  ).within(3, "seconds");
});
const targets = extract(({ document, window }) =>
  Array.from(document.querySelectorAll('button, a, [role="tab"]')).flatMap(
    (element) => {
      const label =
        element.getAttribute("aria-label") ??
        element.getAttribute("title") ??
        element.textContent;
      if (
        !/sample|event|message|turn|collapse|expand|metadata|score|unsafe/i.test(
          label
        ) ||
        /tanstack|devtools|query key|edit|delete/i.test(label)
      )
        return [];
      const href = element.getAttribute("href");
      if (href && !href.startsWith("#") && !/^(javascript|data):/.test(href))
        return [];
      const rect = element.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      return rect.width &&
        rect.height &&
        x > 0 &&
        y > 0 &&
        x < window.innerWidth &&
        y < window.innerHeight &&
        element.contains(document.elementFromPoint(x, y))
        ? [{ fingerprint: getFingerprint(element), point: { x, y } }]
        : [];
    }
  )
);
const clickTargets = actions(() => targets.current.map((Click) => ({ Click })));
const navigate = registerCustomAction(
  "sample",
  (_document, window, color: string, sample: number, tab: string) => {
    window.location.hash = `/logs/${color}.json/samples/sample/${sample}/1/${tab}`;
    return Promise.resolve();
  }
);
const hops = actions(() =>
  ["red", "blue"].flatMap((color) =>
    Array.from({ length: 8 }, (_, sample) =>
      ["messages", "transcript", "scoring", "metadata"].map((tab) =>
        navigate(color, sample, tab)
      )
    ).flat()
  )
);
const settle = registerCustomAction("settle", async (_document, window) => {
  await new Promise((resolve) => window.setTimeout(resolve, 1400));
});
const settling = actions(() => [settle()]);
export const interactions = weighted([
  [5, hops],
  [4, clickTargets],
  [2, scroll],
  [1, back],
  [1, forward],
  [1, waitOnce],
  [3, settling],
]);
