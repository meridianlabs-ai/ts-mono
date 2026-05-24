import { createApplyTheme } from "@tsmono/inspect-common/theme/bootstrap";

import { SETTINGS_STORAGE_KEY } from "./constants";

// Standalone, theme follows the in-app picker (persisted under
// SETTINGS_STORAGE_KEY) or the OS color scheme; a host iframe (VS Code /
// hawk) can still force it via the query param. Unlike the old inline
// script this also toggles the `vscode-dark` body class, so standalone
// dark activates the `--vscode-* → --bs-*` bridge instead of half-applying.
const applyTheme = createApplyTheme({
  queryParamName: "inspectLogviewThemeCategory",
  storageKey: SETTINGS_STORAGE_KEY,
});

applyTheme();
