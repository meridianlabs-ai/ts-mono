import { describe, expect, it } from "vitest";

import { createWebviewStorage } from "./webviewStorage";

describe("webview storage", () => {
  it("keeps route and delayed UI writes independent, including legacy Inspect state", () => {
    let state: unknown = '{"version":4,"state":{"app":{"urlHash":"/old"}}}';
    const api = {
      getState: () => state,
      setState: (value: unknown) => {
        state = structuredClone(value);
      },
      postMessage: () => {},
    };
    const ui = createWebviewStorage(api, "app-storage");
    const route = createWebviewStorage(api, "app-storage");
    const legacy = ui.getItem("app-storage");
    route.setItem("route-v1", "/new?event=one");
    expect(ui.getItem("app-storage")).toBe(legacy);
    ui.setItem("app-storage", "new UI state");
    expect(route.getItem("route-v1")).toBe("/new?event=one");
    ui.removeItem("app-storage");
    expect(route.getItem("route-v1")).toBe("/new?event=one");
  });

  it.each([undefined, null, 42, [], "unrecognized"])(
    "starts with empty named snapshots for %s",
    (initial) => {
      let state: unknown = initial;
      const storage = createWebviewStorage({
        getState: () => state,
        setState: (value) => {
          state = value;
        },
        postMessage: () => {},
      });
      expect(storage.getItem("constructor")).toBeNull();
      storage.setItem("__proto__", "own entry");
      expect(storage.getItem("__proto__")).toBe("own entry");
      storage.removeItem("__proto__");
      expect(storage.getItem("__proto__")).toBeNull();
    }
  );
});
