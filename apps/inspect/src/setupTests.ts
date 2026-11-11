import { TextDecoder, TextEncoder } from "util";

import "@testing-library/jest-dom/vitest";
// Setup fake IndexedDB for database tests
import "fake-indexeddb/auto";

import { installPopoverStub } from "@tsmono/react/testing";

global.TextDecoder = TextDecoder;
global.TextEncoder = TextEncoder;

installPopoverStub();

// Mock build-time constants (injected via vite `define` in production builds).
(global as Record<string, unknown>).__LOGGING_FILTER__ = "";
(global as Record<string, unknown>).__DEV_WATCH__ = false;
(global as Record<string, unknown>).__VIEW_SERVER_API_URL__ = "/api";
