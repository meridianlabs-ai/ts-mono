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
  panelScrollChecks: Number(document.body.dataset.panelScrollChecks ?? 0),
  evidence: Array.from(
    document.body.innerText.matchAll(/EVIDENCE_(alpha|beta|gamma)/g),
    (match) => match[1] ?? ""
  ),
  directories: Array.from(
    document.body.innerText.matchAll(/DIRECTORY_(primary|secondary)/g),
    (match) => match[1] ?? ""
  ),
  error: document.body.innerText.includes("Unexpected Application Error!"),
}));

export const correctTranscript = always(() => {
  const hash = state.current.hash;
  const id = /\/(alpha|beta|gamma)(?:\?|$|\/)/.exec(hash)?.[1];
  return eventually(
    () =>
      state.current.hash !== hash ||
      !id ||
      state.current.evidence.every((value) => value === id)
  ).within(3, "seconds");
});
export const noErrorBoundary = always(() => !state.current.error);
export const correctDirectory = always(() => {
  const hash = state.current.hash;
  const segment = /^#\/transcripts\/([^/]+)\//.exec(hash)?.[1];
  const expected =
    segment === "L2hvbWUvdGVzdC9zZWNvbmRhcnk"
      ? "secondary"
      : segment === "L2hvbWUvdGVzdC9wcm9qZWN0Ly50cmFuc2NyaXB0cw"
        ? "primary"
        : null;
  return eventually(
    () =>
      state.current.hash !== hash ||
      expected === null ||
      state.current.directories.every((value) => value === expected)
  ).within(3, "seconds");
});

const navigate = registerCustomAction(
  "transcript",
  (_document, window, id: string, tab: string, secondary: boolean) => {
    const dir = btoa(
      secondary ? "/home/test/secondary" : "/home/test/project/.transcripts"
    ).replaceAll("=", "");
    window.location.hash = `/transcripts/${dir}/${id}?tab=transcript-${tab}`;
    return Promise.resolve();
  }
);
const hops = actions(() =>
  ["alpha", "beta", "gamma"].flatMap((id) =>
    ["events", "messages"].flatMap((tab) => [
      navigate(id, tab, false),
      navigate(id, tab, true),
    ])
  )
);
const settle = registerCustomAction("settle", async (_document, window) => {
  await new Promise((resolve) => window.setTimeout(resolve, 1400));
});
const settleActions = actions(() => [settle()]);
const targets = extract(({ document, window }) =>
  Array.from(document.querySelectorAll('button, a, [role="tab"]')).flatMap(
    (element) => {
      const label =
        element.getAttribute("aria-label") ??
        element.getAttribute("title") ??
        element.textContent;
      if (
        !/transcript|event|message|turn|collapse|expand|timeline|metadata/i.test(
          label
        ) ||
        /tanstack|devtools|query key/i.test(label)
      )
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
const scrollPanel = registerCustomAction(
  "scrollPanel",
  async (document, window, ordinal: number, fraction: number) => {
    const panels = Array.from(document.querySelectorAll("*")).filter(
      (element) =>
        element.clientHeight > 0 &&
        element.scrollHeight > element.clientHeight &&
        /auto|scroll/.test(window.getComputedStyle(element).overflowY)
    );
    const panel = panels[ordinal % panels.length];
    if (!panel) return;
    const previous = panel.scrollTop;
    panel.scrollTo({
      top: fraction * (panel.scrollHeight - panel.clientHeight),
    });
    await new Promise((resolve) => window.setTimeout(resolve, 150));
    if (panel.scrollTop !== previous)
      document.body.dataset.panelScrollChecks = String(
        Number(document.body.dataset.panelScrollChecks ?? 0) + 1
      );
  }
);
const panelScrollActions = actions(() =>
  [0, 1, 2].flatMap((ordinal) =>
    [0, 0.5, 1].map((fraction) => scrollPanel(ordinal, fraction))
  )
);
export const interactions = weighted([
  [2, panelScrollActions],
  [5, hops],
  [4, clickTargets],
  [3, scroll],
  [1, back],
  [1, forward],
  [2, waitOnce],
  [3, settleActions],
]);
