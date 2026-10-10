import { useCallback, useState } from "react";

interface ManualCollapse {
  scope: string | undefined;
  collapsed: boolean | null;
}

export const useManualTitleCollapse = (
  autoCollapsed: boolean,
  scope: string | undefined
) => {
  const [manual, setManual] = useState<ManualCollapse>({
    scope,
    collapsed: null,
  });
  if (manual.scope !== scope) {
    setManual({ scope, collapsed: null });
  }
  const collapsed =
    manual.scope === scope
      ? (manual.collapsed ?? autoCollapsed)
      : autoCollapsed;

  const setCollapsed = useCallback(
    (next: boolean) => setManual({ scope, collapsed: next }),
    [scope]
  );

  return { collapsed, setCollapsed };
};
