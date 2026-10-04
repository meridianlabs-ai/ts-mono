import type { ViteUserConfig } from "vitest/config";

/**
 * Splits a package's tests into a non-isolated `pure` project and isolated
 * `mocked` and `dom` projects, classified from each file's source. See
 * index.js for the rationale.
 */
export declare const splitTestEnvironments: (
  config: ViteUserConfig,
  root: string
) => ViteUserConfig;
