// Public surface of the app-configuration subsystem (see
// design/migration/domain-ownership.md). Everything not exported here is
// subsystem-private; external modules must import from this barrel.
export type { AppConfig } from "./appConfig";
export { getAppConfig, getLogDir, setLogRoot } from "./appConfig";
export {
  readEmbeddedStartupState, // TODO: This should be private/encapsulated
  resolveEmbeddedLogDir, // TODO: This should be private/encapsulated
} from "./singleFileMode";
export {
  APP_CONFIG_KEY, // TODO: Exported for tests?! review
  getApi,
  useAppConfig,
  useAbsLogDir,
  useLogDir,
} from "./hooks";
