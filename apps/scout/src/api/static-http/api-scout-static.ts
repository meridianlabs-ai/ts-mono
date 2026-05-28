import type { Condition, OrderByModel } from "../../query";
import {
  ActiveScansResponse,
  AppConfig,
  CreateValidationSetRequest,
  Pagination,
  ProjectConfig,
  ProjectConfigInput,
  Result,
  ScanJobConfig,
  ScannersResponse,
  ScansResponse,
  SearchInputListResponse,
  SearchRequest,
  SearchResponse,
  Status,
  Transcript,
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

const unsupported = <T>(op: string): Promise<T> =>
  Promise.reject(new StaticBundleError(op));

export const apiScoutStatic = (
  context: StaticBundleContext = {}
): ScoutApiV2 => {
  const baseUrl = context.bundleBaseUrl ?? "./api";

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
      // Fire once with frozen topic versions from the bundle, then never update.
      fetchJson<TopicVersions>(joinUrl(baseUrl, "topics.json"))
        .then(onUpdate)
        .catch(() => {
          // Bundle may omit topics.json; that's fine — caller will use stale data.
        });
      return () => {};
    },

    // --- Stubs to be implemented in subsequent commits ---

    getTranscripts: (
      _transcriptsDir: string,
      _filter?: Condition,
      _orderBy?: OrderByModel | OrderByModel[],
      _pagination?: Pagination
    ): Promise<TranscriptsResponse> => unsupported("getTranscripts"),

    hasTranscript: (_transcriptsDir: string, _id: string): Promise<boolean> =>
      unsupported("hasTranscript"),

    getTranscript: (
      _transcriptsDir: string,
      _id: string
    ): Promise<Transcript> => unsupported("getTranscript"),

    getTranscriptsColumnValues: (
      _transcriptsDir: string,
      _column: string,
      _filter: Condition | undefined
    ): Promise<ScalarValue[]> => unsupported("getTranscriptsColumnValues"),

    getScans: (
      _scansDir: string,
      _filter?: Condition,
      _orderBy?: OrderByModel | OrderByModel[],
      _pagination?: Pagination
    ): Promise<ScansResponse> => unsupported("getScans"),

    getScansColumnValues: (
      _scansDir: string,
      _column: string,
      _filter: Condition | undefined
    ): Promise<ScalarValue[]> => unsupported("getScansColumnValues"),

    getScan: (_scansDir: string, _scanPath: string): Promise<Status> =>
      unsupported("getScan"),

    getScannerDataframe: (
      _scansDir: string,
      _scanPath: string,
      _scanner: string,
      _excludeColumns?: string[]
    ): Promise<ArrayBuffer | Uint8Array> => unsupported("getScannerDataframe"),

    getScannerDataframeDetail: (
      _scansDir: string,
      _scanPath: string,
      _scanner: string,
      _uuid: string
    ): Promise<ScanResultDetail> => unsupported("getScannerDataframeDetail"),

    getValidationSets: (): Promise<string[]> =>
      unsupported("getValidationSets"),

    getValidationCases: (_uri: string): Promise<ValidationCase[]> =>
      unsupported("getValidationCases"),

    getValidationCase: (
      _uri: string,
      _caseId: string
    ): Promise<ValidationCase> => unsupported("getValidationCase"),

    getSearches: (
      _searchType: SearchRequest["type"],
      _count: number
    ): Promise<SearchInputListResponse> => unsupported("getSearches"),

    getSearchResult: (
      _transcriptDir: string,
      _transcriptId: string,
      _searchId: string,
      _scope: SearchResultScope
    ): Promise<Result | null> => unsupported("getSearchResult"),

    downloadScan: (_scansDir: string, _scanPath: string): Promise<Blob> =>
      unsupported("downloadScan"),

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
