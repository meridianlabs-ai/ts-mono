import { afterEach, describe, expect, it } from "vitest";

import { testStoreState } from "./testStore";

// Property bags are named by component ids, and transcript panels use the
// event uuid straight from the log. A bag name or key that is an
// Object.prototype member must be an ordinary own entry, never a read of or
// write to the shared prototype.
describe("appSlice property bags prototype safety", () => {
  const prototypeKeys = new Set(Object.getOwnPropertyNames(Object.prototype));

  afterEach(() => {
    for (const key of Object.getOwnPropertyNames(Object.prototype)) {
      if (!prototypeKeys.has(key))
        Reflect.deleteProperty(Object.prototype, key);
    }
  });

  it.each(["__proto__", "constructor", "toString"])(
    "stores a value under bag %s without touching Object.prototype",
    (bagName) => {
      const { appActions } = testStoreState();

      appActions.setPropertyValue(bagName, "selectedNav", "planted-nav");

      expect(Object.hasOwn(Object.prototype, "selectedNav")).toBe(false);
      expect(appActions.getPropertyValue(bagName, "selectedNav")).toBe(
        "planted-nav"
      );
      expect(
        appActions.getPropertyValue("another-bag", "selectedNav", "default")
      ).toBe("default");
    }
  );

  it("stores a __proto__ key inside a bag as an own entry", () => {
    const { appActions } = testStoreState();

    appActions.setPropertyValue("bag", "__proto__", { planted_key: 1 });

    expect(Object.hasOwn(Object.prototype, "planted_key")).toBe(false);
    expect(appActions.getPropertyValue("bag", "__proto__")).toEqual({
      planted_key: 1,
    });
  });

  it.each(["constructor", "toString", "hasOwnProperty", "__proto__"])(
    "reads an absent %s key as the default",
    (key) => {
      const { appActions } = testStoreState();
      appActions.setPropertyValue("bag", "other", 1);

      expect(appActions.getPropertyValue("bag", key, "default")).toBe(
        "default"
      );
      expect(appActions.getPropertyValue(key, "other", "default")).toBe(
        "default"
      );
    }
  );

  it("ignores keys planted on Object.prototype", () => {
    const { appActions } = testStoreState();
    appActions.setPropertyValue("bag", "other", 1);
    Object.defineProperty(Object.prototype, "planted_read", {
      value: "polluted",
      configurable: true,
      writable: true,
    });

    expect(appActions.getPropertyValue("bag", "planted_read", "default")).toBe(
      "default"
    );
    expect(appActions.getPropertyValue("missing", "x", "default")).toBe(
      "default"
    );
  });

  it("removes values and bags named after prototype members", () => {
    const { appActions } = testStoreState();
    appActions.setPropertyValue("__proto__", "a", 1);
    appActions.setPropertyValue("__proto__", "b", 2);

    appActions.removePropertyValue("__proto__", "a");
    expect(appActions.getPropertyValue("__proto__", "a", "gone")).toBe("gone");
    expect(appActions.getPropertyValue("__proto__", "b")).toBe(2);

    appActions.removeByPrefix("__proto__", "b");
    expect(appActions.getPropertyValue("__proto__", "b", "gone")).toBe("gone");

    appActions.setPropertyValue("constructor", "a", 1);
    appActions.removeAllProperties("constructor");
    expect(appActions.getPropertyValue("constructor", "a", "gone")).toBe(
      "gone"
    );
    expect(Object.hasOwn(Object.prototype, "a")).toBe(false);
    expect(Object.hasOwn(Object.prototype, "b")).toBe(false);
  });
});
