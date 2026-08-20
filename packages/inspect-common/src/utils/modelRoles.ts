import type { EvalSpec } from "../types";

type ModelRoleValue = NonNullable<EvalSpec["model_roles"]>[string];

/**
 * Normalize a model role binding to a list of model configs. A role may be
 * bound to a single model or to a list of models (e.g. an ensemble of
 * graders); this collapses both shapes for consumers that iterate.
 */
export const modelRoleConfigs = (value: ModelRoleValue) =>
  Array.isArray(value) ? value : [value];

/**
 * Display string for a model role binding: the model name, comma-separated
 * when the role is bound to a list of models (matching inspect_ai's
 * `LogOverview` rendering).
 */
export const modelRoleModelNames = (value: ModelRoleValue): string =>
  modelRoleConfigs(value)
    .map((config) => config.model)
    .join(", ");
