import clsx from "clsx";
import { FC, useMemo } from "react";

import {
  ConfigUpdate,
  EvalSpec,
  ModelConfig,
} from "@tsmono/inspect-common/types";
import {
  effectiveGenerateConfig,
  generateConfigChanges,
} from "@tsmono/inspect-common/utils";
import { ConfigValueCell } from "@tsmono/inspect-components/config";
import { MetaDataGrid } from "@tsmono/inspect-components/content";
import { Card, CardBody, CardHeader } from "@tsmono/react/components";

import { useShowTimeline } from "../log-view/useShowTimeline";

import styles from "./ModelCard.module.css";

interface ModelCardProps {
  evalSpec?: EvalSpec;
  configUpdates?: ConfigUpdate[] | null;
}

/**
 * Renders the plan card
 */
export const ModelCard: FC<ModelCardProps> = ({ evalSpec, configUpdates }) => {
  const showTimeline = useShowTimeline();

  // Generate-config retunes fold over the main model's generate config;
  // role configs are launch-only.
  const changes = useMemo(
    () => generateConfigChanges(configUpdates),
    [configUpdates]
  );

  const evalModelConfig = useMemo(() => {
    const launch = evalSpec?.model_generate_config;
    if (!launch) {
      return launch;
    }
    return effectiveGenerateConfig(launch, configUpdates);
  }, [evalSpec?.model_generate_config, configUpdates]);

  if (!evalSpec) {
    return undefined;
  }

  const modelsInfo: Record<string, ModelConfig> = {
    eval: {
      model: evalSpec.model,
      base_url: evalSpec.model_base_url,
      config: evalModelConfig,
      args: evalSpec.model_args,
    },
    ...evalSpec.model_roles,
  };

  const noneEl = <span className="text-style-secondary">None</span>;

  const configEntries = (
    modelKey: string,
    config: Record<string, unknown>
  ): Record<string, unknown> => {
    if (modelKey !== "eval" || changes.size === 0) {
      return config;
    }
    const entries: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(config)) {
      const change = changes.get(key);
      entries[key] = change
        ? {
            _html: (
              <ConfigValueCell
                value={value}
                change={change}
                onViewTimeline={showTimeline}
              />
            ),
          }
        : value;
    }
    for (const [key, change] of changes) {
      if (!(key in entries)) {
        entries[key] = {
          _html: (
            <ConfigValueCell
              value={undefined}
              change={change}
              onViewTimeline={showTimeline}
            />
          ),
        };
      }
    }
    return entries;
  };

  return (
    <Card>
      <CardHeader label="Models" />
      <CardBody id={"task-model-card-body"}>
        <div className={styles.container}>
          {Object.keys(modelsInfo || {}).map((modelKey) => {
            const modelInfo = modelsInfo[modelKey];
            if (modelInfo === undefined) {
              return null;
            }
            const config = modelInfo.config || {};
            const entries = configEntries(modelKey, config);
            return (
              <div
                key={modelKey}
                className={clsx(styles.modelInfo, "text-size-small")}
              >
                <div
                  className={clsx(
                    styles.role,
                    "text-style-label",
                    "text-style-secondary"
                  )}
                >
                  {modelKey}
                </div>
                <div className={clsx(styles.sep)} />
                <div className={clsx("text-style-label")}>Model</div>
                <div>{modelInfo.model}</div>
                <div className={clsx(styles.sep)} />
                <div className={clsx("text-style-label")}>Base Url</div>
                <div className="text-size-small">
                  {modelInfo.base_url || noneEl}
                </div>
                <div className={clsx(styles.sep)} />
                <div className={clsx("text-style-label")}>Configuration</div>
                <div className="text-size-small">
                  {Object.keys(entries).length > 0 ? (
                    <MetaDataGrid entries={entries} />
                  ) : (
                    noneEl
                  )}
                </div>
                <div className={clsx(styles.sep)} />
                <div className={clsx("text-style-label")}>Args</div>
                <div className="text-size-small">
                  {Object.keys(modelInfo.args).length > 0 ? (
                    <MetaDataGrid entries={modelInfo.args} />
                  ) : (
                    noneEl
                  )}
                </div>
                <div className={clsx(styles.sep)} />
              </div>
            );
          })}
        </div>
      </CardBody>
    </Card>
  );
};
