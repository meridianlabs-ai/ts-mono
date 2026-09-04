// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { FC, ReactNode, useEffect, useMemo } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  FindProvider,
  useFindState,
  useFindSurface,
  type FindRow,
  type FindSource,
  type FindState,
  type FindSurface,
} from "../find";
import { FIND_IDLE_STATE } from "../find/findStore";
import { useMountEffect } from "../hooks/useMountEffect";
import { useOnChange } from "../hooks/useOnChange";
import { testIcons } from "../test/test-icons";

import { ComponentIconProvider } from "./ComponentIconContext";
import { ExtendedFindProvider, useExtendedFind } from "./ExtendedFindContext";
import { FindBand } from "./FindBand";
import { FindTargetProvider } from "./FindTargetContext";

const probe = { state: FIND_IDLE_STATE };
const StateProbe: FC = () => {
  useOnChange(useFindState(), (state) => {
    probe.state = state;
  });
  return null;
};
const coordinatorState = (): FindState => probe.state;

const Providers: FC<{ children: ReactNode }> = ({ children }) => (
  <ComponentIconProvider icons={testIcons}>
    <FindProvider>
      <StateProbe />
      <ExtendedFindProvider>
        <FindTargetProvider>{children}</FindTargetProvider>
      </ExtendedFindProvider>
    </FindProvider>
  </ComponentIconProvider>
);

const MatchCounter: FC<{ count: number }> = ({ count }) => {
  const { registerMatchCounter } = useExtendedFind();

  // eslint-disable-next-line tsmono/no-raw-use-effect -- baselined at rule introduction; migrate to a named hook or derived state
  useEffect(
    () => registerMatchCounter("find-band-test", () => count),
    [count, registerMatchCounter]
  );

  return null;
};

const TEST_PAGE_SIZE = 1000;

// A minimal coordinator surface: `matchesFor` maps a term to its row list.
// capped=true reports a live sample (renders as "M+"); `gate` holds every
// page until it resolves.
const TestSurface: FC<{
  matchesFor: (term: string) => FindRow[];
  capped?: boolean;
  gate?: Promise<void>;
}> = ({ matchesFor, capped = false, gate }) => {
  const surface = useMemo<FindSurface>(() => {
    const source: FindSource = {
      find: async (query, after) => {
        const all = matchesFor(query.text);
        const at = after ? all.findIndex((r) => r.anchor.id === after.id) : -1;
        const page = all.slice(at + 1, at + 1 + TEST_PAGE_SIZE);
        if (gate) await gate;
        return {
          rows: page,
          atEnd: at + 1 + page.length >= all.length,
          complete: !capped,
        };
      },
    };
    return { scopeId: "test", source, reveal: () => {} };
  }, [matchesFor, capped, gate]);
  useFindSurface(surface);
  return null;
};

const TermProbe: FC = () => (
  <span data-testid="coordinator-term">{useFindState().term}</span>
);

