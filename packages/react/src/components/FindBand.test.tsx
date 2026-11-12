// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { FC, ReactNode, useEffect, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { stubFindHighlightApi } from "../test/dom-stubs";

import {
  ExtendedFindProvider,
  FindDirection,
  FindSource,
  useExtendedFind,
} from "./ExtendedFindContext";
import { FindBand } from "./FindBand";
import { FindTargetProvider, useFindTarget } from "./FindTargetContext";

let highlights: Map<string, Set<AbstractRange>>;

beforeEach(() => {
  highlights = stubFindHighlightApi(vi.stubGlobal);
});

afterEach(() => {
  // Unmount while the highlight stub is still installed.
  cleanup();
  window.getSelection()?.removeAllRanges();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const FindTargetProbe: FC = () => (
  <span data-unsearchable data-testid="find-target">
    {useFindTarget()?.term ?? ""}
  </span>
);

const Page: FC<{
  children: ReactNode;
  open?: boolean;
  onClose?: () => void;
}> = ({ children, open = true, onClose = vi.fn() }) => (
  <ExtendedFindProvider>
    <FindTargetProvider>
      {open && <FindBand onClose={onClose} />}
      <FindTargetProbe />
      {children}
    </FindTargetProvider>
  </ExtendedFindProvider>
);

const input = () => screen.getByPlaceholderText<HTMLInputElement>("Find");
const status = () => screen.getByTestId("find-band-match-count");

// Enter on a new term searches it at once, without the type-ahead debounce.
const search = (term: string) => {
  fireEvent.change(input(), { target: { value: term } });
  fireEvent.keyDown(input(), { key: "Enter" });
};

const highlighted = (name: string) =>
  [...(highlights.get(name) ?? [])].map((range) =>
    range instanceof Range
      ? range.startContainer.parentElement?.closest("p")?.id
      : undefined
  );

const threeNeedles = (
  <>
    <p id="a">needle one</p>
    <p id="b">needle two</p>
    <p id="c">needle three</p>
  </>
);

describe("FindBand", () => {
  it("highlights every match and counts them", () => {
    render(<Page>{threeNeedles}</Page>);
    search("needle");

    expect(status().textContent).toBe("1 of 3");
    expect(highlighted("find-current")).toEqual(["a"]);
    expect(highlighted("find-match")).toEqual(["b", "c"]);
  });

  it("steps with Enter and Shift+Enter, wrapping at both ends", () => {
    render(<Page>{threeNeedles}</Page>);
    search("needle");

    const steps: [boolean, string, string][] = [
      [false, "2 of 3", "b"],
      [false, "3 of 3", "c"],
      [false, "1 of 3", "a"],
      [true, "3 of 3", "c"],
      [true, "2 of 3", "b"],
    ];
    for (const [shiftKey, text, id] of steps) {
      fireEvent.keyDown(input(), { key: "Enter", shiftKey });
      expect(status().textContent).toBe(text);
      expect(highlighted("find-current")).toEqual([id]);
    }
  });

  it.each([
    { key: "g", metaKey: true, shiftKey: false, expected: "2 of 3" },
    { key: "G", metaKey: true, shiftKey: true, expected: "3 of 3" },
    { key: "F3", metaKey: false, shiftKey: false, expected: "2 of 3" },
    { key: "F3", metaKey: false, shiftKey: true, expected: "3 of 3" },
  ])(
    "steps on $key (shift: $shiftKey) from outside the input",
    ({ key, metaKey, shiftKey, expected }) => {
      render(<Page>{threeNeedles}</Page>);
      search("needle");

      fireEvent.keyDown(document.body, { key, metaKey, shiftKey });

      expect(status().textContent).toBe(expected);
    }
  );

  it("leaves the selection and focus alone", () => {
    render(
      <Page>
        {threeNeedles}
        <p id="mine">my selection</p>
      </Page>
    );
    input().focus();
    search("needle");
    fireEvent.keyDown(input(), { key: "Enter" });
    expect(document.activeElement).toBe(input());

    const selection = window.getSelection()!;
    selection.selectAllChildren(document.getElementById("mine")!);
    fireEvent.keyDown(document.body, { key: "F3" });

    expect(status().textContent).toBe("3 of 3");
    expect(selection.toString()).toBe("my selection");
  });

  it("searches a new term backward on Shift+Enter", () => {
    render(<Page>{threeNeedles}</Page>);
    fireEvent.change(input(), { target: { value: "needle" } });

    fireEvent.keyDown(input(), { key: "Enter", shiftKey: true });

    expect(status().textContent).toBe("3 of 3");
  });

  it("keeps the current match while the term grows, if it still matches", () => {
    render(
      <Page>
        <p id="a">abc</p>
        <p id="b">ab</p>
        <p id="c">abc</p>
      </Page>
    );
    search("ab");
    fireEvent.keyDown(input(), { key: "Enter" });
    fireEvent.keyDown(input(), { key: "Enter" });
    expect(highlighted("find-current")).toEqual(["c"]);

    search("abc");

    expect(status().textContent).toBe("2 of 2");
    expect(highlighted("find-current")).toEqual(["c"]);
  });

  it("does not count unsearchable text", () => {
    render(
      <Page>
        <p id="a">needle</p>
        <p data-unsearchable>needle</p>
      </Page>
    );
    search("needle");

    expect(status().textContent).toBe("1 of 1");
  });

  it("shows No results when nothing matches", () => {
    render(<Page>{threeNeedles}</Page>);
    search("haystack");

    expect(status().textContent).toBe("No results");
    expect(status().style.visibility).toBe("visible");
    expect(highlights.size).toBe(0);
  });

  it("counts matches that render after the search", async () => {
    const Late: FC = () => {
      const [shown, setShown] = useState(false);
      return (
        <>
          {threeNeedles}
          <button onClick={() => setShown(true)}>more</button>
          {shown && <p id="d">needle four</p>}
        </>
      );
    };
    render(
      <Page>
        <Late />
      </Page>
    );
    search("needle");
    fireEvent.click(screen.getByText("more"));

    await waitFor(() => expect(status().textContent).toBe("1 of 4"));
    expect(highlighted("find-match")).toEqual(["b", "c", "d"]);
  });

  it("stays on the current match when text renders above it", async () => {
    const Growing: FC = () => {
      const [shown, setShown] = useState(false);
      return (
        <>
          <button onClick={() => setShown(true)}>more</button>
          {shown && <p id="z">needle zero</p>}
          {threeNeedles}
        </>
      );
    };
    render(
      <Page>
        <Growing />
      </Page>
    );
    search("needle");
    fireEvent.keyDown(input(), { key: "Enter", shiftKey: true });
    expect(highlighted("find-current")).toEqual(["c"]);

    fireEvent.click(screen.getByText("more"));

    await waitFor(() => expect(status().textContent).toBe("4 of 4"));
    expect(highlighted("find-current")).toEqual(["c"]);
  });

  it("sets the find target, and clears it and the highlights on close", () => {
    const { rerender } = render(<Page>{threeNeedles}</Page>);
    search("needle");
    expect(screen.getByTestId("find-target").textContent).toBe("needle");

    rerender(<Page open={false}>{threeNeedles}</Page>);

    expect(screen.getByTestId("find-target").textContent).toBe("");
    expect(highlights.size).toBe(0);
  });

  it("closes on Escape", () => {
    const onClose = vi.fn();
    render(<Page onClose={onClose}>{threeNeedles}</Page>);

    fireEvent.keyDown(input(), { key: "Escape" });

    expect(onClose).toHaveBeenCalledOnce();
  });

  it("intercepts Cmd+F with CapsLock (uppercase key) instead of native find", () => {
    render(<Page>{threeNeedles}</Page>);
    input().blur();

    const event = fireEvent.keyDown(document.body, { key: "F", metaKey: true });

    // preventDefault called → returns false; native browser find is blocked
    expect(event).toBe(false);
    expect(document.activeElement).toBe(input());
  });

  it("sends typing on the page to the end of the search box", () => {
    render(<Page>{threeNeedles}</Page>);
    fireEvent.change(input(), { target: { value: "nee" } });
    input().setSelectionRange(0, 0);
    input().blur();

    fireEvent.keyDown(document.body, { key: "d" });

    expect(document.activeElement).toBe(input());
    expect(input().selectionStart).toBe(3);
  });

  it("doesn't steal keystrokes from a focused select", () => {
    render(
      <Page>
        <select data-testid="dropdown">
          <option>alpha</option>
          <option>beta</option>
        </select>
      </Page>
    );
    const dropdown = screen.getByTestId("dropdown");
    dropdown.focus();

    fireEvent.keyDown(dropdown, { key: "b" });

    expect(document.activeElement).toBe(dropdown);
  });
});

describe("FindBand with a find source", () => {
  // A virtualized list of five items whose data reads "needle <i>", of which
  // only the items in `rendered` are in the DOM. A `phantom` item renders
  // without its text, as when the data holds text the row doesn't show.
  const List: FC<{
    initial: number[];
    phantom?: number;
    dataCount?: number;
    reveal: FindSource["reveal"];
  }> = ({ initial, phantom, dataCount = 1, reveal }) => {
    const [rendered, setRendered] = useState(initial);
    const { registerFindSource } = useExtendedFind();
    // eslint-disable-next-line tsmono/no-raw-use-effect -- test fixture registering a fake source
    useEffect(
      () =>
        registerFindSource("list", {
          anchor: () => document.getElementById("list"),
          countByItem: (term) =>
            [0, 1, 2, 3, 4]
              .filter((item) => `needle ${item}`.includes(term))
              .map((item) => ({ item, count: dataCount })),
          itemOf: (node) => {
            const row = node.parentElement?.closest("[data-item]");
            return row ? Number(row.getAttribute("data-item")) : null;
          },
          renderedItems: () => new Set(rendered),
          reveal: async (item, direction, signal) => {
            const shown = await reveal(item, direction, signal);
            if (shown) act(() => setRendered([item]));
            return shown;
          },
        }),
      [registerFindSource, rendered, reveal, dataCount]
    );
    return (
      <div id="list">
        {rendered.map((item) => (
          <p key={item} id={`item-${item}`} data-item={item}>
            {item === phantom ? "blank" : `needle ${item}`}
          </p>
        ))}
      </div>
    );
  };

  const currentId = () =>
    [...(highlights.get("find-current") ?? [])].map((range) =>
      range instanceof Range ? range.startContainer.parentElement?.id : null
    );

  it("counts unrendered items and brings one in to step onto it", async () => {
    const reveal = vi.fn(() => Promise.resolve(true));
    render(
      <Page>
        <p id="before">needle before</p>
        <List initial={[0, 1]} reveal={reveal} />
      </Page>
    );
    search("needle");
    expect(status().textContent).toBe("1 of 6");

    fireEvent.keyDown(input(), { key: "Enter" });
    fireEvent.keyDown(input(), { key: "Enter" });
    expect(status().textContent).toBe("3 of 6");
    expect(reveal).not.toHaveBeenCalled();

    fireEvent.keyDown(input(), { key: "Enter" });

    expect(reveal).toHaveBeenCalledWith(2, "forward", expect.any(AbortSignal));
    await waitFor(() => expect(currentId()).toEqual(["item-2"]));
    expect(status().textContent).toBe("4 of 6");
  });

  it("steps past an item that renders without its match", async () => {
    const reveal = vi.fn(() => Promise.resolve(true));
    render(
      <Page>
        <List initial={[0]} phantom={1} reveal={reveal} />
      </Page>
    );
    search("needle");
    expect(status().textContent).toBe("1 of 5");

    fireEvent.keyDown(input(), { key: "Enter" });

    await waitFor(() => expect(currentId()).toEqual(["item-2"]), {
      timeout: 3000,
    });
    expect(reveal.mock.calls.map((call) => call.slice(0, 2))).toEqual([
      [1, "forward"],
      [2, "forward"],
    ]);
    // Unrendered again, item 1 counts its data match again.
    expect(status().textContent).toBe("3 of 5");
  });

  it("skips an item at once when the list reports it never renders", async () => {
    const reveal = vi.fn((item: number) => Promise.resolve(item !== 1));
    render(
      <Page>
        <List initial={[0]} reveal={reveal} />
      </Page>
    );
    search("needle");

    fireEvent.keyDown(input(), { key: "Enter" });

    // Well inside the settle wait that a rendered item gets for its text.
    await waitFor(() => expect(currentId()).toEqual(["item-2"]), {
      timeout: 500,
    });
  });

  it("aborts a reveal that a newer step takes over", () => {
    const signals: AbortSignal[] = [];
    const reveal = vi.fn(
      (_item: number, _direction: FindDirection, signal: AbortSignal) => {
        signals.push(signal);
        return new Promise<boolean>(() => {});
      }
    );
    render(
      <Page>
        <List initial={[0]} reveal={reveal} />
      </Page>
    );
    search("needle");

    fireEvent.keyDown(input(), { key: "Enter" });
    expect(signals.map((signal) => signal.aborted)).toEqual([false]);
    fireEvent.keyDown(input(), { key: "Enter", shiftKey: true });

    expect(signals[0]?.aborted).toBe(true);
    expect(status().textContent).toBe("1 of 5");
  });

  it("steps past every match of an item that never renders", async () => {
    const reveal = vi.fn((item: number) => Promise.resolve(item !== 1));
    render(
      <Page>
        <List initial={[0]} dataCount={2} reveal={reveal} />
      </Page>
    );
    search("needle");
    expect(status().textContent).toBe("1 of 9");

    fireEvent.keyDown(input(), { key: "Enter" });

    await waitFor(() => expect(currentId()).toEqual(["item-2"]), {
      timeout: 3000,
    });
    expect(reveal.mock.calls.map((call) => call.slice(0, 2))).toEqual([
      [1, "forward"],
      [2, "forward"],
    ]);
  });
});
