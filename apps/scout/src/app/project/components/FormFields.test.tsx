// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { forwardRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { KeyValueField, parseKeyValueLines } from "./FormFields";

// VscodeTextarea is a custom element backed by ElementInternals, which jsdom
// doesn't fully implement. Stub it with a plain textarea (same pattern as
// SearchPanel.test.tsx).
vi.mock("@vscode-elements/react-elements", async () => {
  const actual = await vi.importActual<
    typeof import("@vscode-elements/react-elements")
  >("@vscode-elements/react-elements");
  type StubProps = {
    value?: string;
    onInput?: (e: Event) => void;
    placeholder?: string;
    rows?: number;
  };
  const VscodeTextareaStub = forwardRef<HTMLTextAreaElement, StubProps>(
    function VscodeTextareaStub({ value, onInput, placeholder, rows }, ref) {
      return (
        <textarea
          ref={ref}
          value={value ?? ""}
          placeholder={placeholder}
          rows={rows}
          onInput={(e) => onInput?.(e.nativeEvent)}
          onChange={() => {}}
          data-testid="kv-textarea"
        />
      );
    }
  );
  return { ...actual, VscodeTextarea: VscodeTextareaStub };
});

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

  const getTextarea = (): HTMLTextAreaElement => {
    const el = screen.getByTestId("kv-textarea");
    if (!(el instanceof HTMLTextAreaElement)) {
      throw new Error("kv-textarea stub did not render a textarea");
    }
    return el;
  };

  const renderField = (value: Record<string, unknown> | null) => {
    const onChange = vi.fn();
    const { rerender } = render(
      <KeyValueField label="Metadata" value={value} onChange={onChange} />
    );
    const textarea = getTextarea();
    const type = (text: string) =>
      fireEvent.input(textarea, { target: { value: text } });
    const setValue = (next: Record<string, unknown> | null) =>
      rerender(
        <KeyValueField label="Metadata" value={next} onChange={onChange} />
      );
    return { onChange, type, textarea, setValue };
  };

  it("propagates parsed pairs as the user types", () => {
    const { onChange, type } = renderField(null);
    type("b=2");
    expect(onChange).toHaveBeenLastCalledWith({ b: 2 });
  });

  it("keeps the last valid value when non-empty text parses to nothing", () => {
    const { onChange, type } = renderField({ a: 1 });
    type("/some/path");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("propagates null when the field is cleared", () => {
    const { onChange, type } = renderField({ a: 1 });
    type("");
    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  it("syncs the textarea when the value changes externally", () => {
    const { textarea, setValue } = renderField({ a: 1 });
    expect(textarea.value).toBe("a=1");
    setValue({ a: 2 });
    expect(textarea.value).toBe("a=2");
  });

  it("keeps in-progress unparseable text when a save lands mid-edit", () => {
    const { onChange, type, textarea, setValue } = renderField({ a: 1 });
    // Select-all + type: text no longer parses, so the edit isn't propagated
    type("b");
    expect(onChange).not.toHaveBeenCalled();
    // A completing save replaces the value with a fresh-identity object; the
    // resync must not clobber the text under the user's cursor
    setValue({ a: 1 });
    expect(textarea.value).toBe("b");
  });
});
