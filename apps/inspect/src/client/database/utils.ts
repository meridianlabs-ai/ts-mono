import { modelRoleNames } from "@tsmono/inspect-common/utils";

import { headlineMetric } from "../../scoring/headline";
import { EvalHeader, LogPreview } from "../api/types";

export function toLogOverview(header: EvalHeader): LogPreview {
  const { eval: evalSpec, version, status, error, stats, results } = header;

  const primary_metric = headlineMetric(results, evalSpec.headline_metric);

  const model_roles = modelRoleNames(evalSpec.model_roles);

  return {
    eval_id: evalSpec.eval_id,
    run_id: evalSpec.run_id,
    task: evalSpec.task,
    task_id: evalSpec.task_id,
    task_version: evalSpec.task_version,
    version,
    status,
    error,
    model: evalSpec.model,
    model_roles,
    started_at: evalSpec.created,
    completed_at: stats?.completed_at,
    primary_metric,
  };
}
