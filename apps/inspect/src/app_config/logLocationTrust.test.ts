// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import { proposeLogLocation, scopeRouteLogFile } from "./logLocationTrust";

// jsdom serves the "page" at http://localhost:3000/.
const page = new URL("http://localhost:3000/viewer/index.html");

describe("proposeLogLocation", () => {
  it("no invocation source → nothing to approve", () => {
    expect(proposeLogLocation({ kind: "none" }, page)).toBeUndefined();
  });

  it("relative and same-origin locations are the page's own scope", () => {
    expect(
      proposeLogLocation({ kind: "dir", logDir: "logs" }, page)
    ).toBeUndefined();
    expect(
      proposeLogLocation({ kind: "file", logFile: "/data/run.eval" }, page)
    ).toBeUndefined();
    expect(
      proposeLogLocation(
        { kind: "dir", logDir: "http://localhost:3000/other/logs" },
        page
      )
    ).toBeUndefined();
  });

  it("another origin is proposed, naming the origin that would be contacted", () => {
    expect(
      proposeLogLocation(
        { kind: "dir", logDir: "https://bucket.example/team/logs" },
        page
      )
    ).toEqual({
      kind: "dir",
      location: "https://bucket.example/team/logs",
      origin: "https://bucket.example",
    });
    expect(
      proposeLogLocation(
        { kind: "file", logFile: "http://10.0.0.5:8080/run.eval" },
        page
      )
    ).toEqual({
      kind: "file",
      location: "http://10.0.0.5:8080/run.eval",
      origin: "http://10.0.0.5:8080",
    });
  });

  it("a scheme or port change is another origin, as is a protocol-relative link", () => {
    expect(
      proposeLogLocation(
        { kind: "dir", logDir: "https://localhost:3000/logs" },
        page
      )?.origin
    ).toBe("https://localhost:3000");
    expect(
      proposeLogLocation(
        { kind: "dir", logDir: "http://localhost:3001/logs" },
        page
      )?.origin
    ).toBe("http://localhost:3001");
    expect(
      proposeLogLocation({ kind: "dir", logDir: "//evil.example/logs" }, page)
        ?.origin
    ).toBe("http://evil.example");
  });

  it("an opaque location shows the whole value in place of an origin", () => {
    expect(
      proposeLogLocation({ kind: "file", logFile: "data:text/plain,x" }, page)
    ).toEqual({
      kind: "file",
      location: "data:text/plain,x",
      origin: "data:text/plain,x",
    });
  });
});

describe("scopeRouteLogFile", () => {
  const logDir = "http://localhost:3000/logs";

  it("absolutizes a relative route name against the log dir", () => {
    expect(scopeRouteLogFile("run.eval", logDir, true)).toBe(
      "http://localhost:3000/logs/run.eval"
    );
    expect(scopeRouteLogFile("nested/run.eval", logDir, false)).toBe(
      "http://localhost:3000/logs/nested/run.eval"
    );
  });

  it("keeps an absolute name that sits under the log dir", () => {
    expect(
      scopeRouteLogFile("http://localhost:3000/logs/run.eval", logDir, true)
    ).toBe("http://localhost:3000/logs/run.eval");
  });

  it("works when single-file mode left the dir page-relative", () => {
    expect(scopeRouteLogFile("logs/run.eval", "logs", true)).toBe(
      "logs/run.eval"
    );
  });

  it("browser-direct: refuses a name outside the log dir", () => {
    expect(() =>
      scopeRouteLogFile("https://evil.example/run.eval", logDir, true)
    ).toThrow(/outside the configured log directory/);
    expect(() =>
      scopeRouteLogFile("http://localhost:3000/private/run.eval", logDir, true)
    ).toThrow(/outside the configured log directory/);
    expect(() =>
      scopeRouteLogFile("../private/run.eval", logDir, true)
    ).toThrow(/outside the configured log directory/);
  });

  it("proxied backends pass a foreign name through for the server to judge", () => {
    expect(
      scopeRouteLogFile("s3://bucket/other/run.eval", "/logs", false)
    ).toBe("s3://bucket/other/run.eval");
  });
});
