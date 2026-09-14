import { CursorType } from ".";
import {
  infiniteQueryOptions,
  keepPreviousData,
  QueryFilters,
  queryOptions,
  skipToken,
} from "@tanstack/react-query";

import { ApiError, decodeArrowBytes } from "@tsmono/util";

import { ScalarValue, ScoutApiV2 } from "../../api/api";
import { Column, Condition, OrderByModel } from "../../query";
import { InvalidationTopic, ValidationCase } from "../../types/api-types";
import { expandResultsetRows } from "../utils/arrow";

/**
 * Every server query key in the app is built here, so a key's shape is
 * declared once and read back through the tagged `queryKey` of its options
 * (see design/react-query.md). Keys carry a topic tag when the server can
 * announce that their data changed; `useTopicInvalidation` invalidates by
 * tag, never by retyped string.
 */

// -- Topic tags -------------------------------------------------------------

/** Key segment marking a query as dependent on a server invalidation topic. */
export type TopicTag = `${InvalidationTopic}-inv`;

export const topicTag = (topic: InvalidationTopic): TopicTag => `${topic}-inv`;

/** Filter matching every query whose key carries `topic`'s tag. */
export const topicQueries = (topic: InvalidationTopic): QueryFilters => {
  const tag = topicTag(topic);
  return { predicate: (query) => query.queryKey.includes(tag) };
};

// Exhaustive by construction: a Record over the generated union fails to
// compile the moment the server adds a topic this list doesn't name.
const kInvalidationTopics: Record<InvalidationTopic, true> = {
  "project-config": true,
  scans: true,
  transcripts: true,
};

/** Narrows a topic name arriving on the wire to one this client tags. */
export const isInvalidationTopic = (
  topic: string
): topic is InvalidationTopic => Object.hasOwn(kInvalidationTopics, topic);

// Disabled queries all share one key so they never occupy a real cache slot.
const kSkipped = [skipToken] as const;

// -- Config -----------------------------------------------------------------

export const appConfigQuery = (api: ScoutApiV2) =>
  queryOptions({
    queryKey: ["config", topicTag("project-config")] as const,
    queryFn: () => api.getConfig(),
    staleTime: Infinity,
  });

// Refetching is off so optimistic locking works: external edits surface as
// a 412 on save, and the user chooses to reload or force.
export const projectConfigQuery = (api: ScoutApiV2) =>
  queryOptions({
    queryKey: ["project-config", topicTag("project-config")] as const,
    queryFn: () => api.getProjectConfig(),
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    refetchOnReconnect: false,
  });

// -- Scans ------------------------------------------------------------------

export type ScanParams = { scansDir: string; scanPath: string };

export const scanQuery = (
  api: ScoutApiV2,
  params: ScanParams | typeof skipToken
) =>
  queryOptions({
    queryKey:
      params === skipToken
        ? kSkipped
        : ([
            "scan",
            params.scansDir,
            params.scanPath,
            topicTag("scans"),
          ] as const),
    queryFn:
      params === skipToken
        ? skipToken
        : () => api.getScan(params.scansDir, params.scanPath),
    staleTime: 10000,
  });

export type ScanDataframeParams = {
  scansDir: string;
  scanPath: string;
  scanner: string;
  excludeColumns?: string[];
};

export const scanDataframeQuery = (
  api: ScoutApiV2,
  params: ScanDataframeParams | typeof skipToken
) =>
  queryOptions({
    queryKey:
      params === skipToken
        ? kSkipped
        : ([
            "scanDataframe",
            params.scansDir,
            params.scanPath,
            params.scanner,
            params.excludeColumns,
            topicTag("scans"),
          ] as const),
    queryFn:
      params === skipToken
        ? skipToken
        : async () =>
            expandResultsetRows(
              decodeArrowBytes(
                await api.getScannerDataframe(
                  params.scansDir,
                  params.scanPath,
                  params.scanner,
                  params.excludeColumns
                )
              )
            ),
    staleTime: Infinity,
  });

export type ScanDataframeDetailParams = {
  scansDir: string;
  scanPath: string;
  scanner: string;
  uuid: string;
};

