// @vitest-environment jsdom
/**
 * Regression: the metadata editor was applying `JSON.parse` to every
 * value on save regardless of the type the user picked when adding the
 * row. So a row added as `string` with content `43` was being saved as
 * the number `43` — visible in the JSON tab as `"key": 43` with no
 * quotes. The fix tracks `isString` per entry and bypasses JSON parsing
 * when it's true; the helper below is the load-bearing piece.
 */

import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { testEvalLog } from "@tsmono/inspect-common/testing";
import { ResizeObserverStub } from "@tsmono/react/testing";

import { ClientAPI, EditLogResult } from "../../../client/api/types";

import {
  EditMetadataDialog,
  MetadataParseError,
  MetaEntry,
  serializeEntry,
} from "./EditMetadataDialog";
import { renderEditDialog } from "./renderEditDialog";

describe("serializeEntry", () => {
  test("string-typed row keeps its text verbatim (does not parse `43` as number)", () => {
    const entry: MetaEntry = {
      key: "version",
      text: "43",
      isString: true,
      isNew: true,
      dirty: true,
    };
    expect(serializeEntry(entry)).toBe("43");
    expect(typeof serializeEntry(entry)).toBe("string");
  });

  test("string-typed row keeps primitive-looking text as a string", () => {
    // Strings that look like JSON *primitives* still respect the
    // dropdown — they don't carry a structural prefix (`{`, `[`, `"`).
    // A row of `[1,2]` is structural and is parsed; that case is
    // covered by the auto-promote test below.
    expect(
      serializeEntry({
        key: "v",
        text: "0",
        isString: true,
        isNew: true,
        dirty: true,
      })
    ).toBe("0");
    expect(
      serializeEntry({
        key: "v",
        text: "true",
        isString: true,
        isNew: true,
        dirty: true,
      })
    ).toBe("true");
    expect(
      serializeEntry({
        key: "v",
        text: "null",
        isString: true,
        isNew: true,
        dirty: true,
      })
    ).toBe("null");
  });

  test("non-string row parses JSON literals to their native types", () => {
    // No `isString` → JSON parse path. Used by numbers / booleans /
    // arrays / objects / null, and as a backstop for existing string
    // metadata edited by hand (which round-trips through `parseOrRaw`
    // but falls back to raw text on parse failure).
    expect(
      serializeEntry({ key: "v", text: "43", isNew: true, dirty: true })
    ).toBe(43);
    expect(
      serializeEntry({ key: "v", text: "true", isNew: true, dirty: true })
    ).toBe(true);
    expect(
      serializeEntry({ key: "v", text: "null", isNew: true, dirty: true })
    ).toBeNull();
    expect(
      serializeEntry({
        key: "v",
        text: "[1,2,3]",
        isNew: true,
        dirty: true,
      })
    ).toEqual([1, 2, 3]);
    expect(
      serializeEntry({
        key: "v",
        text: '{"x":1}',
        isNew: true,
        dirty: true,
      })
    ).toEqual({ x: 1 });
  });

  test("non-string row throws MetadataParseError when JSON.parse fails", () => {
    // A user who picked `object` but typed JS shorthand (`{a: 1}`)
    // used to have it silently saved as the literal string. With the
    // explicit isString flag tracking the user's choice, falling back
    // to a string is the wrong behavior — surface the error so the
    // user knows to quote their JSON keys.
    expect(() =>
      serializeEntry({
        key: "obj",
        text: "{a: 1}",
        isNew: true,
        dirty: true,
      })
    ).toThrow(MetadataParseError);
    expect(() =>
      serializeEntry({
        key: "v",
        text: "approved",
        isNew: true,
        dirty: true,
      })
    ).toThrow(MetadataParseError);
  });

  test("non-string row accepts well-formed JSON objects", () => {
    expect(
      serializeEntry({
        key: "obj",
        text: '{"a": 1}',
        isNew: true,
        dirty: true,
      })
    ).toEqual({ a: 1 });
  });

  test("MetadataParseError carries the key for per-row UI messaging", () => {
    let caught: unknown;
    try {
      serializeEntry({
        key: "thingy",
        text: "{a: 1}",
        isNew: true,
        dirty: true,
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(MetadataParseError);
    if (!(caught instanceof MetadataParseError)) return;
    expect(caught.key).toBe("thingy");
    expect(caught.text).toBe("{a: 1}");
  });

  // Regression: the most common path into the dialog leaves the type
  // dropdown at its default of `string`, so a user typing `{a: 1}` to
  // create an object had their value silently saved as the literal
  // string `"{a: 1}"`. Validating any text that *looks structural*
  // (leading `{`, `[`, `"`) catches that — typing those characters is
  // an unambiguous JSON intent regardless of the type dropdown.
  test("string-typed row with object-looking text still throws on bad JSON", () => {
    expect(() =>
      serializeEntry({
        key: "obj",
        text: "{a: 1}",
        isString: true,
        isNew: true,
        dirty: true,
      })
    ).toThrow(MetadataParseError);
  });

  test("string-typed row with array-looking text still throws on bad JSON", () => {
    expect(() =>
      serializeEntry({
        key: "arr",
        text: "[1, 2,]",
        isString: true,
        isNew: true,
        dirty: true,
      })
    ).toThrow(MetadataParseError);
  });

  test("string-typed row with structural-looking but valid JSON saves the parsed value", () => {
    // Auto-promote: the user clearly intended an object, but left the
    // dropdown at the default `string`. We honor the structural intent.
    expect(
      serializeEntry({
        key: "obj",
        text: '{"a": 1}',
        isString: true,
        isNew: true,
        dirty: true,
      })
    ).toEqual({ a: 1 });
  });

  test("string-typed row with non-structural text is still saved verbatim", () => {
    // Primitives without JSON-syntax prefixes respect the dropdown:
    // `43` stays the string "43", `approved` stays "approved", `true`
    // stays "true". The original string-vs-number fix is preserved.
    expect(
      serializeEntry({
        key: "v",
        text: "43",
        isString: true,
        isNew: true,
        dirty: true,
      })
    ).toBe("43");
    expect(
      serializeEntry({
        key: "v",
        text: "approved",
        isString: true,
        isNew: true,
        dirty: true,
      })
    ).toBe("approved");
    expect(
      serializeEntry({
        key: "v",
        text: "true",
        isString: true,
        isNew: true,
        dirty: true,
      })
    ).toBe("true");
  });
});

describe("EditMetadataDialog save", () => {
  beforeEach(() => {
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-01-02T03:04:05Z"));
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  const renderDialog = (api: Partial<ClientAPI>) => {
    const setShowing = vi.fn();
    const onSaved = vi.fn();
    renderEditDialog(api, (showing) => (
      <EditMetadataDialog
        showing={showing}
        setShowing={setShowing}
        currentMetadata={{ a: "x", b: 1 }}
        logFile="/logs/x.eval"
        onSaved={onSaved}
      />
    ));
    return { setShowing, onSaved };
  };

  const saveButton = () => screen.getByRole("button", { name: "Save" });
  const setAuthor = () =>
    fireEvent.change(screen.getByLabelText(/Author/), {
      target: { value: "Ada" },
    });

  const editMetadata = () => {
    fireEvent.change(screen.getByDisplayValue("x"), { target: { value: "y" } });
    fireEvent.click(screen.getByRole("button", { name: "Remove b" }));
    setAuthor();
  };

  test("saves the metadata changes with provenance, then closes and calls onSaved", async () => {
    const edit_log = vi.fn(() => Promise.resolve({ log: testEvalLog() }));
    const { setShowing, onSaved } = renderDialog({ edit_log });

    editMetadata();
    fireEvent.click(saveButton());

    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
    expect(setShowing).toHaveBeenCalledWith(false);
    expect(edit_log).toHaveBeenCalledWith("/logs/x.eval", {
      edits: [
        { type: "metadata", metadata_set: { a: "y" }, metadata_remove: ["b"] },
      ],
      provenance: {
        author: "Ada",
        reason: undefined,
        metadata: {},
        timestamp: "2026-01-02T03:04:05.000Z",
      },
    });
  });

  test("saves once when Save is clicked twice", async () => {
    let resolve: (result: EditLogResult) => void = () => {};
    const result = new Promise<EditLogResult>((r) => {
      resolve = r;
    });
    const edit_log = vi.fn(() => result);
    const { onSaved } = renderDialog({ edit_log });

    editMetadata();
    fireEvent.click(saveButton());
    fireEvent.click(saveButton());
    resolve({ log: testEvalLog() });

    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
    expect(edit_log).toHaveBeenCalledOnce();
  });

  test("shows the error and stays open when the save fails", async () => {
    const { setShowing, onSaved } = renderDialog({
      edit_log: () => Promise.reject(new TypeError("Failed to fetch")),
    });

    editMetadata();
    fireEvent.click(saveButton());

    expect(await screen.findByText(/view server unreachable/)).toBeVisible();
    expect(setShowing).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
  });

  test("names the key with invalid JSON and does not send the edit", async () => {
    const edit_log = vi.fn(() => Promise.resolve({ log: testEvalLog() }));
    const { setShowing } = renderDialog({ edit_log });

    fireEvent.change(screen.getByDisplayValue("1"), {
      target: { value: "{a: 1}" },
    });
    setAuthor();
    fireEvent.click(saveButton());

    expect(
      await screen.findByText(/Invalid JSON for "b"\. Use JSON syntax/)
    ).toBeVisible();
    expect(edit_log).not.toHaveBeenCalled();
    expect(setShowing).not.toHaveBeenCalled();
  });
});
