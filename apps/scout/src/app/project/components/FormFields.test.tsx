// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { innerTextarea, onlyElement } from "../../../test/webComponents";

import { KeyValueField, parseKeyValueLines } from "./FormFields";

describe("parseKeyValueLines", () => {
  it("parses key=value lines, preserving numbers", () => {
    expect(parseKeyValueLines("a=1\nb=two", false)).toEqual({
      a: 1,
      b: "two",
    });
  });

  it("returns path-like input as a string when paths are allowed", () => {
    expect(parseKeyValueLines("/path/to/config.yaml", true)).toBe(
      "/path/to/config.yaml"
    );
    expect(parseKeyValueLines("~/config.yaml", true)).toBe("~/config.yaml");
  });

  it("parses path-looking key=value input as pairs when paths are not allowed", () => {
    expect(parseKeyValueLines("~team=infra", false)).toEqual({
      "~team": "infra",
    });
  });

  it("returns null when nothing parses", () => {
    expect(parseKeyValueLines("", false)).toBeNull();
    expect(parseKeyValueLines("/no/pairs/here", false)).toBeNull();
    expect(parseKeyValueLines(null, true)).toBeNull();
  });
});

describe("KeyValueField", () => {
  afterEach(() => {
    cleanup();
  });

  // The real vscode-textarea binds its inner <textarea> value as a Lit
  // property, so an external value lands one render later.
  const settled = () => new Promise((r) => setTimeout(r, 0));

  const renderField = async (value: Record<string, unknown> | null) => {
    const onChange = vi.fn();
    const { rerender } = render(
      <KeyValueField label="Metadata" value={value} onChange={onChange} />
    );
    // Lit renders the shadow tree in a microtask after connect.
    const host = onlyElement("vscode-textarea");
    const textarea = await waitFor(() => innerTextarea(host));
    await waitFor(() => expect(textarea.value).toBe(linesFor(value)));
    const type = (text: string) =>
      fireEvent.input(textarea, { target: { value: text } });
    const setValue = (next: Record<string, unknown> | null) =>
      rerender(
        <KeyValueField label="Metadata" value={next} onChange={onChange} />
      );
    return { onChange, type, textarea, setValue };
  };

  const linesFor = (value: Record<string, unknown> | null): string =>
    value
      ? Object.entries(value)
          .map(([k, v]) => `${k}=${String(v)}`)
          .join("\n")
      : "";

  it("propagates parsed pairs as the user types", async () => {
    const { onChange, type } = await renderField(null);
    type("b=2");
    expect(onChange).toHaveBeenLastCalledWith({ b: 2 });
  });

  it("keeps the last valid value when non-empty text parses to nothing", async () => {
    const { onChange, type } = await renderField({ a: 1 });
    type("/some/path");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("propagates null when the field is cleared", async () => {
    const { onChange, type } = await renderField({ a: 1 });
    type("");
    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  it("syncs the textarea when the value changes externally", async () => {
    const { textarea, setValue } = await renderField({ a: 1 });
    expect(textarea.value).toBe("a=1");
    setValue({ a: 2 });
    await waitFor(() => expect(textarea.value).toBe("a=2"));
  });

  it("keeps the user's line order when a save echoes equal pairs reordered", async () => {
    const { onChange, type, textarea, setValue } = await renderField({
      a: 1,
      b: 2,
    });
    type("b=2\na=1");
    expect(onChange).toHaveBeenLastCalledWith({ b: 2, a: 1 });
    // The server may serialize keys in a different order; equal content must
    // not rewrite the textarea (and jump the cursor)
    setValue({ a: 1, b: 2 });
    await settled();
    expect(textarea.value).toBe("b=2\na=1");
  });

  it("keeps in-progress unparseable text when a save lands mid-edit", async () => {
    const { onChange, type, textarea, setValue } = await renderField({ a: 1 });
    // Select-all + type: text no longer parses, so the edit isn't propagated
    type("b");
    expect(onChange).not.toHaveBeenCalled();
    // A completing save replaces the value with a fresh-identity object; the
    // resync must not clobber the text under the user's cursor
    setValue({ a: 1 });
    await settled();
    expect(textarea.value).toBe("b");
  });
});
