import { isRecord } from "@tsmono/util";

// Prism highlights the whole document when it loads unless `Prism.manual` is
// set before it evaluates. Set it so Prism only runs where the viewer calls it
// (usePrismHighlight, for trusted content). A host that already loaded Prism
// keeps its instance: replacing it would strand the cached core and break the
// language components that register on the global.
const existing: unknown = Reflect.get(globalThis, "Prism");
if (isRecord(existing)) {
  existing.manual = true;
} else {
  Reflect.set(globalThis, "Prism", { manual: true });
}

export {};
