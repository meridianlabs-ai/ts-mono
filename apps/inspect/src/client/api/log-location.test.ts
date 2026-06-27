import { beforeEach, describe, expect, test } from "vitest";

import {
  grantedLogUrlHref,
  hasApprovedSingleFileMode,
  LogLocationController,
  resetApprovedSingleFileModeForTest,
} from "./log-location";

const baseUrl = "https://viewer.example/app/index.html";

beforeEach(() => {
  resetApprovedSingleFileModeForTest();
});

describe("LogLocationController static grants", () => {
  test.each([
    ["run.eval", "https://viewer.example/app/logs/run.eval"],
    ["team/run.json", "https://viewer.example/app/logs/team/run.json"],
    ["logs/run.eval", "https://viewer.example/app/logs/run.eval"],
    ["/app/logs/run.eval", "https://viewer.example/app/logs/run.eval"],
    [
      "https://viewer.example/app/logs/run.eval",
      "https://viewer.example/app/logs/run.eval",
    ],
  ])("allows %s inside the configured root", (selection, expected) => {
    const locations = new LogLocationController({
      transport: "static",
      baseUrl,
      staticLogDir: "logs",
    });

    expect(
      locations.requestFileSelection(selection, { source: "route" })
    ).toEqual({ status: "approved", value: expected });
    expect(locations.getRequestSnapshot()).toBeNull();
  });

  test.each([
    "../api/delete.eval",
    "%2e%2e/api/delete.eval",
    "%252e%252e/api/delete.eval",
    "team/sub/../run.eval",
    "team%2frun.eval",
    "team%252frun.eval",
    "team\\run.eval",
    "https:logs/run.eval",
    "https://other.example/run.eval",
    "https://viewer.example/api/delete.eval",
  ])("does not automatically allow %s outside the configured root", (value) => {
    const locations = new LogLocationController({
      transport: "static",
      baseUrl,
      staticLogDir: "logs",
    });

    const decision = locations.requestFileSelection(value, { source: "route" });
    expect(decision.status).not.toBe("approved");
  });

  test("keeps an exact configured URL exact", () => {
    const locations = new LogLocationController({
      transport: "static",
      baseUrl,
      staticLogFile: "https://cdn.example/run.eval?token=one",
    });
    expect(hasApprovedSingleFileMode()).toBe(true);

    expect(
      locations.requestFileSelection("https://cdn.example/run.eval?token=one", {
        source: "route",
      })
    ).toEqual({
      status: "approved",
      value: "https://cdn.example/run.eval?token=one",
    });
    expect(
      locations.requestFileSelection("run.eval?token=one", {
        source: "route",
      })
    ).toEqual({
      status: "approved",
      value: "https://cdn.example/run.eval?token=one",
    });
    expect(locations.matchesActiveBrowserFile("run.eval?token=one")).toBe(true);
    expect(
      locations.requestFileSelection("https://cdn.example/run.eval?token=two", {
        source: "route",
      }).status
    ).toBe("pending");
  });

  test("an approved exact file becomes the active browser listing", () => {
    const locations = new LogLocationController({
      transport: "static",
      baseUrl,
      staticLogDir: "logs",
    });

    locations.requestFileSelection("https://cdn.example/run.eval", {
      source: "route",
      singleFile: true,
    });
    locations.approveRequest();

    expect(locations.getActiveBrowserDirectory()).toBeUndefined();
    expect(locations.getActiveBrowserFile()).toBe(
      "https://cdn.example/run.eval"
    );
  });

  test("an embedded exact file takes initial precedence over its directory", () => {
    const locations = new LogLocationController({
      transport: "static",
      baseUrl,
      staticLogDir: "logs",
      staticLogFile: "logs/run.eval",
    });

    expect(locations.getActiveBrowserDirectory()).toBeUndefined();
    expect(locations.getActiveBrowserFile()).toBe(
      "https://viewer.example/app/logs/run.eval"
    );

    locations.requestDirectorySelection("logs", "query");

    expect(locations.getActiveBrowserDirectory()).toBe(
      "https://viewer.example/app/logs/"
    );
    expect(locations.getActiveBrowserFile()).toBeUndefined();
  });

  test("does not collapse nested percent encodings across a directory root", () => {
    const locations = new LogLocationController({
      transport: "static",
      baseUrl,
      staticLogDir: "logs/%25",
    });

    expect(
      locations.requestFileSelection("run.eval", { source: "route" })
    ).toEqual({
      status: "approved",
      value: "https://viewer.example/app/logs/%25/run.eval",
    });
    expect(
      locations.requestFileSelection("/app/logs/%2525/run.eval", {
        source: "route",
      }).status
    ).not.toBe("approved");
  });

  test("treats a query-selected bundle member as approved single-file mode", () => {
    const locations = new LogLocationController({
      transport: "static",
      baseUrl,
      staticLogDir: "logs",
    });

    locations.initializeUrlSelection("?log_file=logs%2Frun.eval");

    expect(locations.getRequestSnapshot()).toBeNull();
    expect(
      locations.transportForFile("https://viewer.example/app/logs/run.eval")
    ).toBe("browser");
    expect(hasApprovedSingleFileMode()).toBe(true);
  });

  test("rejects unsafe manifest entries", () => {
    const locations = new LogLocationController({
      transport: "static",
      baseUrl,
      staticLogDir: "logs",
    });

    expect(
      grantedLogUrlHref(locations.requireManifestEntry("team/run.eval"))
    ).toBe("https://viewer.example/app/logs/team/run.eval");
    expect(() => locations.requireManifestEntry("../api/delete.eval")).toThrow(
      "outside the approved root"
    );
    expect(() =>
      locations.requireManifestEntry("https://other.example/run.eval")
    ).toThrow("absolute log entry");
    expect(() =>
      locations.requireManifestEntry(
        "https://viewer.example/app/logs/team/run.eval"
      )
    ).toThrow("absolute log entry");
  });
});

