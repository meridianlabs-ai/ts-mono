import { describe, expect, test, vi } from "vitest";

import { locationAwareClientApi } from "./location-aware-client-api";
import { LogLocationController } from "./log-location";
import type { ClientAPI } from "./types";

const baseUrl = "https://viewer.example/index.html";

const client = (): ClientAPI => ({
  get_log_dir: vi.fn().mockResolvedValue("/logs"),
  get_log_dir_handle: vi.fn(
    (value: string | undefined): string => value ?? "default"
  ),
  get_logs: vi.fn().mockResolvedValue({ files: [], response_type: "full" }),
  get_log_root: vi.fn().mockResolvedValue({ logs: [], log_dir: "/logs" }),
  get_eval_set: vi.fn().mockResolvedValue(undefined),
  get_flow: vi.fn().mockResolvedValue(undefined),
  get_log_summaries: vi.fn().mockResolvedValue([]),
  get_log_details: vi.fn().mockResolvedValue({
    eval: { task: "task", model: "model" },
    sampleSummaries: [],
  }),
  get_log_sample: vi.fn().mockResolvedValue(undefined),
  client_events: vi.fn().mockResolvedValue([]),
  download_file: vi.fn(),
  open_log_file: vi.fn(),
  get_app_config: vi
    .fn()
    .mockResolvedValue({ inspect_version: "test", scout_version: null }),
});

describe("locationAwareClientApi", () => {
  test("dispatches server-listed logs to the base client", async () => {
    const base = client();
    const browser = client();
    const locations = new LogLocationController({
      transport: "view-server",
      baseUrl,
    });
    locations.registerListedLocations([{ name: "/logs/run.eval" }], "/logs");
    const api = locationAwareClientApi(base, browser, locations);

    await api.get_log_details("/logs/run.eval");

    expect(base.get_log_details).toHaveBeenCalledWith(
      "/logs/run.eval",
      undefined
    );
    expect(browser.get_log_details).not.toHaveBeenCalled();
  });

  test("dispatches the scoped form of a relative server listing", async () => {
    const base = client();
    const browser = client();
    const locations = new LogLocationController({
      transport: "view-server",
      baseUrl,
    });
    locations.registerListedLocations([{ name: "run.eval" }], "/logs");
    const api = locationAwareClientApi(base, browser, locations);

    await api.get_log_sample("/logs/run.eval", 1, 1);

    expect(base.get_log_sample).toHaveBeenCalledWith(
      "/logs/run.eval",
      1,
      1,
      undefined
    );
    expect(browser.get_log_sample).not.toHaveBeenCalled();
  });

  test("dispatches an explicitly approved URL only to the browser client", async () => {
    const base = client();
    const browser = client();
    const locations = new LogLocationController({
      transport: "view-server",
      baseUrl,
    });
    locations.requestFileSelection("https://logs.example/run.eval", {
      source: "query",
      singleFile: true,
    });
    locations.approveRequest();
    const api = locationAwareClientApi(base, browser, locations);

    await api.get_log_details("https://logs.example/run.eval");

    expect(browser.get_log_details).toHaveBeenCalledWith(
      "https://logs.example/run.eval",
      undefined
    );
    expect(base.get_log_details).not.toHaveBeenCalled();
  });

  test("blocks persisted or unlisted locations before either client", async () => {
    const base = client();
    const browser = client();
    const locations = new LogLocationController({
      transport: "view-server",
      baseUrl,
    });
    const api = locationAwareClientApi(base, browser, locations);

    await expect(
      api.get_log_details("http://127.0.0.1/run.eval")
    ).rejects.toThrow("outside the active capability");
    expect(base.get_log_details).not.toHaveBeenCalled();
    expect(browser.get_log_details).not.toHaveBeenCalled();
  });

  test("does not forward edits for a browser-hosted log", async () => {
    const base = { ...client(), edit_log: vi.fn() };
    const browser = client();
    const locations = new LogLocationController({
      transport: "view-server",
      baseUrl,
    });
    locations.requestFileSelection("https://logs.example/run.eval", {
      source: "query",
    });
    locations.approveRequest();
    const api = locationAwareClientApi(base, browser, locations);

    await expect(
      api.edit_log?.("https://logs.example/run.eval", {
        edits: [],
        provenance: { author: "a", timestamp: "t", metadata: {} },
      })
    ).rejects.toThrow("not supported");
    expect(base.edit_log).not.toHaveBeenCalled();
  });
});
