import type { EvalSpec } from "../types";

type ModelRoleValue = NonNullable<EvalSpec["model_roles"]>[string];

const kModelNameSeparator = ", ";

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
    .join(kModelNameSeparator);

/**
 * The individual model names inside a `modelRoleModelNames` display string —
 * the inverse, for consumers that key by single model (e.g. matching a
 * role's alias against a connection lane).
 */
export const splitModelRoleNames = (names: string): string[] =>
  names.split(kModelNameSeparator);

/**
 * Role → display-name record for a spec's model roles, dropping roles with
 * no model name. Returns undefined when nothing remains, so callers can
 * treat "no roles" and "absent" uniformly.
 */
export const modelRoleNames = (
  modelRoles: EvalSpec["model_roles"]
): Record<string, string> | undefined => {
  if (!modelRoles) return undefined;
  const roles: Record<string, string> = {};
  for (const [role, value] of Object.entries(modelRoles)) {
    const names = modelRoleModelNames(value);
    if (names) roles[role] = names;
  }
  return Object.keys(roles).length > 0 ? roles : undefined;
};
