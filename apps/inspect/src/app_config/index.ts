// Public surface of the app-configuration subsystem (see
// design/migration/domain-ownership.md). Everything not exported here is
// subsystem-private; external modules must import from this barrel.
export type { AppConfig } from "./appConfig";
export {
  getAppConfig,
  getBootstrap,
  peekAppConfig,
  resolveAppConfig,
} from "./appConfig";
export {
  readEmbeddedStartupState,
  resolveEmbeddedLogDir,
} from "./singleFileMode";
export {
  APP_CONFIG_KEY,
  useApi,
  useAppConfig,
  useAppConfigAsync,
} from "./useAppConfig";
export { getLogDir, setLogRoot, useAbsLogDir, useLogDir } from "./useLogDir";
