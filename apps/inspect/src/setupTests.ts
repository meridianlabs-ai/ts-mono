import { TextDecoder, TextEncoder } from "util";

import "@testing-library/jest-dom/vitest";
// Setup fake IndexedDB for database tests
import "fake-indexeddb/auto";

global.TextDecoder = TextDecoder;
global.TextEncoder = TextEncoder;

// Mock build-time constants used by logger
(global as Record<string, unknown>).__LOGGING_FILTER__ = "";
(global as Record<string, unknown>).__DEV_WATCH__ = false;
