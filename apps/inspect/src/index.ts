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

// Embedder api injection — install a per-dir api factory before initializing
// the store and rendering <App/>; setLogRoot re-points the viewer at a
// different dir (rebuilding the api through the same factory).
export { setApiFactory, setLogRoot } from "./app_config";

// Embedder react-query provider — wrap chrome that calls the viewer's selection
// hooks outside <App/> so they resolve the viewer's react-query client.
// useViewerReady gates that chrome until app config resolves (the hooks throw
// before then).
export { InspectQueryClientProvider, useViewerReady } from "./embed";

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

export {
  InspectComponentProvider,
  type InspectComponentProviderProps,
} from "./componentProviders";
export { ChatView } from "@tsmono/inspect-components/chat";
export type {
  ChatViewDisplayOptions,
  ChatViewLabelOptions,
  ChatViewLinkingOptions,
  ChatViewProps,
  ChatViewToolOptions,
} from "@tsmono/inspect-components/chat";

export { normalizeEvents } from "@tsmono/inspect-common/normalize";
export type { ChatMessage, Event } from "@tsmono/inspect-common/types";
export {
  TranscriptLayout,
  TranscriptOutline,
  TranscriptViewNodes,
  treeifyEvents,
} from "@tsmono/inspect-components/transcript";
export type {
  EventNode,
  TranscriptLayoutProps,
  TranscriptViewNodesHandle,
  TranscriptViewNodesProps,
} from "@tsmono/inspect-components/transcript";
