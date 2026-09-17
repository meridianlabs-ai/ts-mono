// Bootstrap icon class names used by the content components. Both apps use
// the same Bootstrap icons, so these are plain constants (see
// transcript/icons.ts for the event-view set).
export const ContentIcons = {
  model: "bi bi-grid-3x3-gap",
  search: "bi bi-search",
  tree: {
    open: "bi bi-caret-down-fill",
    closed: "bi bi-caret-right-fill",
  },
  checkbox: {
    checked: "bi bi-check-circle",
    unchecked: "bi bi-circle",
  },
  iconForMimeType: (mimeType: string): string => {
    if (mimeType === "application/pdf") return "bi bi-file-pdf";
    if (mimeType.startsWith("image/")) return "bi bi-file-image";
    return "bi bi-file-earmark";
  },
};
