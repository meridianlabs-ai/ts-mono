// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";

import { findTextMatches } from "./findMatches";

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
