// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createWebviewStorage } from "@tsmono/util";

import { createRestorableHashRouter } from "./routing";

const routers: ReturnType<typeof createRestorableHashRouter>[] = [];
const routes = [{ path: "*", element: null }];
const key = "route-v1";

function webview(initialState?: unknown) {
  let saved = initialState;
  const storage = createWebviewStorage({
    getState: () => saved,
    setState: (value) => {
      saved = structuredClone(value);
    },
    postMessage: () => {},
  });
  return storage;
}

function open(options: Parameters<typeof createRestorableHashRouter>[1]) {
  const router = createRestorableHashRouter(routes, options);
  routers.push(router);
  return router;
}

beforeEach(() => window.history.replaceState(null, "", "/"));
afterEach(() => {
  for (const router of routers) router.dispose();
  routers.length = 0;
});

describe("webview route restoration", () => {
  it.each([
    "/logs/run.eval/samples/sample/0/1/events?event=e1&tab=raw",
    "/transcripts/directory/transcript?rail=search#anchor",
    "/validation?set=example",
    "/scans",
    "/",
  ])(
    "resumes the exact location %s immediately after recreation",
    async (path) => {
      const storage = webview();
      const first = open({ key, storage, initialPath: "/project" });
      await first.navigate(path);
      expect(storage.getItem(key)).toBe(path);
      first.dispose();

      window.history.replaceState(null, "", "/");
      const restored = open({ key, storage, initialPath: "/project" });
      const location = restored.state.location;
      expect(location.pathname + location.search + location.hash).toBe(path);
    }
  );

  it("honors explicit deep links over a saved location and the launch route", () => {
    const storage = webview({ [key]: "/old" });
    window.history.replaceState(null, "", "/#/new?scanner=a");
    const router = open({ key, storage, initialPath: "/launch" });
    expect(router.state.location.pathname).toBe("/new");
    expect(storage.getItem(key)).toBe("/new?scanner=a");
  });

  it("allows fresh host navigation after restoring, without replaying the launch route", async () => {
    const storage = webview({ [key]: "/restored" });
    const router = open({ key, storage, initialPath: "/launch" });
    await router.navigate("/host-command?event=next", { replace: true });
    expect(storage.getItem(key)).toBe("/host-command?event=next");
  });

  it.each([
    {
      "app-storage": JSON.stringify({
        state: { app: { urlHash: "#/old-sample" } },
      }),
    },
    {
      "inspect-scout-storage": JSON.stringify({
        state: {
          selectedScanLocation: "old-scan",
          displayedScanResult: "old-result",
        },
      }),
    },
  ])(
    "starts from the launch route when only an old UI snapshot exists",
    (snapshot) => {
      const storage = webview(snapshot);
      const router = open({ key, storage, initialPath: "/launch" });
      expect(router.state.location.pathname).toBe("/launch");
      expect(storage.getItem(key)).toBe("/launch");
    }
  );

  it.each(["https://example.com", "//example.com", "invalid"])(
    "ignores invalid checkpoints: %s",
    (saved) => {
      expect(
        open({
          key,
          storage: webview({ [key]: saved }),
          initialPath: "/launch",
        }).state.location.pathname
      ).toBe("/launch");
    }
  );

  it("does not restore a prior session in browser mode", async () => {
    const first = open({ key });
    await first.navigate("/previous");
    first.dispose();
    window.history.replaceState(null, "", "/");
    expect(open({ key }).state.location.pathname).toBe("/");
  });
});
