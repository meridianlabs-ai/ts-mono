import type { Event } from "@tsmono/inspect-common/types";
import { expandEvents } from "@tsmono/inspect-common/utils";

import type { Condition, OrderByModel } from "../../query";
import {
  ActiveScansResponse,
  AppConfig,
  CreateValidationSetRequest,
  MessagesEventsResponse,
  Pagination,
  ProjectConfig,
  ProjectConfigInput,
  Result,
  ScanJobConfig,
  ScannerInputResponse,
  ScannersResponse,
  ScansResponse,
  SearchInputListResponse,
  SearchRequest,
  SearchResponse,
  Status,
  Transcript,
  TranscriptInfo,
  TranscriptsResponse,
  ValidationCase,
  ValidationCaseRequest,
} from "../../types/api-types";
import {
  NoPersistence,
  ScalarValue,
  ScanResultDetail,
  ScoutApiV2,
  SearchResultScope,
  TopicVersions,
} from "../api";
import { resolveAttachments } from "../attachmentsHelpers";
import { expandInputEvents } from "../expandInputEvents";

import {
  applyOrderBy,
  applyPagination,
  evaluateCondition,
} from "./condition-eval";

export class StaticBundleError extends Error {
  constructor(operation: string) {
    super(
      `'${operation}' is not available in static bundle mode (read-only snapshot).`
    );
    this.name = "StaticBundleError";
  }
}

export interface StaticBundleContext {
  /** Base URL of the bundle's `api/` directory. Defaults to `./api`. */
  bundleBaseUrl?: string;
  /** Transcripts directory key baked into the bundle. */
  transcriptsDir?: string;
  /** Scans directory key baked into the bundle. */
  scansDir?: string;
}

const joinUrl = (base: string, ...parts: string[]): string => {
  const trimmedBase = base.endsWith("/") ? base.slice(0, -1) : base;
  const cleaned = parts
    .map((p) => p.replace(/^\/+|\/+$/g, ""))
    .filter((p) => p.length > 0);
  return [trimmedBase, ...cleaned].join("/");
};

const fetchJson = async <T>(url: string): Promise<T> => {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch ${url}: ${res.status} ${res.statusText}`);
  }
  return (await res.json()) as T;
};

const fetchOk = async (url: string): Promise<Response> => {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch ${url}: ${res.status} ${res.statusText}`);
  }
  return res;
};

const unsupported = <T>(op: string): Promise<T> =>
  Promise.reject(new StaticBundleError(op));

