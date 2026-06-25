import { FC, useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";

import {
  FocusTurnView,
  useEventNodes,
  useFocusTurnNavigation,
} from "@tsmono/inspect-components/transcript";
import { NoContentsPanel } from "@tsmono/react/components";

import {
  kLogViewSamplesTabId,
  kSampleTranscriptTabId,
} from "../../../constants";
import { useSampleData } from "../../../state/hooks";
import { useLoadSample } from "../../../state/useLoadSample";
import { usePollSample } from "../../../state/usePollSample";
import { isSingleFileMode } from "../../singleFileMode";
import { useLogSampleNavigation } from "../../routing/sampleNavigation";
import { logsUrl, useLogRouteParams, useRoutePrefix } from "../../routing/url";
import { useLoadSampleFromRoute } from "../useLoadSampleFromRoute";
import { SampleNavbar } from "../SampleNavbar";

import styles from "./SampleEventView.module.css";

/**
 * Standalone single-event page (open-in-new-tab from a transcript event).
 * Renders the focused event (and its turn's tool calls) fully expanded, with
 * the transcript's own renderer but without the list's card/gutter chrome.
 * URL pattern: /logs/<logPath>/samples/sample/<id>/<epoch>/event?event=<eventId>
 */
export const SampleEventView: FC = () => {
  const { logPath, sampleId, epoch } = useLogRouteParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const eventId = searchParams.get("event");
  const prefix = useRoutePrefix();

  useLoadSample();
  usePollSample();
  useLoadSampleFromRoute(logPath, sampleId, epoch);

  const sampleData = useSampleData();
  const sample = useMemo(() => sampleData.getSelectedSample(), [sampleData]);

  const { eventNodes } = useEventNodes(sample?.events ?? [], false);
  const setParam = useCallback(
    (key: string, value: string) =>
      setSearchParams(
        (prev) => {
          const params = new URLSearchParams(prev);
          params.set(key, value);
          return params;
        },
        { replace: true }
      ),
    [setSearchParams]
  );
  const nav = useFocusTurnNavigation(
    eventNodes,
    eventId,
    searchParams.get("tab") ?? "Summary",
    setParam
  );

  // Sibling samples have no equivalent single event, so prev/next jump to the
  // sibling's transcript rather than a parameterless `event` URL.
  const sampleNavigation = useLogSampleNavigation(kSampleTranscriptTabId);

  // Mirror LogSampleDetailView: append "/sample" so the log file is a clickable
  // breadcrumb segment, and resolve segments back to the log's samples tab.
  const fnNavigationUrl = useCallback(
    (file: string, log_dir?: string) => {
      if (!logPath || !file) {
        return logsUrl(file, log_dir, undefined, prefix);
      }
      const normalizedFile = file.endsWith("/") ? file.slice(0, -1) : file;
      if (
        normalizedFile === logPath ||
        normalizedFile === `${logPath}/sample`
      ) {
        return logsUrl(logPath, log_dir, kLogViewSamplesTabId, prefix);
      }
      return logsUrl(file, log_dir, undefined, prefix);
    },
    [logPath, prefix]
  );

  const header = (
    <SampleNavbar
      sampleId={sampleId}
      epoch={epoch}
      navigation={sampleNavigation}
      navbarConfig={{
        currentPath: logPath ? `${logPath}/sample` : undefined,
        fnNavigationUrl,
        bordered: true,
        breadcrumbsEnabled: !isSingleFileMode,
      }}
      showActivity="sample"
    />
  );

  if (!sample) {
    return <div className={styles.loading}>Loading sample data…</div>;
  }

  if (nav.slice.length === 0) {
    return <NoContentsPanel text="Event not found in this sample." />;
  }

  return <FocusTurnView nav={nav} eventId={eventId} header={header} />;
};