describe("LogLocationController explicit approval", () => {
  test("does not grant a query-selected URL before approval", () => {
    const locations = new LogLocationController({
      transport: "view-server",
      baseUrl,
    });

    locations.initializeUrlSelection(
      "?log_file=http%3A%2F%2F127.0.0.1%3A9000%2Frun.eval"
    );

    expect(locations.getRequestSnapshot()).toMatchObject({
      kind: "file",
      status: "approval",
      url: "http://127.0.0.1:9000/run.eval",
      singleFile: true,
    });
    expect(locations.transportForFile("http://127.0.0.1:9000/run.eval")).toBe(
      "blocked"
    );
    expect(hasApprovedSingleFileMode()).toBe(false);

    locations.approveRequest();

    expect(locations.transportForFile("http://127.0.0.1:9000/run.eval")).toBe(
      "browser"
    );
    expect(hasApprovedSingleFileMode()).toBe(true);
  });

  test("approves only the exact file and does not add host-wide trust", () => {
    const locations = new LogLocationController({
      transport: "view-server",
      baseUrl,
    });

    locations.requestFileSelection("https://logs.example/a.eval", {
      source: "query",
      singleFile: true,
    });
    locations.approveRequest();

    expect(locations.transportForFile("https://logs.example/a.eval")).toBe(
      "browser"
    );
    expect(locations.transportForFile("https://logs.example/b.eval")).toBe(
      "blocked"
    );
  });

  test("keeps an active browser grant when the approved file enters the list", () => {
    const locations = new LogLocationController({
      transport: "view-server",
      baseUrl,
    });
    const file = "https://logs.example/a.eval";

    locations.requestFileSelection(file, { source: "query" });
    locations.approveRequest();
    locations.registerListedLocations([{ name: file }]);

    expect(locations.requestFileSelection(file, { source: "listing" })).toEqual(
      { status: "approved", value: file }
    );
    expect(locations.transportForFile(file)).toBe("browser");
  });

  test("does not convert browser-listed files into server capabilities", () => {
    const locations = new LogLocationController({
      transport: "view-server",
      baseUrl,
    });
    const file = "https://logs.example/a.eval";

    locations.requestFileSelection(file, { source: "query" });
    locations.approveRequest();
    locations.registerListedLocations([{ name: file }]);
    locations.requestFileSelection("https://other.example/b.eval", {
      source: "route",
    });

    expect(locations.transportForFile(file)).toBe("blocked");
    expect(locations.listedFileForSelection(file)).toBeUndefined();
  });

  test("drops the prior ad hoc grant when the candidate changes", () => {
    const locations = new LogLocationController({
      transport: "view-server",
      baseUrl,
    });

    locations.requestFileSelection("https://logs.example/a.eval", {
      source: "query",
    });
    locations.approveRequest();
    locations.requestFileSelection("https://logs.example/b.eval", {
      source: "route",
    });

    expect(locations.transportForFile("https://logs.example/a.eval")).toBe(
      "blocked"
    );
    expect(locations.transportForFile("https://logs.example/b.eval")).toBe(
      "blocked"
    );

    locations.approveRequest();

    expect(locations.transportForFile("https://logs.example/b.eval")).toBe(
      "browser"
    );
  });

  test.each([
    "file:///tmp/run.eval",
    "data:application/json,{}",
    "blob:https://viewer.example/id",
    "command:run.eval",
    "vscode://file/run.eval",
    "//logs.example/run.eval",
    "https://user:pass@logs.example/run.eval",
  ])("never offers approval for %s", (value) => {
    const locations = new LogLocationController({
      transport: "view-server",
      baseUrl,
    });

    const decision = locations.requestFileSelection(value, {
      source: "query",
      singleFile: true,
    });
    expect(decision.status).toBe("rejected");
    expect(locations.getRequestSnapshot()).toMatchObject({
      status: "blocked",
      raw: value,
    });
  });

  test("dismissal prevents the same URL from immediately reopening the gate", () => {
    const locations = new LogLocationController({
      transport: "view-server",
      baseUrl,
    });

    locations.requestFileSelection("https://logs.example/run.eval", {
      source: "query",
    });
    locations.dismissRequest();

    expect(
      locations.requestFileSelection("https://logs.example/run.eval", {
        source: "query",
      })
    ).toEqual({
      status: "rejected",
      reason: "The log location was dismissed for this page.",
    });
    expect(locations.getRequestSnapshot()).toBeNull();
  });

  test("a dismissed candidate clears any stale prompt for another location", () => {
    const locations = new LogLocationController({
      transport: "view-server",
      baseUrl,
    });
    const dismissed = "https://logs.example/dismissed.eval";

    locations.requestFileSelection(dismissed, { source: "query" });
    locations.dismissRequest();
    locations.requestFileSelection("https://logs.example/other.eval", {
      source: "query",
    });
    locations.requestFileSelection(dismissed, { source: "query" });

    expect(locations.getRequestSnapshot()).toBeNull();
  });
});

