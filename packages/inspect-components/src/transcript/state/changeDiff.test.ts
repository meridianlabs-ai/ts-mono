import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { JsonChange } from "@tsmono/inspect-common/types";

import { DiffEntry, diffFromChanges, resolveAfter } from "./changeDiff";

const add = (path: string, value: JsonChange["value"]): JsonChange => ({
  op: "add",
  path,
  value,
  replaced: null,
});

const replace = (
  path: string,
  replaced: JsonChange["value"],
  value: JsonChange["value"]
): JsonChange => ({ op: "replace", path, value, replaced });

const remove = (path: string, value: JsonChange["value"]): JsonChange => ({
  op: "remove",
  path,
  value,
  replaced: null,
});

// One line per rendered row: `path kind values`, container rows marked [] or {}.
const rows = (entry: DiffEntry | undefined, path = ""): string[] => {
  if (!entry) return [];
  switch (entry.kind) {
    case "node":
      return [
        ...(path ? [`${path} ${entry.isArray ? "[]" : "{}"}`] : []),
        ...entry.children.flatMap((c) => rows(c.entry, `${path}/${c.key}`)),
      ];
    case "added":
      return [`${path} + ${JSON.stringify(entry.value)}`];
    case "deleted":
      return [`${path} - ${JSON.stringify(entry.value)}`];
    case "modified":
      return [
        `${path} ${JSON.stringify(entry.left)} -> ${JSON.stringify(entry.right)}`,
      ];
  }
};

const diffRows = (changes: JsonChange[]) => rows(diffFromChanges(changes));

describe("diffFromChanges", () => {
  it("shows a nested add at its full path, not at the root", () => {
    expect(diffRows([add("/a/b", 1)])).toEqual(["/a {}", "/a/b + 1"]);
  });

  it("merges prefix-sharing nested adds into one subtree", () => {
    expect(diffRows([add("/a/b", 1), add("/a/c", 2)])).toEqual([
      "/a {}",
      "/a/b + 1",
      "/a/c + 2",
    ]);
  });

  it("renders numeric segments as an array node without padding", () => {
    const diff = diffFromChanges([add("/items/2", "x")]);
    expect(rows(diff)).toEqual(["/items []", '/items/2 + "x"']);
  });

  it("shows replaced and new values at the same nested path", () => {
    expect(diffRows([replace("/a/b", 1, 2)])).toEqual(["/a {}", "/a/b 1 -> 2"]);
  });

  it("keeps top-level changes at the root", () => {
    expect(diffRows([add("/a", 1)])).toEqual(["/a + 1"]);
  });

  it("shows only the removed key, not its whole parent", () => {
    expect(diffRows([remove("/messages/3", null)])).toEqual([
      "/messages []",
      "/messages/3 - null",
    ]);
  });

  it("shows nothing for a replace that didn't change the value", () => {
    expect(diffFromChanges([replace("/a", "x", "x")])).toBeUndefined();
  });

  // A Python dict with mixed numeric-string and non-numeric keys arrives as
  // sibling paths like /a/0 and /a/name; with a non-numeric sibling the node
  // is an object, whichever key comes first and whichever op wrote it.
  it.each([
    [[add("/a/0", "m"), add("/a/name", "y")]],
    [[add("/a/name", "y"), add("/a/0", "m")]],
    [[add("/a/0", "m"), remove("/a/name", "y")]],
  ])("renders a node with mixed keys as an object (%#)", (changes) => {
    const diff = diffFromChanges(changes);
    expect(rows(diff)[0]).toBe("/a {}");
    expect(rows(diff)).toHaveLength(3);
  });

  it("diffs replaced containers structurally, arrays by position", () => {
    expect(
      diffRows([
        replace(
          "/a",
          { keep: 1, old: 2, list: [1, 2, 3] },
          {
            keep: 1,
            new: 3,
            list: [1, 5],
          }
        ),
      ])
    ).toEqual([
      "/a {}",
      "/a/old - 2",
      "/a/list []",
      "/a/list/1 2 -> 5",
      "/a/list/2 - 3",
      "/a/new + 3",
    ]);
  });

  it("shows a move as a removal at `from` and an addition at `path`", () => {
    expect(
      diffRows([
        { op: "move", path: "/b", from: "/a", value: null, replaced: null },
      ])
    ).toEqual(["/a - null", "/b + null"]);
  });

  it("gives a key's own row and its subtree row distinct ids", () => {
    const ids = (entry: DiffEntry | undefined) =>
      entry?.kind === "node" ? entry.children.map((c) => c.id) : [];
    const diff = diffFromChanges([
      add("/x", 1),
      add("/x/y", 2),
      add("/x#own/y", 3),
      add("/=x", 4),
    ]);
    expect(new Set(ids(diff)).size).toBe(ids(diff).length);
  });

  // JSON-patch replays in order: a later write or remove at a path replaces
  // whatever earlier ops wrote beneath it.
  it("drops sub-path writes superseded by a later write to the parent", () => {
    expect(
      diffRows([add("/a/b", 1), replace("/a", { b: 1 }, { c: 2 })])
    ).toEqual(["/a {}", "/a/b - 1", "/a/c + 2"]);
    expect(diffRows([add("/a/b", 1), remove("/a", null)])).toEqual([
      "/a - null",
    ]);
  });

  it("unescapes JSON-pointer segments", () => {
    expect(diffRows([add("/a~1b/c~0d", 1)])).toEqual([
      "/a/b {}",
      "/a/b/c~d + 1",
    ]);
  });
});

