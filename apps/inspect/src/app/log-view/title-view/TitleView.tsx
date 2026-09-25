import clsx from "clsx";
import { FC } from "react";

import {
  EvalPlan,
  EvalResults,
  EvalSpec,
  EvalStats,
} from "@tsmono/inspect-common/types";
import { ToolButton } from "@tsmono/react/components";

import { EvalLogStatus } from "../../../@types/extraInspect";
import { RunningMetric } from "../../../client/api/types";
import { useTotalSampleCount } from "../../../state/hooks";
import { ApplicationIcons } from "../../appearance/icons";

import { CollapsedTitleBar } from "./CollapsedTitleBar";
import { PrimaryBar } from "./PrimaryBar";
import { SecondaryBar } from "./SecondaryBar";
import styles from "./TitleView.module.css";

interface TitleViewProps {
  evalSpec?: EvalSpec;
  evalResults?: EvalResults | null;
  runningMetrics?: RunningMetric[];
  evalPlan?: EvalPlan;
  evalStats?: EvalStats;
  status?: EvalLogStatus;
  tags?: string[];
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
}

/**
 * Renders the Navbar
 */
export const TitleView: FC<TitleViewProps> = ({
  evalSpec,
  evalPlan,
  evalResults,
  evalStats,
  status,
  runningMetrics,
  tags,
  collapsed,
  onCollapsedChange,
}) => {
  const totalSampleCount = useTotalSampleCount();

  return (
    <nav
      className={clsx(
        "navbar",
        "sticky-top",
        styles.navbarWrapper,
        collapsed ? styles.collapsed : undefined
      )}
    >
      <div
        id="log-title-expanded"
        className={styles.expandedSlot}
        aria-hidden={collapsed}
      >
        <div className={styles.expandedInner}>
          <PrimaryBar
            evalSpec={evalSpec}
            evalResults={evalResults}
            status={status}
            runningMetrics={runningMetrics}
            sampleCount={totalSampleCount}
            tags={tags}
          />
          <SecondaryBar
            evalSpec={evalSpec}
            evalPlan={evalPlan}
            evalResults={evalResults}
            evalStats={evalStats}
            status={status}
            sampleCount={totalSampleCount}
          />
        </div>
      </div>
      <div className={styles.collapsedSlot} aria-hidden={!collapsed}>
        <CollapsedTitleBar
          evalSpec={evalSpec}
          evalResults={evalResults}
          runningMetrics={runningMetrics}
          status={status}
          sampleCount={totalSampleCount}
        />
      </div>
      <ToolButton
        className={styles.collapseToggle}
        icon={
          collapsed
            ? ApplicationIcons.expand.down
            : ApplicationIcons.collapse.up
        }
        aria-label={collapsed ? "Expand header" : "Collapse header"}
        title={collapsed ? "Expand header" : "Collapse header"}
        aria-controls="log-title-expanded"
        aria-expanded={!collapsed}
        onClick={() => onCollapsedChange(!collapsed)}
        subtle
      />
    </nav>
  );
};
