import { afterEach, describe, expect, it, vi } from "vitest";

import { apiScoutServer } from "./api-scout-server";

describe("connectTopicUpdates (polling)", () => {
  let disconnect: (() => void) | undefined;

  afterEach(() => {
    disconnect?.();
    disconnect = undefined;
    vi.restoreAllMocks();
  });

  const connect = (body: string, status = 200) => {
    const onUpdate = vi.fn();
    let fetchCalls = 0;
    const customFetch: typeof fetch = () => {
      fetchCalls++;
      return Promise.resolve(new Response(body, { status }));
    };
    const api = apiScoutServer({ customFetch, disableSSE: true });
    disconnect = api.connectTopicUpdates(onUpdate);
    return { onUpdate, polled: () => fetchCalls > 0 };
  };

  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

  it("extracts recognized topic versions from a frame", async () => {
    const { onUpdate } = connect(
      JSON.stringify({ scans: "t1", "future-topic": "x", transcripts: 3 })
    );
    await vi.waitFor(() => expect(onUpdate).toHaveBeenCalled());
    expect(onUpdate).toHaveBeenCalledWith({ scans: "t1" });
  });

  it("counts any parseable JSON body as an update (marks connection live)", async () => {
    const { onUpdate } = connect("null");
    await vi.waitFor(() => expect(onUpdate).toHaveBeenCalled());
    expect(onUpdate).toHaveBeenCalledWith({});
  });

  it("ignores an error response even when its body is parseable JSON", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const { onUpdate, polled } = connect(
      JSON.stringify({ detail: "Not Found" }),
      404
    );
    await vi.waitFor(() => expect(polled()).toBe(true));
    await flush();
    expect(onUpdate).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalled();
  });

  it("ignores an unparseable body", async () => {
    const { onUpdate, polled } = connect("not json");
    await vi.waitFor(() => expect(polled()).toBe(true));
    await flush();
    expect(onUpdate).not.toHaveBeenCalled();
  });
});
