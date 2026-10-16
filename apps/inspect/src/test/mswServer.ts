import { setupServer, type SetupServer } from "msw/node";
import { afterAll, afterEach, beforeAll } from "vitest";

/**
 * An MSW server scoped to the calling test file: it intercepts fetch while
 * the file runs, fails any request no handler matches, and drops per-test
 * handlers after each test. Closing it in `afterAll` puts the real fetch
 * back, which non-isolated ("pure") test files rely on.
 */
export const setupMswServer = (): SetupServer => {
  const server = setupServer();
  beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
  afterEach(() => server.resetHandlers());
  afterAll(() => server.close());
  return server;
};
