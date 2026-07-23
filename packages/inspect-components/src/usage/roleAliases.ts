/** Roles whose alias resolves to `model` (the reverse role_aliases lookup). */
export const rolesForModel = (
  role_aliases: Record<string, string> | undefined,
  model: string
): string[] =>
  Object.entries(role_aliases ?? {})
    .filter(([, aliased]) => aliased === model)
    .map(([role]) => role);
