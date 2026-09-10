/**
 * Public entry point for embedding the Inspect log viewer into an external application: the full
 * `<App />` surface and props-pure transcript components for consumers that own their own chrome.
 *
 * Disclaimer: semantic versioning is NOT used. This surface evolves with the host
 * application's needs. Consumers pinning to a revision must expect breaking changes
 * at any time and adapt accordingly.
 */

// Main React App Component
export { App } from "./app/App";

// Client APIs
export { clientApi } from "./client/api/client-api";
export { default as simpleHttpApi } from "./client/api/static-http/api-static-http.ts";
export { viewServerApi as createViewServerApi } from "./client/api/view-server/api-view-server.ts";
export { openRemoteLogFile } from "./client/remote/remoteLogFile";
export type { RemoteLogFile } from "./client/remote/remoteLogFile";
export {
  createSampleStreamSession,
  resolveSample,
  useEvalSampleData,
  useSampleMessages,
  useSampleSummaries,
} from "./log_data";
export type {
  EvalSampleData,
  MessageRowsFeed,
  SampleStreamSession,
  SampleStreamTick,
} from "./log_data";

// Embedder api injection — install a per-dir api factory before initializing
// the store and rendering <App/>; setLogRoot re-points the viewer at a
// different dir (rebuilding the api through the same factory).
export { setApiFactory, setLogRoot } from "./app_config";

// Embedder providers: QueryClient alone for chrome beside <App/>;
// InspectDataProvider for hook consumers that do not mount <App/> and therefore
// need resolved config plus the fetch-engine controller.
export {
  InspectDataProvider,
  InspectQueryClientProvider,
  useViewerReady,
} from "./embed";

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
  EvalLog,
  EvalSample,
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
export type { SampleHandle } from "./app/types";

// Scroll-direction hook — used by embedders to drive their own chrome
// collapse with the same hysteresis behaviour the viewer uses internally.
export {
  useScrollDirection,
  type UseScrollDirectionOptions,
  type UseScrollDirectionResult,
} from "@tsmono/react/hooks";

export {
  InspectComponentProvider,
  type InspectComponentProviderProps,
} from "./componentProviders";
export {
  ChatView,
  ChatViewRowsVirtualList,
} from "@tsmono/inspect-components/chat";
export type {
  ChatViewDisplayOptions,
  ChatViewLabelOptions,
  ChatViewLinkingOptions,
  ChatViewProps,
  ChatViewRowsVirtualListProps,
  ChatViewToolOptions,
  MessageRow,
  MessageRowOptions,
} from "@tsmono/inspect-components/chat";

export { normalizeEvents } from "@tsmono/inspect-common/normalize";
export type {
  ChatMessage,
  Event,
  Timeline,
} from "@tsmono/inspect-common/types";
export { TranscriptLayout } from "@tsmono/inspect-components/transcript";
export type { TranscriptLayoutProps } from "@tsmono/inspect-components/transcript";
