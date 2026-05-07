import { FC, useMemo, useState } from "react";

import { EvalSpec, EvalStats } from "@tsmono/inspect-common/types";
import {
  buildArgsByModel,
  buildArgsByRole,
  buildConfigsByModel,
  buildConfigsByRole,
  ModelTokenTable,
  UsageCard,
} from "@tsmono/inspect-components/usage";
import {
  Card,
  CardBody,
  CardHeader,
  SegmentedControl,
} from "@tsmono/react/components";

import { EvalLogStatus } from "../../../@types/extraInspect";
import { kLogViewModelsTabId } from "../../../constants";
import { ModelCard } from "../../plan/ModelCard";

import styles from "./ModelsTab.module.css";

// Individual hook for Info tab
export const useModelsTab = (
  evalSpec: EvalSpec | undefined,
  evalStats: EvalStats | undefined,
  evalStatus?: EvalLogStatus
) => {
  return useMemo(() => {
    return {
      id: kLogViewModelsTabId,
      label: "Models",
      scrollable: true,
      component: ModelTab,
      componentProps: {
        evalSpec,
        evalStats,
        evalStatus,
      },
    };
  }, [evalSpec, evalStats, evalStatus]);
};

interface ModelTabProps {
  evalSpec?: EvalSpec;
  evalStats?: EvalStats;
  evalStatus?: EvalLogStatus;
}

type UsageMode = "model" | "role";

export const ModelTab: FC<ModelTabProps> = ({
  evalSpec,
  evalStats,
  evalStatus,
}) => {
  const configsByModel = useMemo(
    () => buildConfigsByModel(evalSpec),
    [evalSpec]
  );
  const configsByRole = useMemo(() => buildConfigsByRole(evalSpec), [evalSpec]);
  const argsByModel = useMemo(() => buildArgsByModel(evalSpec), [evalSpec]);
  const argsByRole = useMemo(() => buildArgsByRole(evalSpec), [evalSpec]);

  const roleModels = useMemo(() => {
    if (!evalSpec) return undefined;
    const roles: Record<string, string> = {};
    if (evalSpec.model) {
      roles["eval"] = evalSpec.model;
    }
    if (evalSpec.model_roles) {
      for (const [role, config] of Object.entries(evalSpec.model_roles)) {
        if (config.model) {
          roles[role] = config.model;
        }
      }
    }
    return Object.keys(roles).length > 0 ? roles : undefined;
  }, [evalSpec]);

  const [usageMode, setUsageMode] = useState<UsageMode>("model");

  const showUsage = evalStatus !== "started";
  const hasModelUsage =
    showUsage &&
    !!evalStats?.model_usage &&
    Object.keys(evalStats.model_usage).length > 0;
  const hasRoleUsage =
    showUsage &&
    !!evalStats?.role_usage &&
    Object.keys(evalStats.role_usage).length > 0;

  return (
    <div style={{ width: "100%" }}>
      <div
        style={{
          padding: "0.5em 1em 0 1em",
          width: "100%",
          display: "flex",
          flexDirection: "column",
          gap: "0.75rem",
        }}
      >
        {hasModelUsage && hasRoleUsage && evalStats && (
          <Card>
            <CardHeader label="Usage" className={styles.usageHeader}>
              <div className={styles.usageHeaderControl}>
                <SegmentedControl
                  segments={[
                    { id: "model", label: "Model" },
                    { id: "role", label: "Role" },
                  ]}
                  selectedId={usageMode}
                  onSegmentChange={(id) => setUsageMode(id as UsageMode)}
                />
              </div>
            </CardHeader>
            <CardBody>
              <ModelTokenTable
                model_usage={
                  usageMode === "model"
                    ? evalStats.model_usage
                    : evalStats.role_usage
                }
                model_configs={
                  usageMode === "model" ? configsByModel : configsByRole
                }
                model_args={usageMode === "model" ? argsByModel : argsByRole}
                model_aliases={usageMode === "role" ? roleModels : undefined}
              />
            </CardBody>
          </Card>
        )}

        {hasModelUsage && !hasRoleUsage && evalStats && (
          <UsageCard
            label="Model Usage"
            usage={evalStats.model_usage}
            model_configs={configsByModel}
            model_args={argsByModel}
          />
        )}

        {!hasModelUsage && hasRoleUsage && evalStats && (
          <UsageCard
            label="Role Usage"
            usage={evalStats.role_usage}
            model_configs={configsByRole}
            model_args={argsByRole}
            model_aliases={roleModels}
          />
        )}

        {!hasModelUsage && !hasRoleUsage && evalSpec && (
          <ModelCard evalSpec={evalSpec} />
        )}
      </div>
    </div>
  );
};
