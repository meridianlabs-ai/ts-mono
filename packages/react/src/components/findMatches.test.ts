// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";

import { countMatchesByItem } from "../virtual/VirtualList";

import { findTextMatches } from "./findMatches";
import { normalizeFindText } from "./findText";

const mount = (html: string): HTMLElement => {
  const root = document.createElement("div");
  root.innerHTML = html;
  document.body.appendChild(root);
  return root;
};

const texts = (root: Element, term: string) =>
  findTextMatches(root, term).map((range) => range.toString());

afterEach(() => {
  document.body.innerHTML = "";
});

describe("findTextMatches", () => {
  it("matches case-insensitively, in document order", () => {
    const root = mount("<p>Needle one</p><p>two NEEDLE and needle</p>");
    expect(texts(root, "needle")).toEqual(["Needle", "NEEDLE", "needle"]);
  });

  it("matches across inline elements within one block", () => {
    const root = mount(
      '<pre><span class="token">foo</span>.<span>bar</span></pre><p><b>bold</b> text</p>'
    );
    expect(texts(root, "foo.bar")).toEqual(["foo.bar"]);
    expect(texts(root, "bold text")).toEqual(["bold text"]);
  });

  it("does not match across blocks or line breaks", () => {
    const root = mount(
      "<div>foo</div><div>bar</div><p>baz<br>qux</p><div>a<div>b</div>c</div>"
    );
    expect(texts(root, "foobar")).toEqual([]);
    expect(texts(root, "bazqux")).toEqual([]);
    expect(texts(root, "bc")).toEqual([]);
  });

  it("does not match across inline-block boxes", () => {
    const root = mount(
      '<p><span style="display: inline-block">user</span><span style="display: inline-block">name</span></p>'
    );
    expect(texts(root, "username")).toEqual([]);
  });

  it("reads a run of whitespace as one space, preformatted or not", () => {
    const root = mount(
      "<p>hello  world</p><p>line one\nline two</p><pre>a  b\nc</pre>"
    );
    expect(findTextMatches(root, "one line")).toHaveLength(1);
    expect(texts(root, "a b c")).toEqual(["a  b\nc"]);
    expect(texts(root, "hello world")).toEqual(["hello  world"]);
  });

  it("does not match across a blank line", () => {
    const root = mount("<pre>one\n\ntwo\n \t\nthree</pre>");
    expect(texts(root, "one two")).toEqual([]);
    expect(texts(root, "two three")).toEqual([]);
    expect(texts(root, "three")).toEqual(["three"]);
  });

  it("treats a term with regex syntax literally", () => {
    const root = mount("<p>a.b a*b (x)</p>");
    expect(texts(root, "a.b")).toEqual(["a.b"]);
    expect(texts(root, "(x)")).toEqual(["(x)"]);
    expect(texts(root, "a+b")).toEqual([]);
  });

  it("skips text a reader can't find", () => {
    const root = mount(
      [
        "<p>needle</p>",
        "<p data-unsearchable>needle</p>",
        '<p style="user-select: none">needle</p>',
        // Safari computes only the prefixed property.
        '<p style="-webkit-user-select: none">needle</p>',
        '<p style="display: none">needle</p>',
        '<p style="visibility: hidden">needle</p>',
        "<script>needle</script>",
        "<style>.needle {}</style>",
        "<textarea>needle</textarea>",
      ].join("")
    );
    expect(findTextMatches(root, "needle")).toHaveLength(1);
  });

  it("returns ranges on the matched text", () => {
    const root = mount("<p>xx<i>ab</i>cd</p>");
    const [range] = findTextMatches(root, "bc");
    expect(range?.startContainer.textContent).toBe("ab");
    expect(range?.startOffset).toBe(1);
    expect(range?.endContainer.textContent).toBe("cd");
    expect(range?.endOffset).toBe(1);
  });

  it("returns nothing for an empty term", () => {
    expect(findTextMatches(mount("<p>abc</p>"), "")).toEqual([]);
  });
});

describe("findTextMatches and the data-side count", () => {
  const dataCount = (text: string, term: string) =>
    countMatchesByItem([[normalizeFindText(text)]], term)[0]?.count ?? 0;

  const domCount = (tag: "p" | "pre", text: string, term: string) => {
    const block = document.createElement(tag);
    block.textContent = text;
    return findTextMatches(mount(block.outerHTML), term).length;
  };

  it.each([
    // Case folding where toLowerCase and a case-insensitive RegExp differ.
    ["İstanbul", "istanbul", 1],
    ["ıi", "I", 2],
    ["ΟΔΟΣ", "σ", 1],
    ["ΟΔΟΣ", "ς", 1],
    ["ſtate", "S", 1],
    ["STRASSE und Straße", "straße", 1],
    // Whitespace runs and line breaks read as one space.
    ["hello   world", "hello world", 1],
    ["hello world", "hello   world", 1],
    ["line one\nline two", "one line", 1],
    ["tab\tseparated", "tab separated", 1],
    ["stale.\n\nThis turn", "stale. this", 0],
    ["stale.\r\n\r\nThis turn", "this turn", 1],
    // Quotes and backslashes, as typed or JSON-escaped.
    ['say "foo" and foo', '"foo"', 2],
    [JSON.stringify({ cmd: 'print("hi")' }), 'print("hi")', 1],
    [JSON.stringify({ path: String.raw`C:\temp` }), String.raw`C:\temp`, 1],
    [String.raw`C:\temp`, String.raw`C:\temp`, 1],
  ])("counts %j for %j the same in data and DOM", (text, term, expected) => {
    expect(dataCount(text, term)).toBe(expected);
    expect(domCount("p", text, term)).toBe(expected);
    expect(domCount("pre", text, term)).toBe(expected);
  });
});