/** Mirror the Python bundler's filesystem-safe transcript id encoding. */
const sanitizeTranscriptId = (id: string): string =>
  id.replace(/\//g, "_").replace(/\\/g, "_");

/** Base64url-encode a UTF-8 string (no `=` padding), matching the bundler. */
const base64UrlEncode = (input: string): string => {
  const bytes = new TextEncoder().encode(input);
  let binary = "";
  for (const b of bytes) {
    binary += String.fromCharCode(b);
  }
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
};

export const apiScoutStatic = (
  context: StaticBundleContext = {}
): ScoutApiV2 => {
  const baseUrl = context.bundleBaseUrl ?? "./api";

  // Cached listings — fetched lazily, reused across method calls.
  let transcriptsListing: Promise<TranscriptsResponse> | undefined;
  let scansListing: Promise<ScansResponse> | undefined;

  const getTranscriptsListing = (): Promise<TranscriptsResponse> => {
    if (!transcriptsListing) {
      transcriptsListing = fetchJson<TranscriptsResponse>(
        joinUrl(baseUrl, "transcripts", "listing.json")
      );
    }
    return transcriptsListing;
  };

  const getScansListing = (): Promise<ScansResponse> => {
    if (!scansListing) {
      scansListing = fetchJson<ScansResponse>(
        joinUrl(baseUrl, "scans", "listing.json")
      );
    }
    return scansListing;
  };

  return {
    capability: "workbench",

    getConfig: (): Promise<AppConfig> =>
      fetchJson<AppConfig>(joinUrl(baseUrl, "config.json")),

    getScanners: (): Promise<ScannersResponse> =>
      fetchJson<ScannersResponse>(joinUrl(baseUrl, "scanners.json")),

    getProjectConfig: (): Promise<{ config: ProjectConfig; etag: string }> =>
      fetchJson(joinUrl(baseUrl, "project-config.json")),

    getActiveScans: (): Promise<ActiveScansResponse> =>
      Promise.resolve({ items: {} }),

    connectTopicUpdates: (
      onUpdate: (topVersions: TopicVersions) => void
    ): (() => void) => {
      fetchJson<TopicVersions>(joinUrl(baseUrl, "topics.json"))
        .then(onUpdate)
        .catch(() => {});
      return () => {};
    },

    // --- Listings (filter/sort/paginate applied client-side) ---

    getTranscripts: async (
      _transcriptsDir: string,
      filter?: Condition,
      orderBy?: OrderByModel | OrderByModel[],
      pagination?: Pagination
    ): Promise<TranscriptsResponse> => {
      const listing = await getTranscriptsListing();
      return applyListingQuery(
        listing.items,
        filter,
        orderBy,
        pagination,
        "transcript_id"
      ) as TranscriptsResponse;
    },

    getScans: async (
      _scansDir: string,
      filter?: Condition,
      orderBy?: OrderByModel | OrderByModel[],
      pagination?: Pagination
    ): Promise<ScansResponse> => {
      const listing = await getScansListing();
      return applyListingQuery(
        listing.items,
        filter,
        orderBy,
        pagination,
        "scan_id"
      ) as ScansResponse;
    },

    getTranscriptsColumnValues: async (
      _transcriptsDir: string,
      column: string,
      filter: Condition | undefined
    ): Promise<ScalarValue[]> => {
      const { items } = await getTranscriptsListing();
      return collectDistinct(filterItems(items, filter), column);
    },

    getScansColumnValues: async (
      _scansDir: string,
      column: string,
      filter: Condition | undefined
    ): Promise<ScalarValue[]> => {
      const { items } = await getScansListing();
      return collectDistinct(filterItems(items, filter), column);
    },

    // --- Single-item reads ---

    hasTranscript: async (
      _transcriptsDir: string,
      id: string
    ): Promise<boolean> => {
      const { items } = await getTranscriptsListing();
      return items.some((info) => info.transcript_id === id);
    },

    getTranscript: async (
      _transcriptsDir: string,
      id: string
    ): Promise<Transcript> => {
      const safe = sanitizeTranscriptId(id);
      const transcriptUrl = joinUrl(baseUrl, "transcripts", safe);
      const [info, parsed] = await Promise.all([
        fetchJson<TranscriptInfo>(joinUrl(transcriptUrl, "info.json")),
        fetchJson<MessagesEventsResponse>(
          joinUrl(transcriptUrl, "messages-events.json")
        ),
      ]);

      const { messages, timelines, attachments } = parsed;
      const events = expandEvents(parsed.events, parsed.events_data ?? null);

      return {
        ...info,
        ...(attachments && Object.keys(attachments).length > 0
          ? {
              messages: resolveAttachments(messages, attachments),
              events: resolveAttachments(events, attachments),
              timelines,
            }
          : { messages, events, timelines }),
      };
    },

    getScan: (_scansDir: string, scanPath: string): Promise<Status> =>
      fetchJson<Status>(joinUrl(baseUrl, "scans", scanPath, "status.json")),

    getScannerDataframe: async (
      _scansDir: string,
      scanPath: string,
      scanner: string,
      _excludeColumns?: string[]
    ): Promise<ArrayBuffer> => {
      const res = await fetchOk(
        joinUrl(baseUrl, "scans", scanPath, "scanners", `${scanner}.arrow`)
      );
      return res.arrayBuffer();
    },

    getScannerDataframeDetail: async (
      _scansDir: string,
      scanPath: string,
      scanner: string,
      uuid: string
    ): Promise<ScanResultDetail> => {
      const parsed = await fetchJson<
        ScannerInputResponse & { scan_events: Event[] }
      >(
        joinUrl(baseUrl, "scans", scanPath, "details", scanner, `${uuid}.json`)
      );
      return {
        input: {
          input_type: parsed.input_type,
          input: expandInputEvents(
            parsed.input,
            parsed.input_type,
            parsed.input_data
          ),
        },
        scanEvents: parsed.scan_events ?? [],
      };
    },

    downloadScan: async (
      _scansDir: string,
      scanPath: string
    ): Promise<Blob> => {
      const res = await fetchOk(
        joinUrl(baseUrl, "scans", scanPath, "archive.zip")
      );
      const data = await res.arrayBuffer();
      return new Blob([data], { type: "application/zip" });
    },

    // --- Validations ---

    getValidationSets: (): Promise<string[]> =>
      fetchJson<string[]>(joinUrl(baseUrl, "validations", "sets.json")),

    getValidationCases: (uri: string): Promise<ValidationCase[]> =>
      fetchJson<ValidationCase[]>(
        joinUrl(baseUrl, "validations", base64UrlEncode(uri), "cases.json")
      ),

    getValidationCase: async (
      uri: string,
      caseId: string
    ): Promise<ValidationCase> => {
      const cases = await fetchJson<ValidationCase[]>(
        joinUrl(baseUrl, "validations", base64UrlEncode(uri), "cases.json")
      );
      const found = cases.find((c) => c.id === caseId);
      if (!found) {
        throw new Error(`Validation case '${caseId}' not found in ${uri}`);
      }
      return found;
    },

    // --- Search / recent (cached results only) ---

    getSearches: (): Promise<SearchInputListResponse> =>
      Promise.resolve({ items: [] }),

    getSearchResult: (
      _transcriptDir: string,
      _transcriptId: string,
      _searchId: string,
      _scope: SearchResultScope
    ): Promise<Result | null> => Promise.resolve(null),

    // --- Mutation methods: always throw in static mode ---

    postCode: (_condition: Condition): Promise<Record<string, string>> =>
      unsupported("postCode"),

    updateProjectConfig: (
      _config: ProjectConfigInput,
      _etag: string | null
    ): Promise<{ config: ProjectConfig; etag: string }> =>
      unsupported("updateProjectConfig"),

    startScan: (_config: ScanJobConfig): Promise<Status> =>
      unsupported("startScan"),

    createValidationSet: (
      _request: CreateValidationSetRequest
    ): Promise<string> => unsupported("createValidationSet"),

    upsertValidationCase: (
      _uri: string,
      _caseId: string,
      _data: ValidationCaseRequest
    ): Promise<ValidationCase> => unsupported("upsertValidationCase"),

    deleteValidationCase: (_uri: string, _caseId: string): Promise<void> =>
      unsupported("deleteValidationCase"),

    deleteValidationSet: (_uri: string): Promise<void> =>
      unsupported("deleteValidationSet"),

    renameValidationSet: (_uri: string, _newName: string): Promise<string> =>
      unsupported("renameValidationSet"),

    postSearch: (
      _transcriptDir: string,
      _transcriptId: string,
      _request: SearchRequest
    ): Promise<SearchResponse> => unsupported("postSearch"),

    storage: NoPersistence,
  };
};

/** Apply filter + orderBy + cursor pagination matching the server semantics. */
const applyListingQuery = (
  rows: readonly object[],
  filter: Condition | undefined,
  orderBy: OrderByModel | OrderByModel[] | undefined,
  pagination: Pagination | undefined,
  idColumn: string
): { items: object[]; total_count: number; next_cursor: object | null } => {
  const filtered = filterItems(rows, filter);
  const ordered = applyOrderBy(filtered as Record<string, unknown>[], orderBy);
  const { items, nextCursor } = applyPagination(
    ordered,
    orderBy,
    pagination,
    idColumn
  );
  return {
    items,
    total_count: filtered.length,
    next_cursor: nextCursor,
  };
};

/** Filter row collection by a Condition; returns all rows if no filter. */
const filterItems = (
  rows: readonly object[],
  filter: Condition | undefined
): object[] => {
  if (!filter) return [...rows];
  return rows.filter((row) =>
    evaluateCondition(row as Record<string, unknown>, filter)
  );
};

/** Compute distinct sorted scalar values for a column across a row collection. */
const collectDistinct = (
  rows: readonly object[],
  column: string
): ScalarValue[] => {
  const seen = new Set<string>();
  const out: ScalarValue[] = [];
  for (const row of rows) {
    const raw = (row as Record<string, unknown>)[column];
    if (raw === undefined) continue;
    const value = raw as ScalarValue;
    const key =
      value === null ? "__null__" : `${typeof value}:${String(value)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  out.sort((a, b) => {
    if (a === b) return 0;
    if (a === null) return -1;
    if (b === null) return 1;
    return a < b ? -1 : 1;
  });
  return out;
};
