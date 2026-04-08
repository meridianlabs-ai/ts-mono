import { FC, useMemo } from "react";

import { EvalSpec, EvalStats } from "@tsmono/inspect-common/types";
import { UsageCard } from "@tsmono/inspect-components/usage";

import { EvalLogStatus } from "../../../@types/extraInspect";
import { kLogViewModelsTabId } from "../../../constants";
import { ModelCard } from "../../plan/ModelCard";

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
        {evalSpec ? <ModelCard evalSpec={evalSpec} /> : undefined}
        {evalStatus !== "started" &&
          evalStats?.model_usage &&
          Object.keys(evalStats.model_usage).length > 0 && (
            <>
              <UsageCard label="Model Usage" usage={evalStats.model_usage} />
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
