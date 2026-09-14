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
import { type PropsWithChildren } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ComponentIconProvider } from "@tsmono/react/components";
import { testIcons } from "@tsmono/react/testing";
import { encodeBase64Url } from "@tsmono/util";

import { apiScoutServer } from "../../../api/api-scout-server";
import { ApiProvider, createStore, StoreProvider } from "../../../state/store";
import { server } from "../../../test/setup-msw";
import {
  button,
  byId,
  inputByPlaceholder,
  selectOption,
} from "../../../test/webComponents";
import type { ValidationCase } from "../../../types/api-types";

import { CopyMoveCasesModal } from "./CopyMoveCasesModal";

const sourceUri = "file:///proj/source.csv";
const targetUri = "file:///proj/target.csv";
const casesEndpoint = (uri: string) =>
  `/api/v2/validations/${encodeBase64Url(uri)}`;
const caseEndpoint = (uri: string, id: string) =>
  `${casesEndpoint(uri)}/${encodeBase64Url(id)}`;

const validationCase = (id: string): ValidationCase => ({
  id,
  target: `answer-${id}`,
  labels: null,
  predicate: null,
  split: "dev",
});

const renderModal = (mode: "copy" | "move", cases: ValidationCase[]) => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  const api = apiScoutServer();
  const store = createStore(api);
  const onHide = vi.fn();
  const onSuccess = vi.fn();

  const Wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={queryClient}>
      <ApiProvider value={api}>
        <StoreProvider value={store}>
          <ComponentIconProvider icons={testIcons}>
            {children}
          </ComponentIconProvider>
        </StoreProvider>
      </ApiProvider>
    </QueryClientProvider>
  );

  render(
    <CopyMoveCasesModal
      show
      mode={mode}
      sourceUri={sourceUri}
      selectedIds={cases.map((c) => String(c.id))}
      selectedCases={cases}
      onHide={onHide}
      onSuccess={onSuccess}
    />,
    { wrapper: Wrapper }
  );

  return { onHide, onSuccess };
};

const chooseTarget = (optionLabel: string) =>
  selectOption(byId("copy-move-target-set"), optionLabel);

const submit = (label: "Copy" | "Move") => {
  fireEvent.click(button(label));
};

describe("CopyMoveCasesModal", () => {
  afterEach(() => {
    cleanup();
  });

  it("creates the new set, copies into it, and refreshes the set list", async () => {
    const newUri = "file:///proj/fresh.csv";
    let setsRequests = 0;
    let createBody: unknown;
    const upsertBodies = new Map<string, unknown>();

    server.use(
      http.get("/api/v2/validations", () => {
        setsRequests += 1;
        return HttpResponse.json<string[]>(
          setsRequests === 1
            ? [sourceUri, targetUri]
            : [sourceUri, targetUri, newUri]
        );
      }),
      http.post("/api/v2/validations", async ({ request }) => {
        createBody = await request.json();
        return HttpResponse.json<string>(newUri);
      }),
      http.post(caseEndpoint(newUri, "c1"), async ({ request }) => {
        upsertBodies.set("c1", await request.json());
        return HttpResponse.json<ValidationCase>(validationCase("c1"));
      })
    );

    const { onHide, onSuccess } = renderModal("copy", [validationCase("c1")]);

    await chooseTarget("Create new set...");
    fireEvent.input(inputByPlaceholder("Enter name (without extension)"), {
      target: { value: "fresh" },
    });
    submit("Copy");

    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
    expect(onHide).toHaveBeenCalledTimes(1);

    expect(createBody).toEqual({ path: newUri, cases: [] });
    expect(upsertBodies.get("c1")).toEqual({
      id: "c1",
      target: "answer-c1",
      labels: null,
      split: "dev",
    });
    // The set list is refetched so the destination shows up elsewhere.
    expect(setsRequests).toBeGreaterThanOrEqual(2);
  });

  it("warns on a partial copy failure but still deletes the moved cases", async () => {
    const deleted: string[] = [];
    let releaseDeletes: () => void = () => {};
    const deletesGate = new Promise<void>((resolve) => {
      releaseDeletes = resolve;
    });

    server.use(
      http.get("/api/v2/validations", () =>
        HttpResponse.json<string[]>([sourceUri, targetUri])
      ),
      http.get(casesEndpoint(targetUri), () =>
        HttpResponse.json<ValidationCase[]>([])
      ),
      http.post(caseEndpoint(targetUri, "c1"), () =>
        HttpResponse.json<ValidationCase>(validationCase("c1"))
      ),
      http.post(caseEndpoint(targetUri, "c2"), () =>
        HttpResponse.text("Server Error", { status: 500 })
      ),
      http.delete(`${casesEndpoint(sourceUri)}/:id`, async ({ params }) => {
        // Hold the deletes so the warning is observable while the move
        // is still in flight.
        await deletesGate;
        deleted.push(String(params.id));
        return new HttpResponse(null, { status: 204 });
      })
    );

    const { onHide, onSuccess } = renderModal("move", [
      validationCase("c1"),
      validationCase("c2"),
    ]);

    await chooseTarget("target.csv");
    submit("Move");

    await screen.findByText(
      "Warning: 1 of 2 cases failed to copy. 1 succeeded."
    );
    expect(deleted).toEqual([]);
    releaseDeletes();

    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
    expect(onHide).toHaveBeenCalledTimes(1);
    expect(deleted.sort()).toEqual(["c1", "c2"].map(encodeBase64Url).sort());
  });

  it("aborts the move when every copy fails", async () => {
    let deleteRequests = 0;

    server.use(
      http.get("/api/v2/validations", () =>
        HttpResponse.json<string[]>([sourceUri, targetUri])
      ),
      http.get(casesEndpoint(targetUri), () =>
        HttpResponse.json<ValidationCase[]>([])
      ),
      http.post(`${casesEndpoint(targetUri)}/:id`, () =>
        HttpResponse.text("Server Error", { status: 500 })
      ),
      http.delete(`${casesEndpoint(sourceUri)}/:id`, () => {
        deleteRequests += 1;
        return new HttpResponse(null, { status: 204 });
      })
    );

    const { onHide, onSuccess } = renderModal("move", [
      validationCase("c1"),
      validationCase("c2"),
    ]);

    await chooseTarget("target.csv");
    submit("Move");

    await screen.findByText(/All 2 copy operations failed/);
    // Give any (wrong) follow-up deletion a chance to fire before asserting.
    await new Promise((r) => setTimeout(r, 50));

    expect(deleteRequests).toBe(0);
    expect(onSuccess).not.toHaveBeenCalled();
    expect(onHide).not.toHaveBeenCalled();
  });
});
