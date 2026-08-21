import { EvalSpec } from "@tsmono/inspect-common/types";
import { modelRoleModelNames } from "@tsmono/inspect-common/utils";

import { kModelNone } from "../constants";

/**
 * Resolve the model display string for an EvalSpec.
 *
 * - If `model_roles` is populated, formats it as `role: model[; role: model]…`
 *   (`;` between roles, since a list-valued role already uses `,` between its
 *   models).
 * - Otherwise falls back to `eval.model`, ignoring the placeholder `none/none`.
 * - Returns `undefined` if neither source has anything meaningful.
 */
export const formatModelText = (evalSpec?: EvalSpec): string | undefined => {
  if (!evalSpec) return undefined;
  const roles = evalSpec.model_roles;
  if (roles && Object.keys(roles).length > 0) {
    return Object.entries(roles)
      .map(([role, data]) => `${role}: ${modelRoleModelNames(data)}`)
      .join("; ");
  }
  if (evalSpec.model && evalSpec.model !== kModelNone) {
    return evalSpec.model;
  }
  return undefined;
};
