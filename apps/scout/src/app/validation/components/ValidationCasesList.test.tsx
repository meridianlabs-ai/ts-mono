// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { type PropsWithChildren } from "react";
import { MemoryRouter } from "react-router";
import { screen } from "shadow-dom-testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";

import { decodeBase64Url, encodeBase64Url } from "@tsmono/util";

import { apiScoutServer } from "../../../api/api-scout-server";
import { ApiProvider, createStore, StoreProvider } from "../../../state/store";
import { server } from "../../../test/setup-msw";
import { button, byId, selectOption } from "../../../test/webComponents";
import type { ValidationCase } from "../../../types/api-types";

import { ValidationCasesList } from "./ValidationCasesList";

const sourceUri = "file:///proj/source.csv";
const targetUri = "file:///proj/target.csv";
const casesEndpoint = (uri: string) =>
  `/api/v2/validations/${encodeBase64Url(uri)}`;

const validationCase = (id: string): ValidationCase => ({
  id,
  target: `answer-${id}`,
  labels: null,
  predicate: null,
  split: "dev",
});

const renderList = (cases: ValidationCase[], selected: string[]) => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  const api = apiScoutServer();
  const store = createStore(api);
  store
    .getState()
    .setValidationCaseSelection(
      Object.fromEntries(selected.map((id) => [id, true]))
    );

  const Wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={queryClient}>
      <ApiProvider value={api}>
        <StoreProvider value={store}>
          <MemoryRouter>{children}</MemoryRouter>
        </StoreProvider>
      </ApiProvider>
    </QueryClientProvider>
  );

  render(
    <ValidationCasesList
      cases={cases}
      transcriptsDir={undefined}
      sourceUri={sourceUri}
      onBulkSplitChange={vi.fn()}
      onBulkDelete={vi.fn()}
    />,
    { wrapper: Wrapper }
  );
};

describe("ValidationCasesList", () => {
  afterEach(() => {
    cleanup();
  });

  // Case ids are transcript ids from scan data. One named after an
  // Object.prototype member must not read as selected.
  it("copies only the cases the user selected", async () => {
    const upserted: string[] = [];
    server.use(
      http.get("/api/v2/validations", () =>
        HttpResponse.json<string[]>([sourceUri, targetUri])
      ),
      http.get(casesEndpoint(targetUri), () =>
        HttpResponse.json<ValidationCase[]>([])
      ),
      http.post(`${casesEndpoint(targetUri)}/:id`, ({ params }) => {
        const id = decodeBase64Url(String(params.id));
        upserted.push(id);
        return HttpResponse.json<ValidationCase>(validationCase(id));
      })
    );

    renderList(
      [validationCase("constructor"), validationCase("picked")],
      ["picked"]
    );

    fireEvent.click(button("Copy"));
    await selectOption(byId("copy-move-target-set"), "target.csv");
    const [, submit] = screen
      .getAllByText("Copy")
      .filter((el) => el.closest("vscode-button") !== null);
    fireEvent.click(submit!);

    await waitFor(() => expect(upserted).toEqual(["picked"]));
  });
});
