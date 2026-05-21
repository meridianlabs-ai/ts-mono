import { TextDecoder, TextEncoder } from "util";

import "@testing-library/jest-dom/vitest";
// Setup fake IndexedDB for database tests
import "fake-indexeddb/auto";

global.TextDecoder = TextDecoder as unknown as typeof globalThis.TextDecoder;
global.TextEncoder = TextEncoder;

// Mock build-time constants used by logger
(global as Record<string, unknown>).__LOGGING_FILTER__ = "";
(global as Record<string, unknown>).__DEV_WATCH__ = false;
// Mock build-time constants used by the view-server api. Slices import
// the api singleton at module load, which transitively requires this.
(global as Record<string, unknown>).__VIEW_SERVER_API_URL__ = "/api";
(global as Record<string, unknown>).__VIEWER_VERSION__ = "test";
(global as Record<string, unknown>).__VIEWER_COMMIT__ = "test";

// Polyfill structuredClone for Node.js versions that don't have it
if (typeof global.structuredClone === "undefined") {
  global.structuredClone = (obj) => {
    return JSON.parse(JSON.stringify(obj));
  };
}
