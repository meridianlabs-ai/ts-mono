// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { type FC, type PropsWithChildren } from "react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it } from "vitest";

import { ComponentIconProvider } from "@tsmono/react/components";
import { testIcons } from "@tsmono/react/testing";
import { decodeBase64Url, encodeBase64Url, isRecord } from "@tsmono/util";

import { apiScoutServer } from "../../../api/api-scout-server";
import { ApiProvider, createStore, StoreProvider } from "../../../state/store";
import { server } from "../../../test/setup-msw";
import {
  button,
  inputByPlaceholder,
  queryInputByPlaceholder,
  radio,
} from "../../../test/webComponents";
import type { AppConfig, ValidationCase } from "../../../types/api-types";
import { useAppConfigAsync } from "../../server/useAppConfig";

import { ValidationCaseEditor } from "./ValidationCaseEditor";

const setUri = "file:///proj/cases.csv";
const casesEndpoint = `/api/v2/validations/${encodeBase64Url(setUri)}`;

const appConfig: AppConfig = {
  filter: [],
  home_dir: "/home/user",
  project_dir: "file:///proj",
  scans: { dir: "file:///proj/scans", source: "project" },
};

// A stateful stand-in for the server's case store: GET reflects what has
// been saved, so the editor's cache reconciliation runs against real data.
const installCaseServer = (initial: Map<string, ValidationCase>) => {
  const cases = new Map(initial);
  const requests = { get: 0, post: 0, delete: 0 };
  const postBodies: unknown[] = [];

  server.use(
    http.get("/api/v2/app-config", () =>
      HttpResponse.json<AppConfig>(appConfig)
    ),
    http.get("/api/v2/validations", () =>
      HttpResponse.json<string[]>([setUri])
    ),
    http.get(casesEndpoint, () =>
      HttpResponse.json<ValidationCase[]>([...cases.values()])
    ),
    http.get(`${casesEndpoint}/:id`, ({ params }) => {
      requests.get += 1;
      const found = cases.get(decodeBase64Url(String(params.id)));
      return HttpResponse.json<ValidationCase | { detail: string }>(
        found ?? { detail: "Not Found" },
        { status: found ? 200 : 404 }
      );
    }),
    http.post(`${casesEndpoint}/:id`, async ({ params, request }) => {
      requests.post += 1;
      const id = decodeBase64Url(String(params.id));
      const body: unknown = await request.json();
      postBodies.push(body);
      // Only the fields these tests write back are modelled.
      const saved: ValidationCase = {
        ...validationCase(id),
        target:
          isRecord(body) && typeof body.target === "string"
            ? body.target
            : null,
        predicate: isRecord(body) && body.predicate === "eq" ? "eq" : null,
      };
      cases.set(id, saved);
      return HttpResponse.json<ValidationCase>(saved);
    }),
    http.delete(`${casesEndpoint}/:id`, ({ params }) => {
      requests.delete += 1;
      cases.delete(decodeBase64Url(String(params.id)));
      return new HttpResponse(null, { status: 204 });
    })
  );

  return { requests, postBodies };
};

const validationCase = (id: string): ValidationCase => ({
  id,
  target: null,
  labels: null,
  predicate: null,
  split: null,
});

// The app loads config before rendering anything that reads it
// synchronously; mirror that (and keep the query observed so the test
// client's gcTime of 0 doesn't drop it).
const WhenConfigLoaded: FC<PropsWithChildren> = ({ children }) => {
  const { data } = useAppConfigAsync();
  return data ? children : null;
};

const renderEditor = async (transcriptId: string) => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  const api = apiScoutServer();
  const store = createStore(api);

  const Wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={queryClient}>
      <ApiProvider value={api}>
        <StoreProvider value={store}>
          <ComponentIconProvider icons={testIcons}>
            <MemoryRouter>
              <WhenConfigLoaded>{children}</WhenConfigLoaded>
            </MemoryRouter>
          </ComponentIconProvider>
        </StoreProvider>
      </ApiProvider>
    </QueryClientProvider>
  );

  const editor = (id: string) => <ValidationCaseEditor transcriptId={id} />;
  const utils = render(editor(transcriptId), { wrapper: Wrapper });
  await screen.findByText("Target");
  await waitFor(() => expect(queryClient.isFetching()).toBe(0));
  return {
    rerenderFor: (id: string) => utils.rerender(editor(id)),
    queryClient,
  };
};

const targetInput = () => inputByPlaceholder("Enter target value");

describe("ValidationCaseEditor", () => {
  afterEach(() => {
    cleanup();
  });

  // First test in the file: it pays the cold-start render of the Lit web
  // components on top of the 600ms typing debounce, which lands at 3-5s on a
  // loaded CI runner and trips the 5s default.
  it("does not save a new case until it has a target, then saves what was typed", async () => {
    const { requests, postBodies } = installCaseServer(new Map());
    await renderEditor("t1");

    fireEvent.click(radio("Other"));

    // The draft drives the UI (predicate editor appears) without a save.
    await screen.findByText("Predicate");
    await new Promise((r) => setTimeout(r, 50));
    expect(requests.post).toBe(0);

    fireEvent.input(targetInput(), { target: { value: "foo" } });

    // Typing is debounced before the save fires.
    await waitFor(() => expect(requests.post).toBe(1), { timeout: 2000 });
    expect(postBodies[0]).toEqual({
      id: "t1",
      target: "foo",
      labels: null,
      predicate: "eq",
      split: null,
    });

    // Server truth replaces the draft without disturbing what was typed.
    await screen.findByText("Saved");
    expect(targetInput().value).toBe("foo");
    expect(radio("Other").checked).toBe(true);
  }, 15_000);

  it("keeps the unsaved draft out of the cache and off other transcripts", async () => {
    const { requests } = installCaseServer(new Map());
    const { rerenderFor, queryClient } = await renderEditor("t1");

    fireEvent.click(radio("Other"));
    await screen.findByText("Predicate");

    // Only what the server has (nothing) is cached for this case.
    const cached = queryClient
      .getQueryCache()
      .findAll({ queryKey: ["validationCase"] })
      .map((q) => q.state.data);
    expect(cached).toEqual([null]);

    rerenderFor("t2");
    await waitFor(() => expect(requests.get).toBe(2));
    await screen.findByText("Target");
    expect(radio("Other").checked).toBe(false);
    expect(screen.queryByText("Predicate")).toBeNull();
  });

  it("stays open on an empty case after deleting, without refetching the case", async () => {
    const existing: ValidationCase = {
      ...validationCase("t1"),
      target: "yes",
    };
    const { requests } = installCaseServer(new Map([["t1", existing]]));
    await renderEditor("t1");

    await waitFor(() => expect(radio("Other").checked).toBe(true));
    expect(targetInput().value).toBe("yes");
    expect(requests.get).toBe(1);

    fireEvent.click(screen.getByTitle("More actions"));
    fireEvent.click(
      screen.getByRole("button", { name: "Delete validation case" })
    );
    fireEvent.click(button("Delete"));

    await waitFor(() => expect(requests.delete).toBe(1));

    // The editor is still open, now on the empty case.
    await waitFor(() => expect(screen.queryByTitle("More actions")).toBeNull());
    expect(screen.getByText("Validation Case")).toBeDefined();
    expect(screen.getByText("Target")).toBeDefined();
    expect(radio("Other").checked).toBe(false);
    expect(queryInputByPlaceholder("Enter target value")).toBeNull();

    // The server layer wrote the null directly; no 404 round-trip.
    expect(requests.get).toBe(1);
  });
});
