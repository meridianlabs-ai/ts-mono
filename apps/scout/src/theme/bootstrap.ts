import { createApplyTheme } from "@tsmono/inspect-common/theme/bootstrap";

import { readThemePreference } from "./readPreference";

createApplyTheme({
  queryParamName: "inspectViewThemeCategory",
  readPreference: readThemePreference,
})();
