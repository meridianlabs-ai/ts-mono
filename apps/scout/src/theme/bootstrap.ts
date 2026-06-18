import {
  createApplyTheme,
  readThemePreference,
} from "@tsmono/theme/apply-theme";

import { SETTINGS_STORAGE_KEY } from "./constants";

createApplyTheme({
  queryParamName: "inspectViewThemeCategory",
  readPreference: () => readThemePreference(localStorage, SETTINGS_STORAGE_KEY),
})();
