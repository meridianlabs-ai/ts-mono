import type { EvalSpec } from "@tsmono/inspect-common/types";
import { modelRoleConfigs } from "@tsmono/inspect-common/utils";
import { nullProtoRecord } from "@tsmono/util";

type Dict = Record<string, unknown>;
type DictMap = Record<string, Dict>;

// Maps, not plain objects — model names, role names and model_args keys all
// come from the log header, so "__proto__" or "constructor" must be ordinary
// keys, never a write through the prototype chain.
type Accumulator = Map<string, Map<string, unknown>>;

const mergeDefined = (target: Map<string, unknown>, source: Dict): void => {
  for (const [k, v] of Object.entries(source)) {
    if (v !== null && v !== undefined) target.set(k, v);
  }
};

const addTo = (
  acc: Accumulator,
  key: string | null | undefined,
  dict: Dict | null | undefined
): void => {
  if (!key || !dict) return;
  const target = acc.get(key) ?? new Map<string, unknown>();
  mergeDefined(target, dict);
  acc.set(key, target);
};

const finalize = (acc: Accumulator): DictMap | undefined => {
  const out = new Map<string, Dict>();
  for (const [k, v] of acc) {
    if (v.size > 0) out.set(k, nullProtoRecord(v));
  }
  return out.size > 0 ? nullProtoRecord(out) : undefined;
};

export const buildConfigsByModel = (
  evalSpec?: EvalSpec
): DictMap | undefined => {
  if (!evalSpec) return undefined;
  const acc: Accumulator = new Map();
  addTo(acc, evalSpec.model, evalSpec.model_generate_config);
  if (evalSpec.model_roles) {
    for (const rc of Object.values(evalSpec.model_roles).flatMap(
      modelRoleConfigs
    )) {
      addTo(acc, rc.model, rc.config);
    }
  }
  return finalize(acc);
};

export const buildConfigsByRole = (
  evalSpec?: EvalSpec
): DictMap | undefined => {
  if (!evalSpec?.model_roles) return undefined;
  const acc: Accumulator = new Map();
  for (const [role, value] of Object.entries(evalSpec.model_roles)) {
    // a role bound to a list of models merges its configs (later models
    // override earlier ones), mirroring how buildConfigsByModel accumulates
    for (const rc of modelRoleConfigs(value)) {
      addTo(acc, role, rc.config);
    }
  }
  return finalize(acc);
};

export const buildArgsByModel = (evalSpec?: EvalSpec): DictMap | undefined => {
  if (!evalSpec) return undefined;
  const acc: Accumulator = new Map();
  addTo(acc, evalSpec.model, evalSpec.model_args);
  if (evalSpec.model_roles) {
    for (const rc of Object.values(evalSpec.model_roles).flatMap(
      modelRoleConfigs
    )) {
      addTo(acc, rc.model, rc.args);
    }
  }
  return finalize(acc);
};

export const buildArgsByRole = (evalSpec?: EvalSpec): DictMap | undefined => {
  if (!evalSpec?.model_roles) return undefined;
  const acc: Accumulator = new Map();
  for (const [role, value] of Object.entries(evalSpec.model_roles)) {
    for (const rc of modelRoleConfigs(value)) {
      addTo(acc, role, rc.args);
    }
  }
  return finalize(acc);
};
