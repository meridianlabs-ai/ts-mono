// @vitest-environment jsdom
import { QueryClient } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { testEvalLog } from "@tsmono/inspect-common/testing";
import { ApiError } from "@tsmono/util";

import { ClientAPI, EditLogResult } from "../../../client/api/types";

import { EditTagsDialog } from "./EditTagsDialog";
import { renderEditDialog } from "./renderEditDialog";

const renderDialog = (api: Partial<ClientAPI>) => {
  const setShowing = vi.fn();
  const onSaved = vi.fn();
  const view = renderEditDialog(api, (showing) => (
    <EditTagsDialog
      showing={showing}
      setShowing={setShowing}
      currentTags={["a"]}
      logFile="/logs/x.eval"
      onSaved={onSaved}
    />
  ));
  return { ...view, setShowing, onSaved };
};

const authorField = () => screen.getByLabelText<HTMLInputElement>(/Author/);

// React Query hands results to components on a later timer, so wait for the
// request to finish and then flush that timer before asserting on the field.
const settled = async (client: QueryClient) => {
  await waitFor(() =>
    expect(client.getQueryState(["user-info"])?.fetchStatus ?? "idle").toBe(
      "idle"
    )
  );
  await act(() => new Promise((r) => setTimeout(r, 0)));
};

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
    const { client } = renderDialog({
      get_user_info: () =>
        new Promise((r) => {
          resolve = r;
        }),
    });
    fireEvent.change(authorField(), { target: { value: "Grace" } });

    resolve({ name: "Ada" });
    await settled(client);
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
    const { client } = renderDialog(overrides);

    await settled(client);
    expect(authorField().value).toBe("");
  });
});

describe("EditTagsDialog save", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-01-02T03:04:05Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const saveButton = () => screen.getByRole("button", { name: "Save" });

  const editTags = () => {
    const input = screen.getByPlaceholderText("Add a tag and press Enter");
    fireEvent.change(input, { target: { value: "b" } });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.click(screen.getByRole("button", { name: "Remove a" }));
    fireEvent.change(authorField(), { target: { value: "Ada" } });
  };

  const pendingSave = () => {
    let resolve: (result: EditLogResult) => void = () => {};
    const result = new Promise<EditLogResult>((r) => {
      resolve = r;
    });
    const edit_log = vi.fn(() => result);
    return { edit_log, resolve: () => resolve({ log: testEvalLog() }) };
  };

  it("enables Save only once there is a change and an author", () => {
    renderDialog({ edit_log: () => Promise.resolve({ log: testEvalLog() }) });
    expect(saveButton()).toBeDisabled();

    editTags();
    expect(saveButton()).toBeEnabled();

    fireEvent.change(authorField(), { target: { value: " " } });
    expect(saveButton()).toBeDisabled();
  });

  it("saves the tag changes with provenance, then closes and calls onSaved", async () => {
    const edit_log = vi.fn(() => Promise.resolve({ log: testEvalLog() }));
    const { setShowing, onSaved } = renderDialog({ edit_log });

    editTags();
    fireEvent.change(screen.getByLabelText("Reason"), {
      target: { value: " cleanup " },
    });
    fireEvent.click(saveButton());

    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
    expect(setShowing).toHaveBeenCalledWith(false);
    expect(edit_log).toHaveBeenCalledWith("/logs/x.eval", {
      edits: [{ type: "tags", tags_add: ["b"], tags_remove: ["a"] }],
      provenance: {
        author: "Ada",
        reason: "cleanup",
        metadata: {},
        timestamp: "2026-01-02T03:04:05.000Z",
      },
    });
  });

  it("saves once when Save is clicked twice", async () => {
    const { edit_log, resolve } = pendingSave();
    const { onSaved } = renderDialog({ edit_log });

    editTags();
    fireEvent.click(saveButton());
    fireEvent.click(saveButton());
    resolve();

    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
    expect(edit_log).toHaveBeenCalledOnce();
  });

  it("shows Saving… while a slow save is in flight", async () => {
    const { edit_log, resolve } = pendingSave();
    const { onSaved } = renderDialog({ edit_log });

    editTags();
    fireEvent.click(saveButton());

    expect(
      await screen.findByRole("button", { name: "Saving…" })
    ).toBeDisabled();
    resolve();
    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
  });

  it("shows the error and stays open when the save fails", async () => {
    const { setShowing, onSaved } = renderDialog({
      edit_log: () => Promise.reject(new ApiError(412, "ETag mismatch")),
    });

    editTags();
    fireEvent.click(saveButton());

    expect(
      await screen.findByText(/modified by someone else/)
    ).toBeInTheDocument();
    expect(setShowing).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
    expect(saveButton()).toBeEnabled();
  });
});
