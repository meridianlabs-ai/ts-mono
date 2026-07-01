import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { EvalSet } from "@tsmono/inspect-common/types";

import { ClientAPI } from "../../client/api/types";
import { AppConfig, initAppConfig } from "../appConfig";

import { APP_CONFIG_KEY } from "./useAppConfig";
import { useEvalSet } from "./useEvalSet";

const freshClient = () =>
  new QueryClient({ defaultOptions: { queries: { retry: false } } });

const wrapperFor = (client: QueryClient) => {
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return Wrapper;
};

const seedConfig = (
  client: QueryClient,
  get_eval_set: ClientAPI["get_eval_set"]
) => {
  const config = {
    api: { get_eval_set } as unknown as ClientAPI,
    singleFileMode: false,
    loader: "replicator",
    inspect_version: "1.0.0",
    scout_version: null,
    logDir: "/logs",
    absLogDir: "/abs/logs",
  } satisfies AppConfig;
  // useLogDir reads the resolved config from the react-query cache; the queryFn
  // reaches getAppConfig(), so seed both the cache and the singleton.
  client.setQueryData(APP_CONFIG_KEY, config);
  initAppConfig(config);
};

const evalSet = (id: string): EvalSet =>
  ({ eval_set_id: id }) as unknown as EvalSet;

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useEvalSet", () => {
  it("resolves the eval-set for the current log dir", async () => {
    const client = freshClient();
    const get_eval_set = vi.fn().mockResolvedValue(evalSet("set-1"));
    seedConfig(client, get_eval_set);

    const { result } = renderHook(() => useEvalSet(), {
      wrapper: wrapperFor(client),
    });
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(get_eval_set).toHaveBeenCalledWith("/logs");
    expect(result.current.data).toEqual(evalSet("set-1"));
  });

  it("resolves null when there is no eval-set (react-query rejects undefined)", async () => {
    const client = freshClient();
    const get_eval_set = vi.fn().mockResolvedValue(undefined);
    seedConfig(client, get_eval_set);

    const { result } = renderHook(() => useEvalSet(), {
      wrapper: wrapperFor(client),
    });
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.data).toBeNull();
    expect(result.current.error).toBeUndefined();
  });

  it("surfaces fetch errors", async () => {
    const client = freshClient();
    const get_eval_set = vi.fn().mockRejectedValue(new Error("boom"));
    seedConfig(client, get_eval_set);

    const { result } = renderHook(() => useEvalSet(), {
      wrapper: wrapperFor(client),
    });
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBeDefined();
    expect(result.current.data).toBeUndefined();
  });
});
