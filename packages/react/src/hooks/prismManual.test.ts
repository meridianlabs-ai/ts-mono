import { afterEach, describe, expect, it, vi } from "vitest";

const prismGlobal = (): unknown => Reflect.get(globalThis, "Prism");

describe("prismManual", () => {
  afterEach(() => {
    Reflect.deleteProperty(globalThis, "Prism");
    vi.resetModules();
  });

  it("sets manual mode before Prism loads", async () => {
    await import("./prismManual");
    expect(prismGlobal()).toEqual({ manual: true });
  });

  it("keeps a Prism global the host already loaded", async () => {
    const hostPrism = { languages: { markup: {} } };
    Reflect.set(globalThis, "Prism", hostPrism);

    await import("./prismManual");

    expect(prismGlobal()).toBe(hostPrism);
    expect(hostPrism).toEqual({ languages: { markup: {} }, manual: true });
  });
});