export const scanDataframeDetailQuery = (
  api: ScoutApiV2,
  params: ScanDataframeDetailParams | typeof skipToken
) =>
  queryOptions({
    queryKey:
      params === skipToken
        ? kSkipped
        : (["scanDataframeDetail", params, topicTag("scans")] as const),
    queryFn:
      params === skipToken
        ? skipToken
        : () =>
            api.getScannerDataframeDetail(
              params.scansDir,
              params.scanPath,
              params.scanner,
              params.uuid
            ),
    staleTime: Infinity,
  });

export type ColumnValuesParams = {
  location: string;
  column: string;
  filter: Condition | undefined;
};

export const scansColumnValuesQuery = (
  api: ScoutApiV2,
  params: ColumnValuesParams | typeof skipToken
) =>
  queryOptions({
    queryKey:
      params === skipToken
        ? kSkipped
        : (["scansColumnValues", params, topicTag("scans")] as const),
    queryFn:
      params === skipToken
        ? skipToken
        : (): Promise<ScalarValue[]> =>
            api.getScansColumnValues(
              params.location,
              params.column,
              params.filter
            ),
    // Column values change rarely; be liberal.
    staleTime: 10 * 60 * 1000,
  });

// A function, not a const: TS narrows `const x: T | undefined = undefined` to
// `undefined`, which would collapse the inferred page-param type.
const initialCursor = (): CursorType | undefined => undefined;

const pageFor = (pageSize: number, cursor: CursorType | undefined) => ({
  limit: pageSize,
  cursor: cursor ?? null,
  direction: "forward" as const,
});

export const scansInfiniteQuery = (
  api: ScoutApiV2,
  scansDir: string,
  pageSize: number,
  filter: Condition | undefined,
  orderBy: OrderByModel[] | undefined
) =>
  infiniteQueryOptions({
    queryKey: [
      "scans-infinite",
      scansDir,
      filter,
      orderBy,
      pageSize,
      topicTag("scans"),
    ] as const,
    queryFn: ({ pageParam }) =>
      api.getScans(scansDir, filter, orderBy, pageFor(pageSize, pageParam)),
    initialPageParam: initialCursor(),
    getNextPageParam: (lastPage) => lastPage.next_cursor ?? undefined,
    staleTime: 10000,
    placeholderData: keepPreviousData,
  });

export const activeScansQuery = (api: ScoutApiV2) =>
  queryOptions({
    queryKey: ["active-scans"] as const,
    queryFn: async () => (await api.getActiveScans()).items,
    refetchInterval: 5000,
  });

export const scannersQuery = (api: ScoutApiV2) =>
  queryOptions({
    queryKey: ["scanners"] as const,
    queryFn: async () => (await api.getScanners()).items,
    staleTime: 10000,
  });

// -- Transcripts ------------------------------------------------------------

export const transcriptsQuery = (
  api: ScoutApiV2,
  location: string,
  filter: Condition | undefined,
  orderBy: OrderByModel[] | undefined
) =>
  queryOptions({
    queryKey: [
      "transcripts",
      location,
      filter,
      orderBy,
      topicTag("transcripts"),
    ] as const,
    queryFn: () => api.getTranscripts(location, filter, orderBy),
    staleTime: 10 * 60 * 1000,
    refetchInterval: 10 * 60 * 1000,
    placeholderData: keepPreviousData,
  });

export type TranscriptsInfiniteParams = {
  location: string;
  pageSize: number;
  filter: Condition | undefined;
  orderBy: OrderByModel[] | undefined;
};

// Tagged with project-config too: the project filter shapes this listing.
export const transcriptsInfiniteQuery = (
  api: ScoutApiV2,
  params: TranscriptsInfiniteParams | typeof skipToken
) =>
  infiniteQueryOptions({
    queryKey:
      params === skipToken
        ? kSkipped
        : ([
            "transcripts-infinite",
            params.location,
            params.filter,
            params.orderBy,
            params.pageSize,
            topicTag("transcripts"),
            topicTag("project-config"),
          ] as const),
    queryFn:
      params === skipToken
        ? skipToken
        : ({ pageParam }) =>
            api.getTranscripts(
              params.location,
              params.filter,
              params.orderBy,
              pageFor(params.pageSize, pageParam)
            ),
    initialPageParam: initialCursor(),
    getNextPageParam: (lastPage) => lastPage.next_cursor ?? undefined,
    staleTime: 10 * 60 * 1000,
    refetchInterval: 10 * 60 * 1000,
    placeholderData: keepPreviousData,
  });

