import clsx from "clsx";
import { Fragment, MouseEvent, ReactNode, useMemo, useState } from "react";

import type {
  ConfigUpdate,
  ConnectionLimitChange,
} from "@tsmono/inspect-common/types";
import { SegmentedControl } from "@tsmono/react/components";
import { useProperty } from "@tsmono/react/hooks";

import {
  adaptiveMaxFromConfig,
  buildConnectionLanes,
  connectionWindow,
  poolRetunes,
  type ConnectionLaneData,
} from "./connectionHistory";
import { ConnectionLogModal } from "./ConnectionLogModal";
import { ConnectionsLegend, ConnectionsView } from "./ConnectionsView";
import { ModelTokenTable } from "./ModelTokenTable";
import { ModelUsageData } from "./ModelUsagePanel";
import { rolesForModel } from "./roleAliases";
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
  connection_limit_history?: ConnectionLimitChange[];
  started_at?: string | null;
  completed_at?: string | null;
  /** Mid-run config changes — pool retunes render on lanes and in the log. */
  config_updates?: ConfigUpdate[] | null;
  /** The eval's main model — generate-config pool retunes apply to it. */
  main_model?: string;
  /** Deep-link to the Timeline tab with the model's band toggled on. */
  onViewTimeline?: (
    model: string,
    event: MouseEvent<HTMLButtonElement>
  ) => void;
}

type Mode = "model" | "role" | "connections";

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
  connection_limit_history,
  started_at,
  completed_at,
  config_updates,
  main_model,
  onViewTimeline,
}) => {
  const keysOf = (
    ...maps: (Record<string, unknown> | undefined)[]
  ): string[] => {
    const out = new Set<string>();
    for (const m of maps) if (m) for (const k of Object.keys(m)) out.add(k);
    return Array.from(out);
  };

  // Memoized so mode-toggle / modal renders don't rebuild the lanes and the
  // stable identities keep ConnectionLogModal's useMemo effective.
  const usageWindow = useMemo(
    () => connectionWindow(connection_limit_history, started_at, completed_at),
    [connection_limit_history, started_at, completed_at]
  );
  const lanesByModel = useMemo(
    () =>
      buildConnectionLanes(connection_limit_history, usageWindow, (model) =>
        adaptiveMaxFromConfig(configs_by_model?.[model])
      ),
    [connection_limit_history, usageWindow, configs_by_model]
  );
  const retunesByModel = useMemo(
    () => poolRetunes(config_updates, main_model),
    [config_updates, main_model]
  );

  const modelKeys = keysOf(model_usage, configs_by_model, args_by_model);
  const roleKeys = keysOf(
    role_usage,
    configs_by_role,
    args_by_role,
    role_aliases
  );
  const hasModel = modelKeys.length > 0;
  const hasRole = roleKeys.length > 0;
  const hasRoleUsage = !!(role_usage && Object.keys(role_usage).length > 0);
  // The Connections lens appears only when connection history exists.
  const hasConnections = !!usageWindow && Object.keys(lanesByModel).length > 0;

  const [mode, setMode] = useState<Mode>(hasRoleUsage ? "role" : "model");
  const [logModel, setLogModel] = useProperty<string | null>(
    "usage-connections",
    "log-model",
    { defaultValue: null }
  );

  if (!hasModel && !hasRole && !hasConnections) return null;

  const segments = [
    ...(hasRole ? [{ id: "role", label: "Roles" }] : []),
    ...(hasModel ? [{ id: "model", label: "Models" }] : []),
    ...(hasConnections ? [{ id: "connections", label: "Connections" }] : []),
  ];
  const showSegmented = segments.length > 1;
  const effectiveMode: Mode = segments.some((s) => s.id === mode)
    ? mode
    : hasRole
      ? "role"
      : hasModel
        ? "model"
        : "connections";
  const isModel = effectiveMode === "model";
  const isConnections = effectiveMode === "connections";
  const resolvedLabel = label ?? "Usage";

  const usageData = isModel ? model_usage : role_usage;
  const hasUsageData =
    !isConnections && !!(usageData && Object.keys(usageData).length > 0);
  const tableConfigs = isModel ? configs_by_model : configs_by_role;
  const tableArgs = isModel ? args_by_model : args_by_role;
  const tableAliases = !isModel ? role_aliases : undefined;
  const tableRowKeys = isModel ? modelKeys : roleKeys;

  const logLane: ConnectionLaneData | undefined =
    logModel != null ? lanesByModel[logModel] : undefined;
  const logRoles =
    logModel != null ? rolesForModel(role_aliases, logModel) : [];

  const metaItems =
    hasUsageData || isConnections
      ? (meta?.filter((m) => m.value != null && m.value !== "") ?? [])
      : [];

  return (
    <div className={clsx(styles.panel, className)}>
      <div className={styles.head}>
        <div className={styles.headLeft}>
          <div className={clsx("text-style-label", styles.title)}>
            {resolvedLabel}
          </div>
          {showSegmented && (
            <SegmentedControl
              segments={segments}
              selectedId={effectiveMode}
              onSegmentChange={(value) => setMode(value as Mode)}
            />
          )}
        </div>
        <div className={styles.meta}>
          {isConnections && (
            <Fragment>
              <ConnectionsLegend />
              {metaItems.length > 0 && <span className={styles.metaSep} />}
            </Fragment>
          )}
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
      </div>
      {isConnections && usageWindow ? (
        <ConnectionsView
          lanes={lanesByModel}
          timeWindow={usageWindow}
          role_aliases={role_aliases}
          retunes_by_model={retunesByModel}
          onShowLog={setLogModel}
          onViewTimeline={onViewTimeline}
        />
      ) : (
        // Roles/Models are token lenses — connection lanes render once, in
        // the Connections lens, never per row (pools are model-keyed).
        <ModelTokenTable
          model_usage={usageData}
          model_configs={tableConfigs}
          model_args={tableArgs}
          model_aliases={tableAliases}
          rowKeys={tableRowKeys}
          showTokenColumns={hasUsageData}
          samples={samples}
          className={styles.tableNoTop}
        />
      )}
      {logLane && (
        <ConnectionLogModal
          model={logLane.model}
          events={logLane.events}
          show={true}
          onHide={() => setLogModel(null)}
          shared_roles={logRoles}
          retunes={retunesByModel[logLane.model]}
          onViewTimeline={
            onViewTimeline
              ? (event) => {
                  // The modal's visibility lives in a property bag that
                  // survives unmount — clear it before navigating away or
                  // it reopens the next time this tab is shown.
                  setLogModel(null);
                  onViewTimeline(logLane.model, event);
                }
              : undefined
          }
        />
      )}
    </div>
  );
};
