// @vitest-environment jsdom
import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ResizeObserverStub } from "../test/dom-stubs";

import { ChunkedText } from "./ChunkedText";
import { kChunkSize, kChunkThreshold } from "./textChunks";

vi.stubGlobal("ResizeObserver", ResizeObserverStub);

const oneLine = (length: number) =>
  Array.from({ length }, (_, i) => String(i % 10)).join("");

describe("ChunkedText", () => {
  it("renders text up to the threshold as a single text node", () => {
    const text = oneLine(kChunkThreshold);
    const { container } = render(
      <pre>
        <ChunkedText text={text} />
      </pre>
    );
    const pre = container.querySelector("pre");
    expect(pre?.childNodes).toHaveLength(1);
    expect(pre?.textContent).toBe(text);
  });

  it("renders longer text as chunks holding the whole text", () => {
    const text = `${"line\n".repeat(kChunkThreshold / 5)}tail`;
    const { container } = render(
      <pre>
        <ChunkedText text={text} />
      </pre>
    );
    const chunks = container.querySelectorAll("pre > span > span");
    expect(chunks.length).toBeGreaterThan(1);
    expect(container.textContent).toBe(text);
  });

  it("copies a selection across a mid-line chunk boundary without adding a newline", () => {
    const text = oneLine(kChunkSize * 3);
    const { container } = render(
      <pre>
        <ChunkedText text={text} />
      </pre>
    );
    const chunks = [...container.querySelectorAll("pre > span > span")];
    const firstChunk = chunks[0];
    const first = firstChunk?.firstChild;
    const second = chunks[1]?.firstChild;
    if (!firstChunk || !(first instanceof Text) || !(second instanceof Text)) {
      throw new Error("expected text chunks");
    }
    const range = document.createRange();
    range.setStart(first, first.length - 5);
    range.setEnd(second, 5);
    getSelection()?.removeAllRanges();
    getSelection()?.addRange(range);

    const setData = vi.fn();
    fireEvent.copy(firstChunk, { clipboardData: { setData } });

    expect(setData).toHaveBeenCalledWith(
      "text/plain",
      text.slice(first.length - 5, first.length + 5)
    );
  });
});