// Numeric path segments come from the log. Nothing may allocate or iterate
// in proportion to the number a segment names.
describe("diffFromChanges huge indexes", () => {
  const kHugeIndex = 2_000_000_000;

  it.each<[string, JsonChange]>([
    ["add", add(`/x/${kHugeIndex}`, 1)],
    ["replace", replace(`/x/${kHugeIndex}`, 1, 2)],
    ["remove", remove(`/x/${kHugeIndex}`, 1)],
    ["middle segment", add(`/x/${kHugeIndex}/y`, 1)],
    [
      "move from",
      {
        op: "move",
        path: "/y",
        from: `/x/${kHugeIndex}`,
        value: 1,
        replaced: null,
      },
    ],
  ])("stays linear for a huge index in a %s", (_, change) => {
    const diff = diffFromChanges([change]);
    expect(JSON.stringify(diff).length).toBeLessThan(500);
    expect(rows(diff).join("\n")).toContain(`/x/${kHugeIndex}`);
  });

  it("orders index keys numerically without converting them", () => {
    const huge = "123456789012345678901234567890";
    expect(
      diffRows([add(`/a/${huge}`, 1), add("/a/10", 2), add("/a/9", 3)])
    ).toEqual(["/a []", "/a/9 + 3", "/a/10 + 2", `/a/${huge} + 1`]);
  });

  it("keeps a list grown by many appends as one array node", () => {
    const count = 12_000;
    const diff = diffFromChanges(
      Array.from({ length: count }, (_, i) => add(`/items/${i}`, i))
    );
    const items = diff?.kind === "node" ? diff.children[0]?.entry : undefined;
    expect(items?.kind === "node" && items.isArray).toBe(true);
    expect(items?.kind === "node" && items.children.length).toBe(count);
  });
});

