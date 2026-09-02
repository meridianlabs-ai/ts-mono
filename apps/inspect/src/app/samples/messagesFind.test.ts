import { describe, expect, it, vi } from "vitest";

import type {
  FindMessagesRequest,
  FindMessagesResponse,
} from "@tsmono/inspect-common/types";

import { FindPageCache } from "./findPageCache";
import { messagesFindSource } from "./messagesFind";

const sample = { logFile: "dir/log.eval", id: "s1", epoch: 2 };
const projection = {
  unlabeledRoles: ["user"],
  toolCallStyle: "compact" as const,
  displayMode: "raw" as const,
};
const query = { text: "istanbul", projection };
const after = { id: "m1" };

const sealed: FindMessagesResponse = {
  rows: [
    { anchor: "m1#3", index: 3, count: 2, texts: ["İstanbul", "istanbul"] },
  ],
  at_end: false,
  complete: true,
};

const mappedSealed = {
  rows: [
    {
      anchor: { id: "m1#3" },
      index: 3,
      count: 2,
      texts: ["İstanbul", "istanbul"],
    },
  ],
  atEnd: false,
  complete: true,
};

function sourceWith(
  response: FindMessagesResponse,
  cache = new FindPageCache()
) {
  const find_messages = vi.fn((_log: string, _request: FindMessagesRequest) =>
    Promise.resolve(response)
  );
  const source = messagesFindSource({ find_messages }, sample, cache)!;
  return { source, find_messages, cache };
}

describe("messagesFindSource", () => {
  it("is undefined when the backend has no find_messages", () => {
    expect(messagesFindSource({}, sample)).toBeUndefined();
  });

  it("scopes find to the sample, so another sample starts afresh", () => {
    expect(sourceWith(sealed).source.scopeId).toBe(
      "messages:dir/log.eval#s1#2"
    );
  });

  it("maps a page after an anchor to the wire request and the response to rows", async () => {
    const live: FindMessagesResponse = { ...sealed, complete: false };
    const { source, find_messages } = sourceWith(live);
    const signal = new AbortController().signal;

    const page = await source.find(query, after, signal);

    expect(find_messages).toHaveBeenCalledWith(
      "dir/log.eval",
      {
        sample_id: "s1",
        epoch: 2,
        text: "istanbul",
        after: "m1",
        projection: {
          unlabeled_roles: ["user"],
          tool_call_style: "compact",
          display_mode: "raw",
        },
      },
      signal
    );
    expect(page).toEqual({ ...mappedSealed, complete: false });
  });

  it("sends no cursor for the first page", async () => {
    const { source, find_messages } = sourceWith(sealed);
    await source.find(query, undefined, new AbortController().signal);
    expect(find_messages.mock.calls[0]![1]).toMatchObject({ after: undefined });
  });

  it("reuses a sealed page for the same POST body (backspace to a paused term)", async () => {
    const { source, find_messages } = sourceWith(sealed);
    const signal = new AbortController().signal;
    const first = await source.find(query, after, signal);
    const second = await source.find(query, after, signal);
    expect(find_messages).toHaveBeenCalledTimes(1);
    expect(second).toEqual(first);
    first.rows[0]!.texts.push("mutated");
    expect(second.rows[0]!.texts).toEqual(["İstanbul", "istanbul"]);
  });

  it("does not cache a live sample page", async () => {
    const { source, find_messages } = sourceWith({
      ...sealed,
      complete: false,
    });
    const signal = new AbortController().signal;
    await source.find(query, after, signal);
    await source.find(query, after, signal);
    expect(find_messages).toHaveBeenCalledTimes(2);
  });

  it("misses when the term differs (does not derive a prefix from a longer query)", async () => {
    const { source, find_messages } = sourceWith(sealed);
    const signal = new AbortController().signal;
    await source.find(query, after, signal);
    await source.find({ ...query, text: "istanbu" }, after, signal);
    expect(find_messages).toHaveBeenCalledTimes(2);
  });

  it("misses when the cursor or the projection differs", async () => {
    const { source, find_messages } = sourceWith(sealed);
    const signal = new AbortController().signal;
    await source.find(query, after, signal);
    await source.find(query, { id: "m2" }, signal);
    await source.find(
      { ...query, projection: { ...projection, displayMode: "rendered" } },
      after,
      signal
    );
    expect(find_messages).toHaveBeenCalledTimes(3);
  });

  it("evicts the oldest sealed page when over capacity", async () => {
    const cache = new FindPageCache(1);
    const { source, find_messages } = sourceWith(sealed, cache);
    const signal = new AbortController().signal;
    await source.find(query, after, signal);
    await source.find({ ...query, text: "other" }, after, signal);
    expect(cache.size).toBe(1);
    await source.find(query, after, signal);
    expect(find_messages).toHaveBeenCalledTimes(3);
  });

  it("drops sealed pages for a sample once a live page arrives", async () => {
    const cache = new FindPageCache();
    const { source, find_messages } = sourceWith(sealed, cache);
    const signal = new AbortController().signal;
    await source.find(query, after, signal);
    expect(cache.size).toBe(1);
    find_messages.mockResolvedValueOnce({ ...sealed, complete: false });
    await source.find({ ...query, text: "other" }, after, signal);
    expect(cache.size).toBe(0);
    await source.find(query, after, signal);
    expect(find_messages).toHaveBeenCalledTimes(3);
  });
});
