import { isRecord } from "@tsmono/util";

// Without `Prism.manual` set before Prism evaluates, it highlights the whole
// document, untrusted content included. Reuse a host's Prism: replacing it
// breaks the language components that register on the cached core's global.
const existing: unknown = Reflect.get(globalThis, "Prism");
if (isRecord(existing)) {
  existing.manual = true;
} else {
  Reflect.set(globalThis, "Prism", { manual: true });
}

export {};
