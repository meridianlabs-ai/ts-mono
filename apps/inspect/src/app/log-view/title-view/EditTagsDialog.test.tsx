// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ComponentIconProvider } from "@tsmono/react/components";
import { testIcons } from "@tsmono/react/testing";

import { APP_CONFIG_KEY, AppConfig, initAppConfig } from "../../../app_config";
import { testClientAPI } from "../../../client/api/testClientApi";
import { ClientAPI } from "../../../client/api/types";

import { EditTagsDialog } from "./EditTagsDialog";

const configWith = (overrides: Partial<ClientAPI>): AppConfig => ({
  api: testClientAPI(overrides),
  singleFileMode: false,
  loader: "replicator",
  inspect_version: "1.0.0",
  scout_version: null,
  logDir: "/logs",
  absLogDir: "/abs/logs",
});

const renderDialog = (overrides: Partial<ClientAPI>) => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const config = configWith(overrides);
  initAppConfig(config);
  client.setQueryData(APP_CONFIG_KEY, config);
  const dialog = (showing: boolean) => (
    <QueryClientProvider client={client}>
      <ComponentIconProvider icons={testIcons}>
        <EditTagsDialog
          showing={showing}
          setShowing={() => {}}
          currentTags={["a"]}
          logFile="/logs/x.eval"
        />
      </ComponentIconProvider>
    </QueryClientProvider>
  );
  const view = render(dialog(true));
  return {
    reopen: () => {
      view.rerender(dialog(false));
      view.rerender(dialog(true));
    },
  };
};

const authorField = () => screen.getByLabelText<HTMLInputElement>(/Author/);

afterEach(() => {
  cleanup();
});

describe("EditTagsDialog author prefill", () => {
  it("fills Author with the server identity", async () => {
    renderDialog({ get_user_info: () => Promise.resolve({ name: "Ada" }) });

    await waitFor(() => expect(authorField().value).toBe("Ada"));
  });

  it("keeps a typed author, and reopening restores the server identity without refetching", async () => {
    const get_user_info = vi.fn(() => Promise.resolve({ name: "Ada" }));
    const { reopen } = renderDialog({ get_user_info });
    await waitFor(() => expect(authorField().value).toBe("Ada"));

    fireEvent.change(authorField(), { target: { value: "Grace" } });
    expect(authorField().value).toBe("Grace");

    reopen();
    expect(authorField().value).toBe("Ada");
    expect(get_user_info).toHaveBeenCalledOnce();
  });

  it("keeps an author typed before the identity arrives", async () => {
    let resolve: (info: { name: string }) => void = () => {};
    renderDialog({
      get_user_info: () =>
        new Promise((r) => {
          resolve = r;
        }),
    });
    fireEvent.change(authorField(), { target: { value: "Grace" } });

    resolve({ name: "Ada" });
    await waitFor(() => expect(screen.getByDisplayValue("Grace")).toBeTruthy());
    expect(authorField().value).toBe("Grace");
  });

  it.each([
    ["the host has no user-info endpoint", {}],
    [
      "the request fails",
      { get_user_info: () => Promise.reject(new Error("404")) },
    ],
    ["the name is empty", { get_user_info: () => Promise.resolve({}) }],
  ])("leaves Author blank when %s", async (_, overrides) => {
    renderDialog(overrides);

    // Let any pending request settle before asserting the field stayed blank.
    await new Promise((r) => setTimeout(r, 0));
    expect(authorField().value).toBe("");
  });
});
