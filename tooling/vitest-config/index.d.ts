import type { ViteUserConfig } from "vitest/config";

/**
 * Splits a package's tests into a non-isolated `pure` project and an isolated
 * `dom` project based on each file's `@vitest-environment` directive. See
 * index.js for the rationale.
 */
export declare const splitTestEnvironments: (
  config: ViteUserConfig,
  root: string
) => ViteUserConfig;