export const transcriptsByIdsQuery = (
  api: ScoutApiV2,
  transcriptsDir: string | undefined,
  ids: readonly string[]
) => {
  // Order-insensitive key: the same set of ids is one query however the
  // caller happened to list them.
  const sortedIds = [...ids].sort();
  const enabled = transcriptsDir !== undefined && ids.length > 0;
  return queryOptions({
    queryKey: enabled
      ? ([
          "transcriptsByIds",
          transcriptsDir,
          sortedIds,
          topicTag("transcripts"),
        ] as const)
      : kSkipped,
    queryFn: enabled
      ? async () =>
          (
            await api.getTranscripts(
              transcriptsDir,
              new Column("transcript_id").in(sortedIds),
              undefined,
              pageFor(sortedIds.length, undefined)
            )
          ).items
      : skipToken,
    staleTime: 60 * 1000,
  });
};

export const transcriptsColumnValuesQuery = (
  api: ScoutApiV2,
  params: ColumnValuesParams | typeof skipToken
) =>
  queryOptions({
    queryKey:
      params === skipToken
        ? kSkipped
        : ([
            "transcriptsColumnValues",
            params,
            topicTag("transcripts"),
          ] as const),
    queryFn:
      params === skipToken
        ? skipToken
        : (): Promise<ScalarValue[]> =>
            api.getTranscriptsColumnValues(
              params.location,
              params.column,
              params.filter
            ),
    // Column values change rarely; be liberal.
    staleTime: 10 * 60 * 1000,
  });

export type TranscriptParams = { location: string; id: string };

export const transcriptQuery = (
  api: ScoutApiV2,
  params: TranscriptParams | typeof skipToken
) =>
  queryOptions({
    queryKey:
      params === skipToken ? kSkipped : (["transcript", params] as const),
    queryFn:
      params === skipToken
        ? skipToken
        : () => api.getTranscript(params.location, params.id),
    staleTime: Infinity,
  });

export const hasTranscriptQuery = (
  api: ScoutApiV2,
  params: TranscriptParams | typeof skipToken
) =>
  queryOptions({
    queryKey:
      params === skipToken ? kSkipped : (["has_transcript", params] as const),
    queryFn:
      params === skipToken
        ? skipToken
        : () => api.hasTranscript(params.location, params.id),
    staleTime: Infinity,
  });

export const codeQuery = (
  api: ScoutApiV2,
  condition: Condition | typeof skipToken
) =>
  queryOptions({
    queryKey: ["code", condition] as const,
    queryFn:
      condition === skipToken ? skipToken : () => api.postCode(condition),
    staleTime: Infinity,
  });

// -- Validation -------------------------------------------------------------

export const validationSetsQuery = (api: ScoutApiV2) =>
  queryOptions({
    queryKey: ["validationSets"] as const,
    queryFn: () => api.getValidationSets(),
    staleTime: 60 * 1000,
  });

export const validationCasesQuery = (
  api: ScoutApiV2,
  uri: string | typeof skipToken
) =>
  queryOptions({
    queryKey: ["validationCases", uri] as const,
    queryFn: uri === skipToken ? skipToken : () => api.getValidationCases(uri),
    staleTime: 60 * 1000,
  });

export type ValidationCaseParams = { url: string; caseId: string };

// A missing case is data (`null`), not a failure: the editor renders the
// create flow for it.
export const validationCaseQuery = (
  api: ScoutApiV2,
  params: ValidationCaseParams | typeof skipToken
) =>
  queryOptions({
    queryKey: ["validationCase", params] as const,
    queryFn:
      params === skipToken
        ? skipToken
        : async (): Promise<ValidationCase | null> => {
            try {
              return await api.getValidationCase(params.url, params.caseId);
            } catch (error) {
              if (error instanceof ApiError && error.status === 404) {
                return null;
              }
              throw error;
            }
          },
    staleTime: 60 * 1000,
  });
