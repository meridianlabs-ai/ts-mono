import clsx from "clsx";
import { FC, useMemo } from "react";

import { ConfigUpdate, EvalConfig } from "@tsmono/inspect-common/types";
import {
  effectiveEvalConfig,
  evalConfigChanges,
} from "@tsmono/inspect-common/utils";
import {
  ConfigValueCell,
  TimelineLink,
} from "@tsmono/inspect-components/config";
import { MetaDataGrid } from "@tsmono/inspect-components/content";
import { Card, CardBody, CardHeader } from "@tsmono/react/components";

import { useShowTimeline } from "../useShowTimeline";

import styles from "./ConfigCard.module.css";

interface ConfigCardProps {
  config?: EvalConfig;
  configUpdates?: ConfigUpdate[] | null;
}

/**
 * The eval-level Config card (Task tab): effective values with the
 * "changed" affordance on retuned knobs. With no config_updates it renders
 * exactly the plain launch-value grid.
 */
export const ConfigCard: FC<ConfigCardProps> = ({ config, configUpdates }) => {
  const showTimeline = useShowTimeline();

  const changes = useMemo(
    () => evalConfigChanges(configUpdates),
    [configUpdates]
  );

  const entries = useMemo(() => {
    if (!config) {
      return {};
    }
    const effective = effectiveEvalConfig(config, configUpdates);
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(effective)) {
      const change = changes.get(key);
      result[key] = change
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
    // Knobs touched mid-run but absent from the effective config (e.g. an
    // override set then cleared on a knob unset at launch) still get a row.
    for (const [key, change] of changes) {
      if (!(key in result)) {
        result[key] = {
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
    return result;
  }, [config, configUpdates, changes, showTimeline]);

  if (Object.keys(entries).length === 0) {
    return null;
  }

  const changeCount = changes.size;

  return (
    <Card>
      <CardHeader label="Config">
        {changeCount > 0 ? (
          <span className={styles.headerMeta}>
            <span className={styles.effectiveNote}>effective</span>
            <span className={styles.headerRight}>
              <span className={styles.changeCount}>
                {changeCount} {changeCount === 1 ? "change" : "changes"}
              </span>
              <span className={styles.headerSep} />
              <TimelineLink onClick={showTimeline} />
            </span>
          </span>
        ) : null}
      </CardHeader>
      <CardBody id={"task-card-eval-config"}>
        <MetaDataGrid
          key={`task-md-eval-config`}
          className={clsx("text-size-small")}
          entries={entries}
        />
      </CardBody>
    </Card>
  );
};
