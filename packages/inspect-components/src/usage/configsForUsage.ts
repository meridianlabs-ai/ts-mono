import type { EvalSpec } from "@tsmono/inspect-common/types";
import { modelRoleConfigs } from "@tsmono/inspect-common/utils";

type Dict = Record<string, unknown>;
type DictMap = Record<string, Dict>;

const mergeDefined = (target: Dict, source: Dict): Dict => {
  for (const [k, v] of Object.entries(source)) {
    if (v !== null && v !== undefined) target[k] = v;
  }
  return target;
};

const finalize = (acc: DictMap): DictMap | undefined => {
  const out: DictMap = {};
  for (const [k, v] of Object.entries(acc)) {
    if (Object.keys(v).length > 0) out[k] = v;
  }
  return Object.keys(out).length > 0 ? out : undefined;
};

export const buildConfigsByModel = (
  evalSpec?: EvalSpec
): DictMap | undefined => {
  if (!evalSpec) return undefined;
  const acc: DictMap = {};
  const add = (modelId?: string | null, cfg?: Dict | null) => {
    if (!modelId || !cfg) return;
    acc[modelId] = mergeDefined(acc[modelId] ?? {}, cfg);
  };
  add(evalSpec.model, evalSpec.model_generate_config);
  if (evalSpec.model_roles) {
    for (const rc of Object.values(evalSpec.model_roles).flatMap(
      modelRoleConfigs
    )) {
      add(rc.model, rc.config);
    }
  }
  return finalize(acc);
};

export const buildConfigsByRole = (
  evalSpec?: EvalSpec
): DictMap | undefined => {
  if (!evalSpec?.model_roles) return undefined;
  const acc: DictMap = {};
  for (const [role, value] of Object.entries(evalSpec.model_roles)) {
    // a role bound to a list of models merges its configs (later models
    // override earlier ones), mirroring how buildConfigsByModel accumulates
    for (const rc of modelRoleConfigs(value)) {
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      if (rc.config) acc[role] = mergeDefined(acc[role] ?? {}, rc.config);
    }
  }
  return finalize(acc);
};

export const buildArgsByModel = (evalSpec?: EvalSpec): DictMap | undefined => {
  if (!evalSpec) return undefined;
  const acc: DictMap = {};
  const add = (modelId?: string | null, args?: Dict | null) => {
    if (!modelId || !args) return;
    acc[modelId] = mergeDefined(acc[modelId] ?? {}, args);
  };
  add(evalSpec.model, evalSpec.model_args);
  if (evalSpec.model_roles) {
    for (const rc of Object.values(evalSpec.model_roles).flatMap(
      modelRoleConfigs
    )) {
      add(rc.model, rc.args);
    }
  }
  return finalize(acc);
};

export const buildArgsByRole = (evalSpec?: EvalSpec): DictMap | undefined => {
  if (!evalSpec?.model_roles) return undefined;
  const acc: DictMap = {};
  for (const [role, value] of Object.entries(evalSpec.model_roles)) {
    for (const rc of modelRoleConfigs(value)) {
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      if (rc.args) acc[role] = mergeDefined(acc[role] ?? {}, rc.args);
    }
  }
  return finalize(acc);
};
