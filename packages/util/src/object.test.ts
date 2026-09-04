import { describe, expect, it } from "vitest";

import { getOwn, nullProtoRecord } from "./object";

const prototypeNames = [
  "__proto__",
  "constructor",
  "toString",
  "valueOf",
  "hasOwnProperty",
  "isPrototypeOf",
  "__defineGetter__",
];

describe("getOwn", () => {
  it("returns own values and undefined for absent keys", () => {
    expect(getOwn({ a: 1 }, "a")).toBe(1);
    expect(getOwn({ a: 1 }, "b")).toBeUndefined();
    expect(getOwn(undefined, "a")).toBeUndefined();
  });

  it.each(prototypeNames)(
    "does not resolve %s through the prototype chain",
    (name) => {
      expect(getOwn<unknown>({ a: 1 }, name)).toBeUndefined();
    }
  );

  it("returns an own value stored under a prototype member name", () => {
    expect(
      getOwn({ constructor: "mine", ["__proto__"]: "also mine" }, "constructor")
    ).toBe("mine");
    expect(getOwn({ ["__proto__"]: "also mine" }, "__proto__")).toBe(
      "also mine"
    );
  });

  it("ignores keys planted on Object.prototype", () => {
    Object.defineProperty(Object.prototype, "planted_getOwn", {
      value: "polluted",
      configurable: true,
      writable: true,
    });
    try {
      expect(getOwn<unknown>({}, "planted_getOwn")).toBeUndefined();
    } finally {
      Reflect.deleteProperty(Object.prototype, "planted_getOwn");
    }
    expect(Object.hasOwn(Object.prototype, "planted_getOwn")).toBe(false);
  });
});

describe("nullProtoRecord", () => {
  it("keeps every entry as an own property, including __proto__", () => {
    const record = nullProtoRecord(
      new Map<string, number>([
        ["a", 1],
        ["__proto__", 2],
        ["constructor", 3],
      ])
    );
    expect(Object.getPrototypeOf(record)).toBeNull();
    expect(Object.entries(record)).toEqual([
      ["a", 1],
      ["__proto__", 2],
      ["constructor", 3],
    ]);
    expect(Object.hasOwn(Object.prototype, "a")).toBe(false);
  });

  it.each(prototypeNames)("reads absent %s as undefined", (name) => {
    const record = nullProtoRecord(new Map<string, number>([["a", 1]]));
    expect(record[name]).toBeUndefined();
  });
});
