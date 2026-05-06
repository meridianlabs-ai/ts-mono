import { FC, useMemo } from "react";

import { EvalSpec, EvalStats } from "@tsmono/inspect-common/types";
import { UsageCard } from "@tsmono/inspect-components/usage";

import { EvalLogStatus } from "../../../@types/extraInspect";
import { kLogViewModelsTabId } from "../../../constants";

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

export const ModelTab: FC<ModelTabProps> = ({
  evalSpec,
  evalStats,
  evalStatus,
}) => {
  const modelConfigs = useMemo(() => {
    if (!evalSpec) return undefined;
    const configs: Record<string, Record<string, unknown>> = {};

    const addConfig = (modelId: string, config: unknown) => {
      if (
        modelId &&
        config &&
        typeof config === "object" &&
        Object.keys(config).length > 0
      ) {
        configs[modelId] = config as Record<string, unknown>;
      }
    };

    addConfig(evalSpec.model, evalSpec.model_generate_config);
    if (evalSpec.model_roles) {
      for (const roleConfig of Object.values(evalSpec.model_roles)) {
        if (roleConfig.model && !configs[roleConfig.model]) {
          addConfig(roleConfig.model, roleConfig.config);
        }
      }
    }

    return Object.keys(configs).length > 0 ? configs : undefined;
  }, [evalSpec]);

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
        {evalStatus !== "started" &&
          evalStats?.model_usage &&
          Object.keys(evalStats.model_usage).length > 0 && (
            <>
              <UsageCard
                label="Model Usage"
                usage={evalStats.model_usage}
                model_configs={modelConfigs}
              />
              {evalStats.role_usage &&
                Object.keys(evalStats.role_usage).length > 0 && (
                  <UsageCard label="Role Usage" usage={evalStats.role_usage} />
                )}
            </>
          )}
      </div>
    </div>
  );
};
