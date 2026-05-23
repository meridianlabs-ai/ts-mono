import { baseApplicationIcons } from "@tsmono/react/icons";

export const ApplicationIcons = {
  ...baseApplicationIcons,
  // overrides
  fork: "bi bi-signpost-split",
  pendingTask: "bi bi-clock",
  // inspect-specific
  columns: "bi bi-layout-three-columns",
  downloadLog: "bi bi-download",
  flow: "ii inspect-flow",
  "list-wrap": "bi bi-text-wrap",
  "compact-scores": "bi bi-arrows-collapse-vertical",
  "color-scales": "bi bi-palette",
  loading: "bi bi-arrow-clockwise",
  scoringSidebar: "bi bi-radar",
  toggle: {
    // combination of toggle-on and toggle2-off looked best for our default button font size
    on: "bi bi-toggle-on",
    off: "bi bi-toggle2-off",
  },
};
