import { EvalSpec } from "@tsmono/inspect-common/types";
import { modelRoleModelNames } from "@tsmono/inspect-common/utils";

import { kModelNone } from "../constants";

/**
 * Format the primary model first, then the named roles.
 *
 * Separate entries with `;` since list-valued roles already use `,`.
 * Omits the `none/none` placeholder and returns `undefined` if both are empty.
 */
export const formatModelText = (evalSpec?: EvalSpec): string | undefined => {
  const { model, roles } = modelDisplayParts(evalSpec);
  return [model, roles].filter(Boolean).join("; ") || undefined;
};

/** Format the primary model followed by parenthesized roles for a title. */
export const formatModelTitle = (evalSpec?: EvalSpec): string | undefined => {
  const { model, roles } = modelDisplayParts(evalSpec);
  return (
    [model, roles ? `(${roles})` : undefined].filter(Boolean).join(" ") ||
    undefined
  );
};

const modelDisplayParts = (evalSpec?: EvalSpec) => {
  const model = evalSpec?.model;
  const roles = Object.entries(evalSpec?.model_roles ?? {})
    .map(([role, data]) => `${role}: ${modelRoleModelNames(data)}`)
    .join("; ");
  return {
    model: model && model !== kModelNone ? model : undefined,
    roles: roles || undefined,
  };
};
