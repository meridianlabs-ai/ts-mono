import { TextDecoder, TextEncoder } from "util";

import "@testing-library/jest-dom";
// Setup fake IndexedDB for database tests
import "fake-indexeddb/auto";

global.TextDecoder = TextDecoder as typeof globalThis.TextDecoder;
global.TextEncoder = TextEncoder as typeof globalThis.TextEncoder;

// Mock build-time constants used by logger
declare global {
  var __LOGGING_FILTER__: string;
  var __DEV_WATCH__: boolean;
}
global.__LOGGING_FILTER__ = "";
global.__DEV_WATCH__ = false;
