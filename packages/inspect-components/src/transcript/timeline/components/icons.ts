// Bootstrap icon class names used by the timeline components. Both apps use
// the same Bootstrap icons, so these are plain constants (see
// transcript/icons.ts for the event-view set).
export const TimelineIcons = {
  error: "bi bi-exclamation-circle-fill",
  compaction: "bi bi-arrows-collapse-vertical",
  fork: "bi bi-sign-intersection-y-fill",
  agent: "bi bi-grid",
  threeDots: "bi bi-three-dots",
  expand: { down: "bi bi-chevron-down" },
  collapse: { up: "bi bi-chevron-up" },
  chevron: {
    down: "bi bi-chevron-down",
    left: "bi bi-chevron-left",
    right: "bi bi-chevron-right",
  },
  solvers: { default: "bi bi-arrow-return-right" },
  punchDown: "bi bi-arrows-angle-expand",
};
