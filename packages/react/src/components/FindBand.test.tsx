// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { FC, ReactNode, useMemo } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  FindProvider,
  useFindSurface,
  type FindMatch,
  type FindSource,
  type FindStreamItem,
  type FindSurface,
} from "../find";
import { testIcons } from "../test/test-icons";

import { ComponentIconProvider } from "./ComponentIconContext";
import { FindBand } from "./FindBand";
import { FindTargetProvider } from "./FindTargetContext";

const Providers: FC<{ children: ReactNode }> = ({ children }) => (
  <ComponentIconProvider icons={testIcons}>
    <FindProvider>
      <FindTargetProvider>{children}</FindTargetProvider>
    </FindProvider>
  </ComponentIconProvider>
);

// A minimal in-memory surface: `matchesFor` maps a term to its match list.
// capped=true reports a "gte" total (renders as "M+").
const TestSurface: FC<{
  matchesFor: (term: string) => FindMatch[];
  capped?: boolean;
}> = ({ matchesFor, capped = false }) => {
  const surface = useMemo<FindSurface>(() => {
    const source: FindSource = {
      scopeId: "test",
      capabilities: { complete: true },
      // eslint-disable-next-line @typescript-eslint/require-await -- in-memory test source
      async *find(query, opts): AsyncIterable<FindStreamItem> {
        const all = matchesFor(query.text);
        const limit = opts.limit ?? Number.POSITIVE_INFINITY;
        const page = all.slice(0, limit);
        if (page.length > 0) yield { kind: "matches", matches: page };
        yield {
          kind: "end",
          complete: true,
          total: capped
            ? { value: page.length, relation: "gte" }
            : { value: all.length, relation: "eq" },
        };
      },
    };
    return {
      scopeId: "test",
      source,
      reveal: () => Promise.resolve("revealed"),
    };
  }, [matchesFor, capped]);
  useFindSurface(surface);
  return null;
};

const matchList = (count: number): FindMatch[] =>
  Array.from({ length: count }, (_, i) => ({
    anchor: { kind: "event" as const, id: `e${i}` },
    occurrence: 0,
  }));

const renderFindBand = (onClose = vi.fn(), children?: ReactNode) => {
  render(
    <Providers>
      <FindBand onClose={onClose} />
      {children}
    </Providers>
  );
  const input = screen.getByPlaceholderText<HTMLInputElement>("Find");
  input.value = "needle";
  return { input, onClose };
};

