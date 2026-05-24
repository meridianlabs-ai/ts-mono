import { createApplyTheme } from "@tsmono/inspect-common/theme/bootstrap";

import { SETTINGS_STORAGE_KEY } from "../state/userSettings";

createApplyTheme({
  queryParamName: "inspectViewThemeCategory",
  storageKey: SETTINGS_STORAGE_KEY,
})();
