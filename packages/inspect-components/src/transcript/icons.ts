/**
 * Bootstrap icon class names used by transcript event components.
 * Both apps (scout and inspect) use the same Bootstrap icons,
 * so these are safe to hardcode as string constants.
 */
// Looked up by an unvalidated level string off a logger event, so the record
// is indexed by string rather than by its own keys.
const loggingIcons: Record<string, string> = {
  notset: "bi bi-card-text",
  debug: "bi bi-bug",
  http: "bi bi-download",
  info: "bi bi-info-square",
  warning: "bi bi-exclamation-triangle",
  error: "bi bi-x-circle",
  critical: "bi bi-fire",
};

export const TranscriptIcons = {
  agent: "bi bi-grid",
  approve: "bi bi-shield",
  cancel: "bi bi-x-circle",
  checkpoint: "bi bi-bookmark-check-fill",
  approvals: {
    approve: "bi bi-shield-check",
    reject: "bi bi-shield-x",
    terminate: "bi bi-shield-exclamation",
    escalate: "bi bi-box-arrow-up",
    modify: "bi bi-pencil-square",
  },
  arrows: {
    right: "bi bi-arrow-right",
  },
  expand: "bi bi-chevron-up",
  compaction: "bi bi-arrows-collapse-vertical",
  edit: "bi bi-pencil-square",
  error: "bi bi-exclamation-circle-fill",
  fork: "bi bi-sign-intersection-y-fill",
  info: "bi bi-info-circle",
  input: "bi bi-terminal",
  interrupt: "bi bi-slash-circle",
  limits: {
    messages: "bi bi-chat-right-text",
    custom: "bi bi-exclamation-triangle",
    operator: "bi bi-person-workspace",
    tokens: "bi bi-list",
    turns: "bi bi-arrow-repeat",
    time: "bi bi-clock",
    execution: "bi bi-stopwatch",
    cost: "bi bi-currency-dollar",
  },
  logging: loggingIcons,
  model: "bi bi-grid-3x3-gap",
  sample: "bi bi-database",
  sandbox: "bi bi-box-seam",
  scorer: "bi bi-calculator",
  solvers: {
    use_tools: "bi bi-tools",
  },
} as const;
