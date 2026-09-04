import { afterEach, describe, expect, it } from "vitest";

import { apiScoutServer } from "../api/api-scout-server";

import { createStore } from "./store";

// Property groups are named by component ids, and transcript panels use the
// event uuid straight from the log. An id or property name that is an
// Object.prototype member must be an ordinary own entry, never a read of or
// write to the shared prototype.
describe("store properties prototype safety", () => {
  const prototypeKeys = new Set(Object.getOwnPropertyNames(Object.prototype));

  afterEach(() => {
    for (const key of Object.getOwnPropertyNames(Object.prototype)) {
      if (!prototypeKeys.has(key))
        Reflect.deleteProperty(Object.prototype, key);
    }
  });

  const actions = () => createStore(apiScoutServer()).getState();

  it.each(["__proto__", "constructor", "toString"])(
    "stores a value under id %s without touching Object.prototype",
    (id) => {
      const store = actions();

      store.setPropertyValue(id, "selectedNav", "planted-nav");

      expect(Object.hasOwn(Object.prototype, "selectedNav")).toBe(false);
      expect(store.getPropertyValue(id, "selectedNav")).toBe("planted-nav");
      expect(
        store.getPropertyValue("another-id", "selectedNav", "default")
      ).toBe("default");
    }
  );

  it("stores a __proto__ property inside a group as an own entry", () => {
    const store = actions();

    store.setPropertyValue("id", "__proto__", { planted_key: 1 });

    expect(Object.hasOwn(Object.prototype, "planted_key")).toBe(false);
    expect(store.getPropertyValue("id", "__proto__")).toEqual({
      planted_key: 1,
    });
  });

  it.each(["constructor", "toString", "hasOwnProperty", "__proto__"])(
    "reads an absent %s property as the default",
    (name) => {
      const store = actions();
      store.setPropertyValue("id", "other", 1);

      expect(store.getPropertyValue("id", name, "default")).toBe("default");
      expect(store.getPropertyValue(name, "other", "default")).toBe("default");
    }
  );

  it("removes properties and groups named after prototype members", () => {
    const store = actions();
    store.setPropertyValue("__proto__", "a", 1);
    store.setPropertyValue("__proto__", "b", 2);

    store.removePropertyValue("__proto__", "a");
    expect(store.getPropertyValue("__proto__", "a", "gone")).toBe("gone");
    expect(store.getPropertyValue("__proto__", "b")).toBe(2);

    store.removeByPrefix("__proto__", "b");
    expect(store.getPropertyValue("__proto__", "b", "gone")).toBe("gone");

    store.setPropertyValue("constructor", "a", 1);
    store.removeAllProperties("constructor");
    expect(store.getPropertyValue("constructor", "a", "gone")).toBe("gone");
    expect(Object.hasOwn(Object.prototype, "a")).toBe(false);
  });
});