const matchList = (count: number): FindRow[] =>
  Array.from({ length: count }, (_, i) => ({
    anchor: { id: `m${i}` },
    index: i,
    count: 1,
    texts: ["needle"],
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
    // jsdom has no layout: the legacy path's post-find scroll reads rects.
    Range.prototype.getClientRects = () => document.body.getClientRects();
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

  it.each([
    { key: "Enter", shiftKey: false, backwards: false },
    { key: "Enter", shiftKey: true, backwards: true },
    { key: "g", ctrlKey: true, shiftKey: false, backwards: false },
    { key: "g", ctrlKey: true, shiftKey: true, backwards: true },
    { key: "F3", shiftKey: false, backwards: false },
    { key: "F3", shiftKey: true, backwards: true },
  ])(
    "searches with backwards=$backwards for $key",
    async ({ key, ctrlKey, shiftKey, backwards }) => {
      const { input } = renderFindBand();

      fireEvent.keyDown(input, { key, ctrlKey, shiftKey });

      await waitFor(() => expect(windowFind).toHaveBeenCalled());
      expect(windowFind.mock.calls.every((call) => call[2] === backwards)).toBe(
        true
      );
    }
  );

  describe("with a registered surface", () => {
    const needleMatches = (count: number) => (term: string) =>
      term === "needle" ? matchList(count) : [];

    // No pre-set input value (unlike renderFindBand): these tests type via
    // change events, and React dedupes a change to the already-set value.
    const renderWithSurface = (children: ReactNode, debounceMs?: number) => {
      render(
        <Providers>
          <FindBand onClose={vi.fn()} debounceMs={debounceMs} />
          {children}
        </Providers>
      );
      return screen.getByPlaceholderText<HTMLInputElement>("Find");
    };

    it("shows N of M from the source after typing, bypassing window.find", async () => {
      const input = renderWithSurface(
        <TestSurface matchesFor={needleMatches(1234)} />
      );

      fireEvent.change(input, { target: { value: "needle" } });

      await waitFor(() =>
        expect(screen.getByText("1 of 1,234").style.visibility).toBe("visible")
      );
      expect(windowFind).not.toHaveBeenCalled();

      fireEvent.keyDown(input, { key: "Enter", shiftKey: true }); // wrap back
      await waitFor(() =>
        expect(screen.getByText("1,234 of 1,234")).toBeTruthy()
      );
    });

    it("waits 500ms to search one letter and 300ms from the second", async () => {
      vi.useFakeTimers();
      try {
        const input = renderWithSurface(
          <>
            <TestSurface matchesFor={needleMatches(1)} />
            <TermProbe />
          </>
        );
        const term = () => screen.getByTestId("coordinator-term").textContent;

        fireEvent.change(input, { target: { value: "n" } });
        await act(async () => {
          await vi.advanceTimersByTimeAsync(499);
        });
        expect(term()).toBe("");

        fireEvent.change(input, { target: { value: "ne" } });
        await act(async () => {
          await vi.advanceTimersByTimeAsync(1);
        });
        expect(term()).toBe("");
        await act(async () => {
          await vi.advanceTimersByTimeAsync(299);
        });
        expect(term()).toBe("ne");

        fireEvent.change(input, { target: { value: "n" } });
        await act(async () => {
          await vi.advanceTimersByTimeAsync(500);
        });
        expect(term()).toBe("n");

        fireEvent.change(input, { target: { value: "" } });
        expect(term()).toBe("");

        fireEvent.change(input, { target: { value: "n" } });
        fireEvent.keyDown(input, { key: "Enter" });
        expect(term()).toBe("n");
        await act(async () => {
          await vi.advanceTimersByTimeAsync(500);
        });
        expect(term()).toBe("n");
      } finally {
        vi.useRealTimers();
      }
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

    it("Shift+Enter from the first match wraps to the last once the scan is done; a live sample stays M+", async () => {
      const input = renderWithSurface(
        <TestSurface matchesFor={needleMatches(2000)} capped />
      );
      fireEvent.change(input, { target: { value: "needle" } });
      await waitFor(() => expect(screen.getByText("1 of 2,000+")).toBeTruthy());

      fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
      await waitFor(() =>
        expect(screen.getByText("2,000 of 2,000+").style.visibility).toBe(
          "visible"
        )
      );
    });

    it("shows the failure until the next search", async () => {
      const Failing: FC = () => {
        const surface = useMemo<FindSurface>(
          () => ({
            scopeId: "test",
            source: { find: () => Promise.reject(new Error("HTTP 502")) },
            reveal: () => {},
          }),
          []
        );
        useFindSurface(surface);
        return null;
      };
      const input = renderWithSurface(<Failing />);
      fireEvent.change(input, { target: { value: "needle" } });
      await waitFor(() =>
        expect(screen.getByTestId("find-band-error").textContent).toBe(
          "HTTP 502"
        )
      );
      expect(screen.getByTestId("find-band-match-count").textContent).toBe(
        "Error"
      );

      fireEvent.change(input, { target: { value: "needles" } });
      await waitFor(() =>
        expect(screen.queryByTestId("find-band-error")).toBeNull()
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

      rerender(ui(5));
      await waitFor(() => expect(screen.getByText(/of 5/)).toBeTruthy());
    });

    it("searches the input's current term when a surface comes back", async () => {
      const ui = (withSurface: boolean) => (
        <Providers>
          <FindBand onClose={vi.fn()} />
          <TermProbe />
          {withSurface ? <TestSurface matchesFor={needleMatches(2)} /> : null}
        </Providers>
      );
      const { rerender } = render(ui(true));
      const input = screen.getByPlaceholderText<HTMLInputElement>("Find");
      fireEvent.change(input, { target: { value: "needle" } });
      await waitFor(() => expect(screen.getByText("1 of 2")).toBeTruthy());
      fireEvent.keyDown(input, { key: "Enter" });
      await waitFor(() => expect(screen.getByText("2 of 2")).toBeTruthy());

      // Another tab (legacy path): the coordinator keeps its term and place
      // while no surface is mounted; a return with a changed input searches
      // that instead.
      rerender(ui(false));
      expect(screen.getByTestId("coordinator-term").textContent).toBe("needle");
      fireEvent.change(input, { target: { value: "other" } });
      await waitFor(() => expect(windowFind).toHaveBeenCalled());
      rerender(ui(true));
      await waitFor(() =>
        expect(screen.getByText("No results").style.visibility).toBe("visible")
      );

      fireEvent.change(input, { target: { value: "needle" } });
      await waitFor(() => expect(screen.getByText("1 of 2")).toBeTruthy());
    });

    it("drops the legacy count when the surface takes over", async () => {
      const ui = (withSurface: boolean) => (
        <Providers>
          <FindBand onClose={vi.fn()} />
          <MatchCounter count={7} />
          <div data-testid="search-content">needle needle</div>
          {withSurface ? <TestSurface matchesFor={needleMatches(2)} /> : null}
        </Providers>
      );
      windowFind.mockImplementation(() => {
        const textNode = screen.getByTestId("search-content").firstChild;
        if (!textNode) return false;
        const range = document.createRange();
        range.setStart(textNode, 0);
        range.setEnd(textNode, 6);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
        return true;
      });
      const { rerender } = render(ui(false));
      const input = screen.getByPlaceholderText<HTMLInputElement>("Find");
      fireEvent.change(input, { target: { value: "needle" } });
      await waitFor(() => expect(screen.getByText("1 of 7")).toBeTruthy());

      rerender(ui(true));
      await waitFor(() => expect(screen.getByText("1 of 2")).toBeTruthy());
      rerender(ui(false));
      await waitFor(() =>
        expect(
          screen.getByTestId("find-band-match-count").style.visibility
        ).toBe("hidden")
      );
    });

    it("hides the count until the survey settles", async () => {
      let release: () => void = () => {};
      const gate = new Promise<void>((resolve) => (release = resolve));
      const input = renderWithSurface(
        <TestSurface matchesFor={needleMatches(3)} gate={gate} />
      );
      fireEvent.change(input, { target: { value: "needle" } });
      await waitFor(() => expect(coordinatorState().term).toBe("needle"));
      expect(screen.getByTestId("find-band-match-count").style.visibility).toBe(
        "hidden"
      );
      release();
      await waitFor(() => expect(screen.getByText("1 of 3")).toBeTruthy());
    });

    it("routes F3 and Ctrl+G to the coordinator", async () => {
      const input = renderWithSurface(
        <TestSurface matchesFor={needleMatches(2)} />
      );
      fireEvent.change(input, { target: { value: "needle" } });
      await waitFor(() => expect(screen.getByText("1 of 2")).toBeTruthy());

      fireEvent.keyDown(document.body, { key: "F3" });
      await waitFor(() => expect(screen.getByText("2 of 2")).toBeTruthy());
      fireEvent.keyDown(document.body, { key: "g", ctrlKey: true });
      await waitFor(() => expect(screen.getByText("1 of 2")).toBeTruthy());
      expect(windowFind).not.toHaveBeenCalled();
    });

    it("stops a legacy DOM search still in flight when a surface takes over", async () => {
      let release: () => void = () => {};
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const SlowVirtualList: FC = () => {
        const { registerVirtualList } = useExtendedFind();
        useMountEffect(() =>
          registerVirtualList("slow", (_term, _direction, onContentReady) =>
            gate.then(() => {
              onContentReady();
              return true;
            })
          )
        );
        return null;
      };
      const ui = (withSurface: boolean) => (
        <Providers>
          <FindBand onClose={vi.fn()} />
          <SlowVirtualList />
          <div>needle in the page</div>
          {withSurface ? <TestSurface matchesFor={needleMatches(2)} /> : null}
        </Providers>
      );
      const { rerender } = render(ui(false));
      const input = screen.getByPlaceholderText<HTMLInputElement>("Find");
      input.value = "needle";
      fireEvent.keyDown(input, { key: "Enter" });
      // window.find missed, so the legacy search is now awaiting the list.
      await waitFor(() => expect(windowFind).toHaveBeenCalledTimes(1));

      rerender(ui(true));
      await waitFor(() => expect(screen.getByText("1 of 2")).toBeTruthy());
      release();
      await act(() => gate);
      await act(() => new Promise((r) => setTimeout(r, 0)));
      expect(windowFind).toHaveBeenCalledTimes(1);
    });

    it("returns to the legacy path when the surface unmounts", async () => {
      const ui = (withSurface: boolean) => (
        <Providers>
          <FindBand onClose={vi.fn()} />
          {withSurface ? <TestSurface matchesFor={needleMatches(2)} /> : null}
        </Providers>
      );
      const { rerender } = render(ui(true));
      const input = screen.getByPlaceholderText<HTMLInputElement>("Find");
      fireEvent.change(input, { target: { value: "needle" } });
      await waitFor(() => expect(screen.getByText("1 of 2")).toBeTruthy());
      expect(windowFind).not.toHaveBeenCalled();

      rerender(ui(false));
      fireEvent.keyDown(input, { key: "Enter" });
      await waitFor(() => expect(windowFind).toHaveBeenCalled());
    });
  });

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
    dropdown.focus();

    fireEvent.keyDown(dropdown, { key: "b" });

    expect(document.activeElement).toBe(dropdown);
    expect(document.activeElement).not.toBe(input);
  });

  it("shows no-results state when DOM and extended search both miss", async () => {
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

  it("skips searching when the typed term extends a known miss", async () => {
    const { input } = renderFindBand();

    fireEvent.change(input, { target: { value: "needles" } });
    await waitFor(() =>
      expect(screen.getByText("No results").style.visibility).toBe("visible")
    );
    const callsAfterMiss = windowFind.mock.calls.length;

    fireEvent.change(input, { target: { value: "needlesX" } });
    await new Promise((resolve) => setTimeout(resolve, 250));

    expect(windowFind.mock.calls.length).toBe(callsAfterMiss);
    expect(screen.getByText("No results").style.visibility).toBe("visible");
  });

  it("re-searches a known miss on explicit Enter", async () => {
    const { input } = renderFindBand();

    fireEvent.change(input, { target: { value: "needles" } });
    await waitFor(() =>
      expect(screen.getByText("No results").style.visibility).toBe("visible")
    );
    const callsAfterMiss = windowFind.mock.calls.length;

    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() =>
      expect(windowFind.mock.calls.length).toBeGreaterThan(callsAfterMiss)
    );
  });

  it("shows No results when a counter reports matches but the find misses", async () => {
    const { input } = renderFindBand(vi.fn(), <MatchCounter count={3} />);

    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() =>
      expect(screen.getByText("No results").style.visibility).toBe("visible")
    );
    expect(screen.queryByText("0 of 3")).toBeNull();
  });

  it("refreshes the match count after counters re-register", async () => {
    windowFind.mockImplementation(() => {
      const textNode = screen.getByTestId("search-content").firstChild;
      if (!textNode) return false;
      const range = document.createRange();
      range.setStart(textNode, 0);
      range.setEnd(textNode, 6);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      return true;
    });
    const ui = (count: number) => (
      <Providers>
        <FindBand onClose={vi.fn()} />
        <MatchCounter count={count} />
        <div data-testid="search-content">needle needle</div>
      </Providers>
    );
    const { rerender } = render(ui(2));
    const input = screen.getByPlaceholderText<HTMLInputElement>("Find");
    input.value = "needle";

    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(screen.getByText("1 of 2")).toBeTruthy());

    // Content changed: the counter re-registers with a new total
    rerender(ui(5));
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => expect(screen.getByText(/of 5/)).toBeTruthy());
  });

  it("shows the registered match count and current index", async () => {
    windowFind.mockImplementation(() => {
      const textNode = screen.getByTestId("search-content").firstChild;
      if (!textNode) return false;
      const range = document.createRange();
      range.setStart(textNode, 0);
      range.setEnd(textNode, 6);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      return true;
    });
    const { input } = renderFindBand(
      vi.fn(),
      <>
        <MatchCounter count={2} />
        <div data-testid="search-content">needle needle</div>
      </>
    );

    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() =>
      expect(screen.getByText("1 of 2").style.visibility).toBe("visible")
    );
  });
});