describe("LogLocationController server and host scopes", () => {
  test("keeps an unlisted relative hash route server-scoped", () => {
    const locations = new LogLocationController({
      transport: "view-server",
      baseUrl,
    });

    expect(
      locations.requestFileSelection("run.eval", {
        source: "route",
        logDir: "/logs",
      })
    ).toEqual({ status: "approved", value: "/logs/run.eval" });
    expect(locations.transportForFile("/logs/run.eval")).toBe("base");
  });

  test("keeps an exact route grant across listing refreshes in the same scope", () => {
    const locations = new LogLocationController({
      transport: "view-server",
      baseUrl,
    });

    locations.requestFileSelection("run.eval", {
      source: "route",
      logDir: "/logs",
    });
    locations.registerListedLocations([], "/logs");

    expect(locations.transportForFile("/logs/run.eval")).toBe("base");

    locations.registerListedLocations([], "/other-logs");

    expect(locations.transportForFile("/logs/run.eval")).toBe("blocked");
  });

  test("recognizes the scoped form of a relative server listing", () => {
    const locations = new LogLocationController({
      transport: "view-server",
      baseUrl,
    });

    locations.registerListedLocations([{ name: "run.eval" }], "/logs");

    expect(locations.transportForFile("run.eval")).toBe("base");
    expect(locations.transportForFile("/logs/run.eval")).toBe("base");
    expect(locations.listedFileForSelection("/logs/run.eval")).toBe("run.eval");
    expect(locations.transportForFile("/other-logs/run.eval")).toBe("blocked");
  });

  test("does not silently server-scope an absolute HTTP route", () => {
    const locations = new LogLocationController({
      transport: "view-server",
      baseUrl,
    });

    expect(
      locations.requestFileSelection("http://127.0.0.1/run.eval", {
        source: "route",
        logDir: "/logs",
      }).status
    ).toBe("pending");
    expect(locations.transportForFile("http://127.0.0.1/run.eval")).toBe(
      "blocked"
    );
  });

  test("matches listed files exactly or by their scoped relative path", () => {
    const locations = new LogLocationController({
      transport: "view-server",
      baseUrl,
    });
    locations.registerListedLocations(
      [
        { name: "s3://bucket/logs/team/run.eval" },
        { name: "s3://bucket/logs/team-run.eval" },
      ],
      "s3://bucket/logs"
    );

    expect(
      locations.requestFileSelection("team/run.eval", { source: "route" })
    ).toEqual({
      status: "approved",
      value: "s3://bucket/logs/team/run.eval",
    });
    expect(
      locations.requestFileSelection("run.eval", { source: "route" })
    ).toEqual({ status: "approved", value: "run.eval" });
  });

  test("does not trust persisted or unlisted server paths", () => {
    const locations = new LogLocationController({
      transport: "view-server",
      baseUrl,
    });

    expect(locations.transportForFile("http://127.0.0.1/run.eval")).toBe(
      "blocked"
    );
    expect(locations.transportForFile("s3://other/run.eval")).toBe("blocked");
  });

  test("preserves a trusted VS Code exact-file selection", () => {
    const locations = new LogLocationController({
      transport: "vscode",
      baseUrl,
    });
    locations.trustHostFile("file:///tmp/run.eval");

    expect(
      locations.requestFileSelection("run.eval", {
        source: "host",
        logDir: "file:///tmp",
      })
    ).toEqual({
      status: "approved",
      value: "file:///tmp/run.eval",
    });
  });
});
