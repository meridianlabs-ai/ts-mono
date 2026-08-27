import { splitModelRoleNames } from "@tsmono/inspect-common/utils";

/**
 * Roles whose alias resolves to `model` (the reverse role_aliases lookup).
 * An alias is a display string that names every model bound to the role
 * (comma-separated for list roles), so match by membership, not equality.
 */
export const rolesForModel = (
  role_aliases: Record<string, string> | undefined,
  model: string
): string[] =>
  Object.entries(role_aliases ?? {})
    .filter(([, aliased]) => splitModelRoleNames(aliased).includes(model))
    .map(([role]) => role);
