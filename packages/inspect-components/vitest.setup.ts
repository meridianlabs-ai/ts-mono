import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Unmount everything Testing Library rendered after every test. With a shared
// jsdom (isolate: false) a mount leaked by one file — render() or renderHook()
// without cleanup — stays live for every later file in the worker, where its
// window-capture key listeners swallow events from the tests actually running
// (auto-cleanup is off because tests import vitest APIs instead of globals).
afterEach(() => {
  cleanup();
});