describe("FindBand", () => {
  let windowFind: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    windowFind = vi.fn(() => false);
    Object.defineProperty(window, "find", {
      configurable: true,
      value: windowFind,
    });
  });

  afterEach(() => {
    cleanup();
    window.getSelection()?.removeAllRanges();
    vi.restoreAllMocks();
  });

  it("closes on Escape", () => {
    const onClose = vi.fn();
    const { input } = renderFindBand(onClose);

    fireEvent.keyDown(input, { key: "Escape" });

    expect(onClose).toHaveBeenCalledOnce();
  });

  // ---- Coordinator path (a surface is registered) -------------------------

  describe("with a registered surface", () => {
    const needleMatches = (count: number) => (term: string) =>
      term === "needle" ? matchList(count) : [];

    // No pre-set input value (unlike renderFindBand): these tests type via
    // change events, and React dedupes a change to the already-set value.
    const renderWithSurface = (children: ReactNode) => {
      render(
        <Providers>
          <FindBand onClose={vi.fn()} />
          {children}
        </Providers>
      );
      return screen.getByPlaceholderText<HTMLInputElement>("Find");
    };

    it("shows N of M from the source after typing", async () => {
      const input = renderWithSurface(
        <TestSurface matchesFor={needleMatches(2)} />
      );

      fireEvent.change(input, { target: { value: "needle" } });

      await waitFor(() =>
        expect(screen.getByText("1 of 2").style.visibility).toBe("visible")
      );
      // The DOM find engine must stay out of the coordinator path.
      expect(windowFind).not.toHaveBeenCalled();
    });

    it("steps with Enter and wraps around", async () => {
      const input = renderWithSurface(
        <TestSurface matchesFor={needleMatches(2)} />
      );
      fireEvent.change(input, { target: { value: "needle" } });
      await waitFor(() => expect(screen.getByText("1 of 2")).toBeTruthy());

      fireEvent.keyDown(input, { key: "Enter" });
      await waitFor(() => expect(screen.getByText("2 of 2")).toBeTruthy());

      fireEvent.keyDown(input, { key: "Enter" }); // wrap
      await waitFor(() => expect(screen.getByText("1 of 2")).toBeTruthy());

      fireEvent.keyDown(input, { key: "Enter", shiftKey: true }); // wrap back
      await waitFor(() => expect(screen.getByText("2 of 2")).toBeTruthy());
    });

    it("renders a lower-bound total as M+", async () => {
      const input = renderWithSurface(
        <TestSurface matchesFor={needleMatches(3)} capped />
      );

      fireEvent.change(input, { target: { value: "needle" } });

      await waitFor(() =>
        expect(screen.getByText("1 of 3+").style.visibility).toBe("visible")
      );
    });

    it("shows No results when the source has no matches", async () => {
      const input = renderWithSurface(<TestSurface matchesFor={() => []} />);

      fireEvent.change(input, { target: { value: "absent" } });

      await waitFor(() =>
        expect(screen.getByText("No results").style.visibility).toBe("visible")
      );
      expect(windowFind).not.toHaveBeenCalled();
    });

    it("recounts when the surface's data changes", async () => {
      const ui = (count: number) => (
        <Providers>
          <FindBand onClose={vi.fn()} />
          <TestSurface matchesFor={needleMatches(count)} />
        </Providers>
      );
      const { rerender } = render(ui(2));
      const input = screen.getByPlaceholderText<HTMLInputElement>("Find");

      fireEvent.change(input, { target: { value: "needle" } });
      await waitFor(() => expect(screen.getByText("1 of 2")).toBeTruthy());

      // Data changed: the surface re-registers with a new source.
      rerender(ui(5));
      await waitFor(() => expect(screen.getByText(/of 5/)).toBeTruthy());
    });
  });

  // ---- Legacy fallback path (no surface registered) ------------------------

  it.each([
    { key: "Enter", shiftKey: false, backwards: false },
    { key: "Enter", shiftKey: true, backwards: true },
    { key: "g", ctrlKey: true, shiftKey: false, backwards: false },
    { key: "g", ctrlKey: true, shiftKey: true, backwards: true },
    { key: "F3", shiftKey: false, backwards: false },
    { key: "F3", shiftKey: true, backwards: true },
  ])(
    "falls back to window.find with backwards=$backwards for $key",
    async ({ key, ctrlKey, shiftKey, backwards }) => {
      const { input } = renderFindBand();

      fireEvent.keyDown(input, { key, ctrlKey, shiftKey });

      await waitFor(() => expect(windowFind).toHaveBeenCalled());
      expect(windowFind.mock.calls.every((call) => call[2] === backwards)).toBe(
        true
      );
    }
  );

  it("finds previous on Cmd+Shift+G when focus is outside the input", async () => {
    renderFindBand(vi.fn(), <div data-testid="outside">content</div>);

    // Shift makes e.key uppercase; the global handler must still match
    fireEvent.keyDown(document.body, {
      key: "G",
      metaKey: true,
      shiftKey: true,
    });

    await waitFor(() => expect(windowFind).toHaveBeenCalled());
    expect(windowFind.mock.calls.every((call) => call[2] === true)).toBe(true);
  });

  it("intercepts Cmd+F with CapsLock (uppercase key) instead of native find", () => {
    const { input } = renderFindBand();
    input.blur();

    const event = fireEvent.keyDown(document.body, {
      key: "F",
      metaKey: true,
    });

    // preventDefault called → returns false; native browser find is blocked
    expect(event).toBe(false);
    expect(document.activeElement).toBe(input);
  });

  // Runs a debounced search to completion, which arms the cursor-restore flag
  const armCursorRestore = async (input: HTMLInputElement) => {
    fireEvent.change(input, { target: { value: "needles" } });
    await waitFor(() =>
      expect(screen.getByText("No results").style.visibility).toBe("visible")
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
  };

  it("restores the caret to the end when the browser reset it to 0", async () => {
    const { input } = renderFindBand();
    await armCursorRestore(input);

    input.focus();
    input.setSelectionRange(0, 0);
    fireEvent.keyDown(input, { key: "x" });

    expect(input.selectionStart).toBe(input.value.length);
  });

  it("respects a user-placed mid-text caret after a search", async () => {
    const { input } = renderFindBand();
    await armCursorRestore(input);

    input.focus();
    input.setSelectionRange(2, 2);
    fireEvent.keyDown(input, { key: "x" });

    expect(input.selectionStart).toBe(2);
  });

  it("doesn't steal keystrokes from a focused select", () => {
    const { input } = renderFindBand(
      vi.fn(),
      <select data-testid="dropdown">
        <option>alpha</option>
        <option>beta</option>
      </select>
    );
    const dropdown = screen.getByTestId("dropdown");
    (dropdown as HTMLSelectElement).focus();

    fireEvent.keyDown(dropdown, { key: "b" });

    expect(document.activeElement).toBe(dropdown);
    expect(document.activeElement).not.toBe(input);
  });

  it("shows no-results state when the fallback find misses", async () => {
    const { input } = renderFindBand();

    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() =>
      expect(screen.getByText("No results").style.visibility).toBe("visible")
    );
  });

  it("degrades to No results when window.find is unavailable", async () => {
    Object.defineProperty(window, "find", {
      configurable: true,
      value: undefined,
    });
    const { input } = renderFindBand();

    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() =>
      expect(screen.getByText("No results").style.visibility).toBe("visible")
    );
  });
});
