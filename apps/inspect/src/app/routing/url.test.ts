/**
 * Tests for URL route parsing and construction.
 *
 * The parsers are pure functions exported from url.ts, so these tests
 * exercise the same code the routing hooks use.
 */
import { describe, expect, test } from "vitest";

import { directoryRelativeUrl } from "@tsmono/util";

import {
  decodeUrlParam,
  logSamplesUrl,
  parseLogRouteParams,
  parseSamplesRouteParams,
  printSampleUrl,
  samplesSampleUrl,
} from "./url";

describe("parseLogRouteParams", () => {
  describe("sample UUID routes", () => {
    test("parses /logs/path/to/file.eval/samples/sample_uuid/uuid123", () => {
      const result = parseLogRouteParams(
        "path/to/file.eval/samples/sample_uuid/uuid123"
      );
      expect(result).toEqual({
        logPath: "path/to/file.eval",
        tabId: undefined,
        sampleTabId: undefined,
        sampleId: undefined,
        epoch: undefined,
        sampleUuid: "uuid123",
      });
    });

    test("parses sample UUID with tab ID", () => {
      const result = parseLogRouteParams(
        "path/to/file.eval/samples/sample_uuid/uuid123/transcript"
      );
      expect(result).toEqual({
        logPath: "path/to/file.eval",
        tabId: undefined,
        sampleTabId: "transcript",
        sampleId: undefined,
        epoch: undefined,
        sampleUuid: "uuid123",
      });
    });

    test("handles trailing slash in sample UUID route", () => {
      const result = parseLogRouteParams(
        "path/to/file.eval/samples/sample_uuid/uuid123/"
      );
      expect(result).toEqual({
        logPath: "path/to/file.eval",
        tabId: undefined,
        sampleTabId: undefined,
        sampleId: undefined,
        epoch: undefined,
        sampleUuid: "uuid123",
      });
    });
  });

  describe("full sample routes with /samples/sample/ pattern", () => {
    test("parses /logs/path/samples/sample/sampleId/epoch", () => {
      const result = parseLogRouteParams(
        "path/to/file.eval/samples/sample/123/1"
      );
      expect(result).toEqual({
        logPath: "path/to/file.eval",
        tabId: undefined,
        sampleTabId: undefined,
        sampleId: "123",
        epoch: "1",
      });
    });

    test("parses sample route with tab ID", () => {
      const result = parseLogRouteParams(
        "path/to/file.eval/samples/sample/123/1/transcript"
      );
      expect(result).toEqual({
        logPath: "path/to/file.eval",
        tabId: undefined,
        sampleTabId: "transcript",
        sampleId: "123",
        epoch: "1",
      });
    });

    test("handles string sample IDs", () => {
      const result = parseLogRouteParams(
        "path/to/file.eval/samples/sample/my-sample-id/2/messages"
      );
      expect(result).toEqual({
        logPath: "path/to/file.eval",
        tabId: undefined,
        sampleTabId: "messages",
        sampleId: "my-sample-id",
        epoch: "2",
      });
    });

    test("handles trailing slash", () => {
      const result = parseLogRouteParams(
        "path/to/file.eval/samples/sample/123/1/"
      );
      expect(result).toEqual({
        logPath: "path/to/file.eval",
        tabId: undefined,
        sampleTabId: undefined,
        sampleId: "123",
        epoch: "1",
      });
    });
  });

  describe("samples listing routes", () => {
    test("parses /logs/path/samples (samples listing)", () => {
      const result = parseLogRouteParams("path/to/file.eval/samples");
      expect(result).toEqual({
        logPath: "path/to/file.eval",
        tabId: "samples",
        sampleTabId: undefined,
        sampleId: undefined,
        epoch: undefined,
      });
    });

    test("parses /logs/path/samples/transcript (samples with tab)", () => {
      const result = parseLogRouteParams(
        "path/to/file.eval/samples/transcript"
      );
      expect(result).toEqual({
        logPath: "path/to/file.eval",
        tabId: "samples",
        sampleTabId: "transcript",
        sampleId: undefined,
        epoch: undefined,
      });
    });

    test("parses /logs/path/samples/messages (samples with messages tab)", () => {
      const result = parseLogRouteParams("path/to/file.eval/samples/messages");
      expect(result).toEqual({
        logPath: "path/to/file.eval",
        tabId: "samples",
        sampleTabId: "messages",
        sampleId: undefined,
        epoch: undefined,
      });
    });
  });

  describe("single sample mode (sampleId/epoch without /sample/ prefix)", () => {
    test("parses /logs/path/samples/sampleId/epoch", () => {
      const result = parseLogRouteParams("path/to/file.eval/samples/456/3");
      expect(result).toEqual({
        logPath: "path/to/file.eval",
        tabId: undefined,
        sampleTabId: undefined,
        sampleId: "456",
        epoch: "3",
      });
    });
  });

  describe("regular log routes (no samples)", () => {
    test("parses /logs/path/to/file.eval", () => {
      const result = parseLogRouteParams("path/to/file.eval");
      expect(result).toEqual({
        logPath: "path/to/file.eval",
        tabId: undefined,
        sampleTabId: undefined,
        sampleId: undefined,
        epoch: undefined,
      });
    });

    test("parses /logs/path/to/file.eval/info (with tab)", () => {
      const result = parseLogRouteParams("path/to/file.eval/info");
      expect(result).toEqual({
        logPath: "path/to/file.eval",
        tabId: "info",
        sampleTabId: undefined,
        sampleId: undefined,
        epoch: undefined,
      });
    });

    test("parses /logs/path/to/file.eval/json (with json tab)", () => {
      const result = parseLogRouteParams("path/to/file.eval/json");
      expect(result).toEqual({
        logPath: "path/to/file.eval",
        tabId: "json",
        sampleTabId: undefined,
        sampleId: undefined,
        epoch: undefined,
      });
    });

    test("handles empty path", () => {
      const result = parseLogRouteParams("");
      expect(result).toEqual({
        logPath: undefined,
        tabId: undefined,
        sampleTabId: undefined,
        sampleId: undefined,
        epoch: undefined,
      });
    });
  });

  describe("URL encoding handling", () => {
    test("decodes URL-encoded path segments", () => {
      const result = parseLogRouteParams(
        "path/to/file%20with%20spaces.eval/samples"
      );
      expect(result).toEqual({
        logPath: "path/to/file with spaces.eval",
        tabId: "samples",
        sampleTabId: undefined,
        sampleId: undefined,
        epoch: undefined,
      });
    });

    test("decodes URL-encoded sample IDs", () => {
      const result = parseLogRouteParams(
        "path/to/file.eval/samples/sample/sample%2Fid/1"
      );
      expect(result).toEqual({
        logPath: "path/to/file.eval",
        tabId: undefined,
        sampleTabId: undefined,
        sampleId: "sample/id",
        epoch: "1",
      });
    });
  });

  describe("ambiguous route patterns (regression tests)", () => {
    test("sample_uuid pattern takes precedence over sampleId pattern", () => {
      // This tests that /samples/sample_uuid/X is recognized as UUID, not as sampleId="sample_uuid"
      const result = parseLogRouteParams(
        "path/file.eval/samples/sample_uuid/abc123"
      );
      expect(result.sampleUuid).toBe("abc123");
      expect(result.sampleId).toBeUndefined();
    });

    test("/samples/sample/ pattern takes precedence over simple sampleId", () => {
      // /samples/sample/X/Y should be recognized as full sample route
      const result = parseLogRouteParams(
        "path/file.eval/samples/sample/myid/5"
      );
      expect(result.sampleId).toBe("myid");
      expect(result.epoch).toBe("5");
    });

    test("numeric-looking string is treated as sampleId, not epoch", () => {
      // When we have /samples/123/456, first is sampleId, second is epoch
      const result = parseLogRouteParams("path/file.eval/samples/123/456");
      expect(result.sampleId).toBe("123");
      expect(result.epoch).toBe("456");
    });

    test("known tab IDs are recognized in samples context", () => {
      // /samples/transcript should be recognized as sampleTabId
      const result = parseLogRouteParams("path/file.eval/samples/transcript");
      expect(result.sampleTabId).toBe("transcript");
      expect(result.sampleId).toBeUndefined();
    });

    test("unknown segment after /samples/ is treated as sampleId", () => {
      // /samples/unknownvalue should be treated as sampleId
      const result = parseLogRouteParams("path/file.eval/samples/unknownvalue");
      expect(result.sampleId).toBe("unknownvalue");
      expect(result.sampleTabId).toBeUndefined();
    });
  });

  describe("complex file paths", () => {
    test("handles deeply nested paths", () => {
      const result = parseLogRouteParams(
        "very/deeply/nested/path/to/file.eval/samples"
      );
      expect(result).toEqual({
        logPath: "very/deeply/nested/path/to/file.eval",
        tabId: "samples",
        sampleTabId: undefined,
        sampleId: undefined,
        epoch: undefined,
      });
    });

    test("handles paths with dots in directory names", () => {
      const result = parseLogRouteParams(
        "path/with.dots/in.dirs/file.eval/info"
      );
      expect(result).toEqual({
        logPath: "path/with.dots/in.dirs/file.eval",
        tabId: "info",
        sampleTabId: undefined,
        sampleId: undefined,
        epoch: undefined,
      });
    });

    test("handles paths with file: prefix in samples route", () => {
      // Note: file: prefix is passed through as-is in /samples pattern
      const result = parseLogRouteParams(
        "file:/Users/test/path/file.eval/samples"
      );
      expect(result).toEqual({
        logPath: "file:/Users/test/path/file.eval",
        tabId: "samples",
        sampleTabId: undefined,
        sampleId: undefined,
        epoch: undefined,
      });
    });

    test("handles paths with file: prefix normalized for workspace tabs", () => {
      // file: prefix gets normalized with /// when reaching workspace tab logic
      const result = parseLogRouteParams(
        "file:/Users/test/path/file.eval/info"
      );
      expect(result).toEqual({
        logPath: "file:///Users/test/path/file.eval",
        tabId: "info",
        sampleTabId: undefined,
        sampleId: undefined,
        epoch: undefined,
      });
    });
  });
});

