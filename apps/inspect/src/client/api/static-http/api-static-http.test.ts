import { afterEach, describe, expect, test, vi } from "vitest";

import { LogLocationController, type GrantedLogUrl } from "../log-location";

import staticHttpApi from "./api-static-http";
import { fetchTextFile } from "./fetch";

const baseUrl = "https://viewer.example/index.html";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("staticHttpApi location enforcement", () => {
  test("rejects a forged granted URL at the request helper", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");

    await expect(
      fetchTextFile(
        "https://viewer.example/logs/run.eval" as unknown as GrantedLogUrl
      )
    ).rejects.toThrow("requires a granted URL");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("rejects an ungranted file before fetch", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const locations = new LogLocationController({
      transport: "static",
      baseUrl,
      staticLogDir: "logs",
    });
    const api = staticHttpApi(
      "logs",
      undefined,
      undefined,
      undefined,
      locations
    );

    await expect(
      api.get_log_contents("http://127.0.0.1/run.json")
    ).rejects.toThrow("not approved");
    await expect(
      api.get_log_info("https://other.example/run.eval")
    ).rejects.toThrow("not approved");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("loads a granted JSON log with restricted request metadata", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          version: 2,
          status: "success",
          eval: { task: "task", model: "model" },
        }),
        { status: 200 }
      )
    );
    const locations = new LogLocationController({
      transport: "static",
      baseUrl,
      staticLogDir: "logs",
    });
    const api = staticHttpApi(
      "logs",
      undefined,
      undefined,
      undefined,
      locations
    );

    await api.get_log_contents("run.json");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://viewer.example/logs/run.json",
      expect.objectContaining({
        method: "GET",
        credentials: "same-origin",
        referrerPolicy: "no-referrer",
        redirect: "error",
      })
    );
  });

  test("guards HEAD and range requests for eval logs", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(null, {
          status: 200,
          headers: { "Content-Length": "42" },
        })
      )
      .mockResolvedValueOnce(
        new Response(new Uint8Array([1, 2, 3]), { status: 206 })
      );
    const locations = new LogLocationController({
      transport: "static",
      baseUrl,
      staticLogFile: "https://cdn.example/run.eval",
    });
    const api = staticHttpApi(
      undefined,
      "https://cdn.example/run.eval",
      undefined,
      undefined,
      locations
    );

    await expect(
      api.get_log_info("https://cdn.example/run.eval")
    ).resolves.toEqual({ size: 42 });
    await api.get_log_bytes("https://cdn.example/run.eval", 2, 4);

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "https://cdn.example/run.eval",
      expect.objectContaining({
        method: "HEAD",
        credentials: "same-origin",
        referrerPolicy: "no-referrer",
        redirect: "error",
      })
    );
    const rangeInit = fetchMock.mock.calls[1]?.[1];
    expect(new Headers(rangeInit?.headers).get("Range")).toBe("bytes=2-4");
  });

  test("rechecks a grant before the range size probe", async () => {
    let resolveHead: ((response: Response) => void) | undefined;
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          resolveHead = resolve;
        })
    );
    const locations = new LogLocationController({
      transport: "view-server",
      baseUrl,
    });
    const file = "https://cdn.example/run.eval";
    locations.requestFileSelection(file, { source: "query" });
    locations.approveRequest();
    const api = staticHttpApi(
      undefined,
      undefined,
      undefined,
      undefined,
      locations
    );

    const info = api.get_log_info(file);
    locations.requestFileSelection("https://other.example/run.eval", {
      source: "route",
    });
    resolveHead?.(
      new Response(null, {
        status: 200,
        headers: { "Accept-Ranges": "bytes" },
      })
    );

    await expect(info).rejects.toThrow("requires a granted URL");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("filters manifest entries through the configured root", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          "team/run.eval": { task: "valid", task_id: "one" },
          "../api/delete.eval": { task: "escape", task_id: "two" },
          "https://other.example/run.eval": {
            task: "external",
            task_id: "three",
          },
        }),
        { status: 200 }
      )
    );
    const locations = new LogLocationController({
      transport: "static",
      baseUrl,
      staticLogDir: "logs",
    });
    const api = staticHttpApi(
      "logs",
      undefined,
      undefined,
      undefined,
      locations
    );

    await expect(api.get_log_root()).resolves.toEqual({
      logs: [
        {
          name: "https://viewer.example/logs/team/run.eval",
          task: "valid",
          task_id: "one",
        },
      ],
      log_dir: "https://viewer.example/logs/",
      abs_log_dir: undefined,
    });
  });

  test("ignores duplicate canonical manifest entries", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          "team/run.eval": { task: "valid", task_id: "one" },
          "team/./run.eval": { task: "duplicate", task_id: "two" },
        }),
        { status: 200 }
      )
    );
    const locations = new LogLocationController({
      transport: "static",
      baseUrl,
      staticLogDir: "logs",
    });
    const api = staticHttpApi(
      "logs",
      undefined,
      undefined,
      undefined,
      locations
    );

    await expect(api.get_log_root()).resolves.toMatchObject({
      logs: [
        {
          name: "https://viewer.example/logs/team/run.eval",
          task: "valid",
          task_id: "one",
        },
      ],
    });
  });
});
