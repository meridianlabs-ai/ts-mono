import { useCallback, useState } from "react";

interface ManualCollapse {
  scope: string | undefined;
  collapsed: boolean;
}

export const useManualTitleCollapse = (
  autoCollapsed: boolean,
  scope: string | undefined
) => {
  const [manual, setManual] = useState<ManualCollapse | null>(null);
  const collapsed =
    manual !== null && manual.scope === scope
      ? manual.collapsed
      : autoCollapsed;

  const setCollapsed = useCallback(
    (next: boolean) => setManual({ scope, collapsed: next }),
    [scope]
  );

  return { collapsed, setCollapsed };
};