describe("parseSamplesRouteParams", () => {
  test("parses /samples/path/to/file.eval/sample/id/epoch", () => {
    const result = parseSamplesRouteParams(
      "path/to/file.eval/sample/my-sample/1"
    );
    expect(result).toEqual({
      samplesPath: "path/to/file.eval",
      sampleId: "my-sample",
      epoch: "1",
      tabId: undefined,
    });
  });

  test("parses sample route with tab ID", () => {
    const result = parseSamplesRouteParams(
      "path/to/file.eval/sample/123/2/transcript"
    );
    expect(result).toEqual({
      samplesPath: "path/to/file.eval",
      sampleId: "123",
      epoch: "2",
      tabId: "transcript",
    });
  });

  test("parses folder-only path", () => {
    const result = parseSamplesRouteParams("path/to/folder");
    expect(result).toEqual({
      samplesPath: "path/to/folder",
      sampleId: undefined,
      epoch: undefined,
      tabId: undefined,
    });
  });

  test("handles empty path", () => {
    const result = parseSamplesRouteParams("");
    expect(result).toEqual({
      samplesPath: undefined,
      sampleId: undefined,
      epoch: undefined,
      tabId: undefined,
    });
  });

  test("handles trailing slash", () => {
    const result = parseSamplesRouteParams("path/to/file.eval/sample/123/1/");
    expect(result).toEqual({
      samplesPath: "path/to/file.eval",
      sampleId: "123",
      epoch: "1",
      tabId: undefined,
    });
  });
});

