// Model constants
export const kModelNone = "none/none";

// Workspace tab constants
export const kLogViewSamplesTabId = "samples";
export const kLogViewJsonTabId = "json";
export const kLogViewInfoTabId = "info";
export const kLogViewModelsTabId = "models";
export const kLogViewTaskTabId = "task";
export const kLogViewTimelineTabId = "timeline";
export const kLogViewErrorTabId = "error";

export const kWorkspaceTabs = [
  kLogViewSamplesTabId,
  kLogViewJsonTabId,
  kLogViewInfoTabId,
  kLogViewModelsTabId,
  kLogViewTaskTabId,
  kLogViewTimelineTabId,
  kLogViewErrorTabId,
];

// Sample tab constants
export const kSampleMessagesTabId = `messages`;
export const kSampleTranscriptTabId = `transcript`;
export const kSampleTerminalsTabId = `terminals`;
export const kSampleScoringTabId = `scoring`;
export const kSampleActivityTabId = `activity`;
export const kSampleInfoTabId = `info`;
// Usage and Metadata were merged into Info; their ids stay routable so
// existing links open Info (see `sampleTabAlias`).
export const kSampleMetdataTabId = `metadata`;
export const kSampleUsageTabId = `usage`;
export const kSampleErrorTabId = `error`;
export const kSampleRetriesTabId = `retries`;
export const kSampleErrorRetriesTabId = `retry-errors`;
export const kSampleJsonTabId = `json`;
// Focus-mode page (single focused turn, entered from a transcript event).
// Like `print`, intentionally absent from kSampleTabIds — it's not a sample tab.
export const kSampleEventTabId = `event`;

/** Resolve a legacy sample tab id to the tab that now shows its content. */
export const sampleTabAlias = (tabId: string): string =>
  tabId === kSampleUsageTabId || tabId === kSampleMetdataTabId
    ? kSampleInfoTabId
    : tabId;

export const kSampleTabIds = [
  kSampleMessagesTabId,
  kSampleTranscriptTabId,
  kSampleTerminalsTabId,
  kSampleScoringTabId,
  kSampleActivityTabId,
  kSampleInfoTabId,
  kSampleUsageTabId,
  kSampleMetdataTabId,
  kSampleErrorTabId,
  kSampleRetriesTabId,
  kSampleErrorRetriesTabId,
  kSampleJsonTabId,
];

// Scoring constants
export const kScoreTypePassFail = "passfail";
export const kScoreTypeCategorical = "categorical";
export const kScoreTypeNumeric = "numeric";
export const kScoreTypeOther = "other";
export const kScoreTypeObject = "object";
export const kScoreTypeBoolean = "boolean";
export const kScoreTypeList = "list";