// Paths come straight from the log. A `__proto__` segment must stay an
// ordinary key, never a step into Object.prototype: a write there would be
// read back by every plain object in the page.
describe("prototype safety", () => {
  // If the code under test regresses, remove whatever it planted so the
  // leak doesn't poison later tests in this worker.
  let prototypeKeys: Set<string>;
  beforeEach(() => {
    prototypeKeys = new Set(Object.getOwnPropertyNames(Object.prototype));
  });
  afterEach(() => {
    for (const key of Object.getOwnPropertyNames(Object.prototype)) {
      if (!prototypeKeys.has(key))
        Reflect.deleteProperty(Object.prototype, key);
    }
  });

  it("shows a __proto__ segment as a key instead of writing the prototype", () => {
    const changes = [
      add("/__proto__/planted_add", "x"),
      replace("/__proto__/planted_replace", "old", "new"),
      add("/constructor/prototype/planted_ctor", "x"),
    ];
    expect(diffRows(changes)).toEqual([
      "/__proto__ {}",
      '/__proto__/planted_add + "x"',
      '/__proto__/planted_replace "old" -> "new"',
      "/constructor {}",
      "/constructor/prototype {}",
      '/constructor/prototype/planted_ctor + "x"',
    ]);
    expect(resolveAfter(changes, "/__proto__")).toEqual({
      planted_add: "x",
      planted_replace: "new",
    });
    expect(JSON.stringify(resolveAfter(changes, ""))).toBe(
      '{"__proto__":{"planted_add":"x","planted_replace":"new"},"constructor":{"prototype":{"planted_ctor":"x"}}}'
    );
    for (const key of ["planted_add", "planted_replace", "planted_ctor"]) {
      expect(Object.hasOwn(Object.prototype, key)).toBe(false);
    }
  });

  it("diffs replaced values holding a __proto__ key without walking the prototype", () => {
    // fromEntries defines an own `__proto__` key, as JSON.parse would.
    const withProto = (a: number) => Object.fromEntries([["__proto__", { a }]]);
    expect(diffRows([replace("/x", withProto(1), withProto(2))])).toEqual([
      "/x {}",
      "/x/__proto__ {}",
      "/x/__proto__/a 1 -> 2",
    ]);
  });
});

describe("resolveAfter", () => {
  it("returns the value written at the path", () => {
    expect(resolveAfter([add("/tool_choice", "auto")], "/tool_choice")).toBe(
      "auto"
    );
  });

  it("assembles sub-path writes into an object", () => {
    expect(
      resolveAfter(
        [
          remove("/messages/0/source", "input"),
          replace("/messages/0/role", "user", "system"),
          replace("/messages/0/content", "hi", "be nice"),
          add("/messages/1", { role: "user", content: "hi" }),
        ],
        "/messages/0"
      )
    ).toEqual({ role: "system", content: "be nice" });
  });

  it("overlays sub-path writes onto a value written whole", () => {
    expect(
      resolveAfter([add("/logs", { a: "1" }), add("/logs/b", "2")], "/logs")
    ).toEqual({ a: "1", b: "2" });
  });

  it("reads through a write to a parent of the path", () => {
    expect(
      resolveAfter(
        [replace("/messages", [], [{ role: "system", content: "x" }])],
        "/messages/0/role"
      )
    ).toBe("system");
  });

  it("replays writes in order across parent and child paths", () => {
    const tools = [{ name: "b" }];
    expect(
      resolveAfter(
        [add("/tools/0/name", "a"), replace("/tools", [], tools)],
        "/tools"
      )
    ).toEqual(tools);
    expect(
      resolveAfter(
        [add("/logs", { a: "1", b: "2" }), remove("/logs/a", null)],
        "/logs"
      )
    ).toEqual({ b: "2" });
    expect(
      resolveAfter([add("/a", 1), remove("/a", null)], "/a")
    ).toBeUndefined();
    expect(resolveAfter([remove("/m/0/source", null)], "/m/0")).toBeUndefined();
  });

  it("is undefined for a path no change touches", () => {
    expect(resolveAfter([add("/a", 1)], "/b")).toBeUndefined();
  });

  it("does not match a sibling that only shares a string prefix", () => {
    expect(resolveAfter([add("/tools_extra", 1)], "/tools")).toBeUndefined();
  });
});
