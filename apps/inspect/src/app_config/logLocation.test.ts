import { afterEach, describe, expect, it } from "vitest";

import {
  assertLogLocationGranted,
  configureLogLocationPolicy,
  evaluateLogLocation,
  grantLogLocation,
  requireSafeBrowserLogUrl,
  resetLogLocationPolicy,
  validateProxiedLogLocation,
} from "../client/api/logLocation";

afterEach(() => {
  resetLogLocationPolicy();
});

describe("evaluateLogLocation", () => {
  const directoryScope = {
    kind: "directory" as const,
    location: "https://viewer.example/bundles/logs",
  };

  it("keeps relative files inside a trusted directory automatic", () => {
    expect(evaluateLogLocation("nested/run.eval", directoryScope)).toEqual({
      status: "allowed",
      href: "https://viewer.example/bundles/logs/nested/run.eval",
    });
  });

  it("blocks a relative path that escapes the trusted directory", () => {
    expect(
      evaluateLogLocation("../private/run.eval", directoryScope)
    ).toMatchObject({
      status: "blocked",
    });
  });

  it("does not confuse a sibling directory for the trusted prefix", () => {
    expect(
      evaluateLogLocation(
        "https://viewer.example/bundles/logs-private/run.eval",
        directoryScope
      )
    ).toMatchObject({ status: "approval" });
  });

  it.each([
    "nested/%2e%2e/private.eval",
    "nested/%252e%252e/private.eval",
    "nested%2frun.eval",
    "nested%255crun.eval",
  ])("blocks unsafe encoded path %s", (location) => {
    expect(evaluateLogLocation(location, directoryScope)).toMatchObject({
      status: "blocked",
    });
  });

  it("requires approval for an absolute route outside the trusted directory", () => {
    expect(
      evaluateLogLocation("https://logs.example/run.eval", directoryScope)
    ).toMatchObject({
      status: "approval",
      href: "https://logs.example/run.eval",
      origin: "https://logs.example",
    });
  });

  it("allows only the exact publisher-configured file", () => {
    const fileScope = {
      kind: "file" as const,
      location: "https://logs.example/fixed.eval",
    };
    expect(
      evaluateLogLocation("https://logs.example/fixed.eval", fileScope)
    ).toMatchObject({ status: "allowed" });
    expect(
      evaluateLogLocation("https://logs.example/other.eval", fileScope)
    ).toMatchObject({ status: "approval" });
  });

  it.each([
    "file:///tmp/run.eval",
    "data:application/json,{}",
    "blob:https://viewer.example/id",
    "command:run.eval",
    "//logs.example/run.eval",
    "https://user:secret@logs.example/run.eval",
    "https://logs.example/run.eval#fragment",
  ])("blocks unsupported location %s", (location) => {
    expect(evaluateLogLocation(location, directoryScope)).toMatchObject({
      status: "blocked",
    });
  });
});

describe("proxied log locations", () => {
  it.each([
    "nested/run.eval",
    "/workspace/logs/run.eval",
    "file:///logs/run.eval",
  ])("allows safe proxy input %s", (location) => {
    expect(validateProxiedLogLocation(location)).toEqual({
      status: "allowed",
      href: location,
    });
  });

  it.each([
    "../private.eval",
    "..%2Fprivate.eval",
    "//logs.example/private.eval",
    "https://user:secret@logs.example/private.eval",
    "command:private.eval",
  ])("blocks unsafe proxy input %s", (location) => {
    expect(validateProxiedLogLocation(location)).toMatchObject({
      status: "blocked",
    });
  });
});

describe("runtime log location policy", () => {
  it("fails closed before a policy is configured", () => {
    expect(() =>
      assertLogLocationGranted("https://logs.example/run.eval")
    ).toThrow(/not been approved/);
  });

  it("blocks requests until the proposed location is granted", () => {
    const location = "https://logs.example/run.eval";
    configureLogLocationPolicy({ kind: "file", location }, false);

    expect(() => assertLogLocationGranted(location)).toThrow(
      /not been approved/
    );

    grantLogLocation({ kind: "file", location });
    expect(() => assertLogLocationGranted(location)).not.toThrow();
    expect(() =>
      assertLogLocationGranted("https://logs.example/other.eval")
    ).toThrow(/not been approved/);
  });
});

describe("browser-direct capability URLs", () => {
  it("canonicalizes a same-origin relative URL", () => {
    expect(requireSafeBrowserLogUrl("/logs/run.eval")).toBe(
      "http://localhost:3000/logs/run.eval"
    );
  });

  it.each([
    "file:///tmp/run.eval",
    "https://user:secret@logs.example/run.eval",
    "https://logs.example/run.eval#fragment",
  ])("rejects unsafe capability URL %s", (location) => {
    expect(() => requireSafeBrowserLogUrl(location)).toThrow();
  });
});
