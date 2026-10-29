// @vitest-environment jsdom
import { QueryClient, skipToken } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

import { encodeBase64Url } from "@tsmono/util";

import { apiScoutServer } from "../../api/api-scout-server";
import { server } from "../../test/setup-msw";

import {
  isInvalidationTopic,
  projectConfigQuery,
  scanDataframeDetailQuery,
  scanQuery,
  topicQueries,
  topicTag,
  transcriptsByIdsQuery,
} from "./queries";

const api = apiScoutServer();

describe("topic tags", () => {
  it("topicQueries matches only queries carrying the topic's tag", () => {
    const queryClient = new QueryClient();
    const cache = queryClient.getQueryCache();
    for (const queryKey of [
      scanQuery(api, { scansDir: "/scans", scanPath: "a.scan" }).queryKey,
      projectConfigQuery(api).queryKey,
      ["untagged", "/dir"],
    ]) {
      cache.build(queryClient, { queryKey });
    }

    const keysFor = (topic: "scans" | "project-config" | "transcripts") =>
      cache.findAll(topicQueries(topic)).map((q) => q.queryKey[0]);

    expect(keysFor("scans")).toEqual(["scan"]);
    expect(keysFor("project-config")).toEqual(["project-config"]);
    expect(keysFor("transcripts")).toEqual([]);
  });

  it("isInvalidationTopic accepts only topics this client tags", () => {
    expect(isInvalidationTopic("scans")).toBe(true);
    expect(isInvalidationTopic("project-config")).toBe(true);
    expect(isInvalidationTopic("future-topic")).toBe(false);
    expect(topicTag("scans")).toBe("scans-inv");
  });
});

describe("transcriptsByIdsQuery", () => {
  it("keys the same id set identically regardless of order", () => {
    const a = transcriptsByIdsQuery(api, "/t", ["b", "a"]).queryKey;
    const b = transcriptsByIdsQuery(api, "/t", ["a", "b"]).queryKey;
    expect(a).toEqual(b);
    expect(a).toContain(topicTag("transcripts"));
  });

  it("is disabled without a directory or ids", () => {
    expect(transcriptsByIdsQuery(api, undefined, ["a"]).queryFn).toBe(
      skipToken
    );
    expect(transcriptsByIdsQuery(api, "/t", []).queryFn).toBe(skipToken);
  });
});

describe("scanDataframeDetailQuery", () => {
  it("is not keyed on the scans topic: a written row never changes", () => {
    const { queryKey } = scanDataframeDetailQuery(api, {
      scansDir: "/scans",
      scanPath: "a.scan",
      scanner: "s",
      uuid: "u",
    });
    expect(queryKey).not.toContain(topicTag("scans"));
  });

  it("keeps a resolved input fresh but refetches one that failed to resolve", async () => {
    const params = {
      scansDir: "/scans",
      scanPath: "a.scan",
      scanner: "s",
      uuid: "u",
    };
    const fetchTwice = async (response: Record<string, unknown>) => {
      let requests = 0;
      server.use(
        http.get(
          `/api/v2/scans/${encodeBase64Url(params.scansDir)}/${encodeBase64Url(params.scanPath)}/s/u`,
          () => {
            requests++;
            return HttpResponse.json(response);
          }
        )
      );
      // Built after MSW patched fetch, unlike the module-level api.
      const query = scanDataframeDetailQuery(apiScoutServer(), params);
      const queryClient = new QueryClient();
      await queryClient.fetchQuery(query);
      await queryClient.fetchQuery(query);
      return requests;
    };
    const row = {
      input_type: "transcript",
      input_data: null,
      input_storage: "reference",
      scan_events: [],
    };

    expect(
      await fetchTwice({
        ...row,
        input: {
          transcript_id: "t-1",
          messages: [],
          events: [],
          timelines: [],
          metadata: {},
        },
      })
    ).toBe(1);
    expect(
      await fetchTwice({
        ...row,
        input: null,
        input_error: {
          reason: "unavailable",
          message: "Timed out reading the sample.",
        },
      })
    ).toBe(2);
  });
});
