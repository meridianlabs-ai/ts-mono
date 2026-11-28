import { FC } from "react";

import type { EvalSpec, EvalStats } from "@tsmono/inspect-common/types";
import { SentinelStatsPanel } from "@tsmono/inspect-components/sentinel-stats";
import type { MetaItem } from "@tsmono/inspect-components/usage";

import { kLogViewSentinelsTabId } from "../../../constants";
import { useSelectedSampleSummaries } from "../../../state/hooks";
import { useCurrentLogFile } from "../../routing/currentSelection";
import { useSampleNavigationActions } from "../../routing/sampleNavigation";
import { routeFromFullUrl, toFullUrl } from "../../routing/url";
import type { TabDescriptor } from "../types";

import styles from "./SentinelsTab.module.css";
import { OpenSampleLink, type SampleOpener } from "./timeline/OpenSampleLink";

/** The eval's Sentinels tab, only for an eval whose sentinels recorded stats. */
export const useSentinelsTab = (
  evalSpec: EvalSpec | undefined,
  evalStats: EvalStats | undefined
): TabDescriptor | undefined => {
  const stats = evalStats?.sentinel_stats;
  if (!stats || Object.keys(stats).length === 0) return undefined;
  return {
    id: kLogViewSentinelsTabId,
    label: "Sentinels",
    scrollable: true,
    content: <SentinelsTab evalSpec={evalSpec} stats={stats} />,
  };
};

interface SentinelsTabProps {
  evalSpec?: EvalSpec;
  stats: NonNullable<EvalStats["sentinel_stats"]>;
}

const SentinelsTab: FC<SentinelsTabProps> = ({ evalSpec, stats }) => {
  const samples = useSelectedSampleSummaries().data;
  const logFile = useCurrentLogFile();
  const { showSample, getSampleUrl } = useSampleNavigationActions();
  const opener: SampleOpener = {
    href: (id, epoch) => {
      const url = getSampleUrl(id, epoch);
      return url ? toFullUrl(routeFromFullUrl(url)) : undefined;
    },
    open: (id, epoch) => showSample(id, epoch),
  };
  const proxy = evalSpec?.config.sentinel_proxy;
  const meta: MetaItem[] = [
    ...(samples ? [{ label: "Samples", value: String(samples.length) }] : []),
    ...(proxy ? [{ label: "Sentinel proxy", value: proxy }] : []),
  ];
  return (
    <div className={styles.container}>
      <SentinelStatsPanel
        kind="eval"
        stats={stats}
        config={evalSpec?.config.sentinel}
        meta={meta}
        samples={samples}
        stateKey={logFile ?? undefined}
        renderOpenSample={(sample) => (
          <OpenSampleLink
            opener={opener}
            sample={sample}
            className={styles.openSample}
          >
            open →
          </OpenSampleLink>
        )}
      />
    </div>
  );
};
