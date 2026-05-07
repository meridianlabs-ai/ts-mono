import clsx from "clsx";
import { Fragment, ReactNode, useState } from "react";

import { SegmentedControl } from "@tsmono/react/components";

import { ModelTokenTable } from "./ModelTokenTable";
import { ModelUsageData } from "./ModelUsagePanel";
import styles from "./UsagePanel.module.css";

export interface MetaItem {
  label: string;
  value: ReactNode;
}

interface UsagePanelProps {
  label?: string;
  model_usage?: Record<string, ModelUsageData>;
  role_usage?: Record<string, ModelUsageData>;
  configs_by_model?: Record<string, Record<string, unknown>>;
  configs_by_role?: Record<string, Record<string, unknown>>;
  args_by_model?: Record<string, Record<string, unknown>>;
  args_by_role?: Record<string, Record<string, unknown>>;
  role_aliases?: Record<string, string>;
  samples?: number;
  meta?: MetaItem[];
  className?: string | string[];
}

type Mode = "model" | "role";

export const UsagePanel: React.FC<UsagePanelProps> = ({
  label,
  model_usage,
  role_usage,
  configs_by_model,
  configs_by_role,
  args_by_model,
  args_by_role,
  role_aliases,
  samples,
  meta,
  className,
}) => {
  const hasModel = !!(model_usage && Object.keys(model_usage).length > 0);
  const hasRole = !!(role_usage && Object.keys(role_usage).length > 0);

  const [mode, setMode] = useState<Mode>(hasRole ? "role" : "model");

  if (!hasModel && !hasRole) return null;

  const showSegmented = hasModel && hasRole;
  const effectiveMode: Mode = showSegmented ? mode : hasRole ? "role" : "model";
  const isModel = effectiveMode === "model";
  const resolvedLabel = label ?? "Usage";

  const usageData = isModel ? model_usage! : role_usage!;
  const tableConfigs = isModel ? configs_by_model : configs_by_role;
  const tableArgs = isModel ? args_by_model : args_by_role;
  const tableAliases = !isModel ? role_aliases : undefined;

  const metaItems =
    meta?.filter((m) => m.value != null && m.value !== "") ?? [];

  return (
    <div className={clsx(styles.panel, className)}>
      <div className={styles.head}>
        <div className={styles.headLeft}>
          <div className={clsx("text-style-label", styles.title)}>
            {resolvedLabel}
          </div>
          {showSegmented && (
            <SegmentedControl
              segments={[
                { id: "role", label: "Roles" },
                { id: "model", label: "Models" },
              ]}
              selectedId={effectiveMode}
              onSegmentChange={(value) => setMode(value as Mode)}
            />
          )}
        </div>
        {metaItems.length > 0 && (
          <div className={styles.meta}>
            {metaItems.map((m, i) => (
              <Fragment key={m.label}>
                {i > 0 && <span className={styles.metaSep} />}
                <span className={styles.metaItem}>
                  <span className={styles.metaLabel}>{m.label}</span>
                  <span className={styles.metaValue}>{m.value}</span>
                </span>
              </Fragment>
            ))}
          </div>
        )}
      </div>
      <ModelTokenTable
        model_usage={usageData}
        model_configs={tableConfigs}
        model_args={tableArgs}
        model_aliases={tableAliases}
        samples={samples}
        className={styles.tableNoTop}
      />
    </div>
  );
};
