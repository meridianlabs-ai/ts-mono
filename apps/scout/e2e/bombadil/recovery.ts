import { always, eventually } from "@antithesishq/bombadil";
import {
  actions,
  extract,
  registerCustomAction,
  weighted,
} from "@antithesishq/bombadil/browser";
import { back, forward } from "@antithesishq/bombadil/browser/defaults/actions";

export {
  noUncaughtExceptions,
  noUnhandledPromiseRejections,
} from "@antithesishq/bombadil/browser/defaults/properties";

const state = extract(({ document, window }) => ({
  hash: window.location.hash,
  evidence: Array.from(
    document.body.innerText.matchAll(/RECOVERY_(primary|secondary)_(\d+)/g),
    (match) => `${match[1]}_${match[2]}`
  ),
  checks: Number(document.body.dataset.recoveryChecks ?? 0),
}));
export const eventuallyRecovers = always(() => {
  const hash = state.current.hash;
  const route = /^#\/transcripts\/([^/]+)\/retry-(\d+)/.exec(hash);
  const expected = route
    ? `${route[1] === "L2hvbWUvdGVzdC9zZWNvbmRhcnk" ? "secondary" : "primary"}_${route[2]}`
    : null;
  return eventually(
    () =>
      state.current.hash !== hash ||
      expected === null ||
      state.current.evidence.includes(expected)
  ).within(6, "seconds");
});
export const correctEvidenceAfterRetry = always(() => {
  const hash = state.current.hash;
  const route = /^#\/transcripts\/([^/]+)\/retry-(\d+)/.exec(hash);
  const expected = route
    ? `${route[1] === "L2hvbWUvdGVzdC9zZWNvbmRhcnk" ? "secondary" : "primary"}_${route[2]}`
    : null;
  return eventually(
    () =>
      state.current.hash !== hash ||
      expected === null ||
      state.current.evidence.every((value) => value === expected)
  ).within(3, "seconds");
});

const visit = registerCustomAction(
  "visitRecoveringTranscript",
  (_document, window, index: number, secondary: boolean, focused: boolean) => {
    const encoded = btoa(
      secondary ? "/home/test/secondary" : "/home/test/project/.transcripts"
    ).replaceAll("=", "");
    const suffix = focused
      ? `/event?event=recovery-${index}&tab=Summary`
      : "?tab=transcript-messages";
    window.location.hash = `/transcripts/${encoded}/retry-${index}${suffix}`;
    return Promise.resolve();
  }
);
const visits = actions(() =>
  Array.from({ length: 12 }, (_, index) =>
    [false, true].flatMap((secondary) =>
      [false, true].map((focused) => visit(index, secondary, focused))
    )
  ).flat()
);
const settle = registerCustomAction(
  "settleAfterRetry",
  async (document, window) => {
    const hash = window.location.hash;
    await new Promise((resolve) => window.setTimeout(resolve, 1400));
    if (window.location.hash !== hash) return;
    const route = /^#\/transcripts\/([^/]+)\/retry-(\d+)/.exec(hash);
    if (!route) return;
    const directory =
      route[1] === "L2hvbWUvdGVzdC9zZWNvbmRhcnk" ? "secondary" : "primary";
    const expected = new RegExp(`RECOVERY_${directory}_${route[2]}\\b`);
    if (expected.test(document.body.innerText))
      document.body.dataset.recoveryChecks = String(
        Number(document.body.dataset.recoveryChecks ?? 0) + 1
      );
  }
);
const settling = actions(() => [settle()]);
export const interactions = weighted([
  [3, visits],
  [5, settling],
  [1, back],
  [1, forward],
]);
