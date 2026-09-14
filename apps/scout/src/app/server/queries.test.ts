// @vitest-environment jsdom
import { QueryClient, skipToken } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";

import { apiScoutServer } from "../../api/api-scout-server";

import {
  isInvalidationTopic,
  projectConfigQuery,
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
