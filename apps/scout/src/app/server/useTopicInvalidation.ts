import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

import { TopicVersions } from "../../api/api";
import { useApi } from "../../state/store";

import { isInvalidationTopic, topicQueries } from "./queries";

/**
 * Monitors topic updates via SSE and invalidates dependent queries on change.
 *
 * For each topic whose timestamp changes, invalidates every query whose key
 * carries that topic's tag (see `topicTag` in ./queries).
 *
 * Call once at app root level.
 *
 * @returns true when first SSE message received (ready), false otherwise
 */
export const useTopicInvalidation = (): boolean => {
  const queryClient = useQueryClient();
  const versions = useTopicUpdates();
  const prevVersionsRef = useRef<TopicVersions | undefined>(undefined);

  // eslint-disable-next-line tsmono/no-raw-use-effect -- baselined at rule introduction; migrate to a named hook or derived state
  useEffect(() => {
    if (versions === undefined) return;

    for (const [topic, timestamp] of Object.entries(versions)) {
      // A newer server may announce topics this client has no queries for.
      if (!isInvalidationTopic(topic)) continue;
      if (prevVersionsRef.current?.[topic] === timestamp) continue;
      queryClient.invalidateQueries(topicQueries(topic)).catch(console.error);
    }

    prevVersionsRef.current = versions;
  }, [versions, queryClient]);

  return versions !== undefined;
};

/**
 * Subscribes to SSE topic updates stream.
 * Returns current topic versions dict, auto-reconnects on disconnect.
 */
const useTopicUpdates = (): TopicVersions | undefined => {
  const api = useApi();
  const [versions, setVersions] = useState<TopicVersions | undefined>(
    undefined
  );

  // eslint-disable-next-line tsmono/no-raw-use-effect -- baselined at rule introduction; migrate to a named hook or derived state
  useEffect(() => api.connectTopicUpdates(setVersions), [api, setVersions]);

  return versions;
};
