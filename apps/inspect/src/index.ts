// Main React App Component
export { App, type AppProps } from "./app/App";

// Client APIs
export { clientApi } from "./client/api/client-api";
export { default as simpleHttpApi } from "./client/api/static-http/api-static-http.ts";
export { viewServerApi as createViewServerApi } from "./client/api/view-server/api-view-server.ts";

// Client API - Types
export type {
  Capabilities,
  ClientAPI,
  LogViewAPI,
  LogRoot,
  LogContents,
  LogPreview,
  PendingSampleResponse,
  SampleDataResponse,
} from "./client/api/types";

// Log types
export type {
  EvalSet,
  LogHandle,
  LogFilesResponse,
} from "@tsmono/inspect-common/types";

// State Store
export { initializeStore } from "./state/store";

// Selection hooks
export {
  useSelectedSampleSummary,
  useSelectedScores,
  useLogSelection,
} from "./state/hooks";

// Selection-related types
export type { SampleSummary } from "./client/api/types";
export type { ScoreLabel } from "./app/types";

// Scroll-direction hook — used by embedders to drive their own chrome
// collapse with the same hysteresis behaviour the viewer uses internally.
export {
  useScrollDirection,
  type UseScrollDirectionOptions,
  type UseScrollDirectionResult,
} from "@tsmono/react/hooks";
