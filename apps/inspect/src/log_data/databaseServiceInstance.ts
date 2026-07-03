import { createDatabaseService, DatabaseService } from "../client/database";

let instance: DatabaseService | null = null;

/**
 * Install the shared DatabaseService singleton. Called once from
 * initializeStore. The instance is injectable so tests can supply a fake
 * without reaching in to mock the accessor; production omits the arg and gets
 * a real service.
 */
export function initDatabaseService(
  svc: DatabaseService = createDatabaseService()
): DatabaseService {
  instance = svc;
  return instance;
}

/**
 * The shared DatabaseService, or null before initializeStore has run. Readers
 * already null-check (the service may be unavailable), so the nullable return
 * matches existing call sites.
 */
export function getDatabaseService(): DatabaseService | null {
  return instance;
}