describe("decodeUrlParam", () => {
  test("decodes URL-encoded strings", () => {
    expect(decodeUrlParam("hello%20world")).toBe("hello world");
    expect(decodeUrlParam("path%2Fto%2Ffile")).toBe("path/to/file");
  });

  test("returns undefined for undefined input", () => {
    expect(decodeUrlParam(undefined)).toBeUndefined();
  });

  test("returns original string if not encoded", () => {
    expect(decodeUrlParam("hello")).toBe("hello");
  });

  test("handles invalid encoding gracefully", () => {
    // Invalid percent encoding should return original
    expect(decodeUrlParam("%ZZ")).toBe("%ZZ");
  });
});

describe("sample IDs with slashes", () => {
  test("logSamplesUrl encodes slashes in sample IDs", () => {
    const url = logSamplesUrl(
      "path/to/file.eval",
      "ascii/car",
      1,
      "transcript"
    );
    // The slash in "ascii/car" should be encoded as %2F
    expect(url).toContain("ascii%2Fcar");
  });

  test("samplesSampleUrl encodes slashes in sample IDs", () => {
    const url = samplesSampleUrl(
      "path/to/file.eval",
      "ascii/car",
      1,
      "transcript"
    );
    // The slash in "ascii/car" should be encoded as %2F
    expect(url).toContain("ascii%2Fcar");
  });

  test("printSampleUrl encodes slashes in sample IDs", () => {
    const url = printSampleUrl(
      "path/to/file.eval",
      "ascii/car",
      1,
      "transcript"
    );
    expect(url).toContain("ascii%2Fcar");
    expect(url).toContain("?view=transcript");
  });

  test("parseLogRouteParams decodes slashes in sample IDs", () => {
    // When the URL has an encoded slash, parsing should decode it
    const result = parseLogRouteParams(
      "path/to/file.eval/samples/sample/ascii%2Fcar/1/transcript"
    );
    expect(result.sampleId).toBe("ascii/car");
    expect(result.epoch).toBe("1");
    expect(result.sampleTabId).toBe("transcript");
  });

  test("parseSamplesRouteParams decodes slashes in sample IDs", () => {
    const result = parseSamplesRouteParams(
      "path/to/file.eval/sample/ascii%2Fcar/1/transcript"
    );
    expect(result.sampleId).toBe("ascii/car");
    expect(result.epoch).toBe("1");
    expect(result.tabId).toBe("transcript");
  });

  test("round-trip: logSamplesUrl then parseLogRouteParams", () => {
    const url = logSamplesUrl(
      "path/to/file.eval",
      "ascii/car",
      1,
      "transcript"
    );
    // Extract the path portion after /logs/
    const path = url.replace(/^\/logs\//, "");
    const result = parseLogRouteParams(path);
    expect(result.sampleId).toBe("ascii/car");
    expect(result.epoch).toBe("1");
    expect(result.logPath).toBe("path/to/file.eval");
  });

  test("round-trip: printSampleUrl then parseLogRouteParams", () => {
    const url = printSampleUrl(
      "path/to/file.eval",
      "ascii/car",
      1,
      "transcript"
    );
    // Extract the path portion after /logs/, stripping query params
    const pathWithoutQuery = url.split("?")[0];
    if (pathWithoutQuery === undefined) {
      throw new Error(`unexpected url with no path: ${url}`);
    }
    const path = pathWithoutQuery.replace(/^\/logs\//, "");
    const result = parseLogRouteParams(path);
    expect(result.sampleId).toBe("ascii/car");
    expect(result.epoch).toBe("1");
    expect(result.sampleTabId).toBe("print");
    expect(result.logPath).toBe("path/to/file.eval");
  });

  test("round-trip: samplesSampleUrl then parseSamplesRouteParams", () => {
    const url = samplesSampleUrl(
      "path/to/file.eval",
      "ascii/car",
      1,
      "transcript"
    );
    // Extract the path portion after /samples/
    const path = url.replace(/^\/samples\//, "");
    const result = parseSamplesRouteParams(path);
    expect(result.sampleId).toBe("ascii/car");
    expect(result.epoch).toBe("1");
    expect(result.samplesPath).toBe("path/to/file.eval");
  });

  test("handles multiple slashes in sample ID", () => {
    const url = logSamplesUrl(
      "path/to/file.eval",
      "category/sub/item",
      1,
      "transcript"
    );
    // All slashes should be encoded
    expect(url).toContain("category%2Fsub%2Fitem");
  });

  test("handles sample ID that is just a slash", () => {
    const url = logSamplesUrl("path/to/file.eval", "/", 1, "transcript");
    expect(url).toContain("%2F");
    expect(url).not.toMatch(/\/samples\/sample\/\/\d/); // Should not have literal double slash
  });
});

// Regression: prev/next from the focus view on the /samples surface must build
// a log-dir-relative samples URL that keeps the "event" tab (so the sibling
// sample stays in focus mode), NOT the absolute file: URI on the plain sample
// view. Guards the two defects fixed by routing prev/next through the samples
// route params (relative path + event tab) instead of useLogRouteParams.
describe("prev/next from focus view (samples surface)", () => {
  const logDir = "file:///home/peter/logs";
  const absoluteLogFile = "file:///home/peter/logs/retry-single/demo.eval";

  test("builds a relative /samples URL preserving the event tab", () => {
    const relative = directoryRelativeUrl(absoluteLogFile, logDir);
    expect(relative).toBe("retry-single/demo.eval");

    const url = samplesSampleUrl(relative, "fail_fast", 1, "event");
    expect(url).toBe(
      "/samples/retry-single/demo.eval/sample/fail_fast/1/event"
    );
    expect(url).not.toContain("file:"); // no absolute URI leaked into the path
    expect(url).not.toContain("?event="); // focused event id belongs to the old sample
  });

  test("round-trip keeps the event tab and relative path", () => {
    const relative = directoryRelativeUrl(absoluteLogFile, logDir);
    const url = samplesSampleUrl(relative, "fail_fast", 1, "event");
    const result = parseSamplesRouteParams(url.replace(/^\/samples\//, ""));
    expect(result).toEqual({
      samplesPath: "retry-single/demo.eval",
      sampleId: "fail_fast",
      epoch: "1",
      tabId: "event",
    });
  });
});
