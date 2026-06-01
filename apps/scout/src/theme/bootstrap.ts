import { createApplyTheme, readThemePreference } from "@tsmono/theme/bootstrap";

import { SETTINGS_STORAGE_KEY } from "./constants";

createApplyTheme({
  queryParamName: "inspectViewThemeCategory",
  readPreference: () => readThemePreference(localStorage, SETTINGS_STORAGE_KEY),
})();
