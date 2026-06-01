import { createApplyTheme } from "@tsmono/inspect-common/theme/bootstrap";

import { readThemePreference } from "./readPreference";

// Standalone, theme follows the in-app picker (persisted by the userSettings
// store) or the OS color scheme; a host iframe (VS Code / hawk) can still
// force it via the query param. Unlike the old inline script this also toggles
// the `vscode-dark` body class, so standalone dark activates the
// `--vscode-* → --bs-*` bridge instead of half-applying.
const applyTheme = createApplyTheme({
  queryParamName: "inspectLogviewThemeCategory",
  readPreference: readThemePreference,
});

applyTheme();
