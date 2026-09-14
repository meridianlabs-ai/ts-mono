import type { Event } from "@tsmono/inspect-common/types";
import { expandEvents } from "@tsmono/inspect-common/utils";
import { encodeBase64Url } from "@tsmono/util";

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

import type { BundleManifest, CatalogManifest } from "./bundle-format";
import { kBundleFormatName, kBundleFormatVersion } from "./bundle-format";
import { StaticCatalog } from "./catalog";
import {
  fetchBytes,
  fetchJson,
  fetchJsonZst,
  joinUrl,
  urlExists,
} from "./fetch";

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
}

/** Combined per-transcript file: listing info plus full content. */
type TranscriptFile = MessagesEventsResponse & { info: TranscriptInfo };

type ScanDetailFile = ScannerInputResponse & { scan_events?: Event[] };

const unsupported = <T>(op: string): Promise<T> =>
  Promise.reject(new StaticBundleError(op));

/** Mirror the Python bundler's filesystem-safe transcript id encoding. */
const sanitizeTranscriptId = (id: string): string => id.replace(/[/\\]/g, "_");

/** Constant topic versions for the one-and-only static bundle "update". */
const kStaticTopicVersions: TopicVersions = {
  "project-config": "static",
  scans: "static",
  transcripts: "static",
};

export const apiScoutStatic = (
  context: StaticBundleContext = {}
): ScoutApiV2 => {
  const baseUrl = context.bundleBaseUrl ?? "./api";

  let manifestPromise: Promise<BundleManifest> | undefined;
  const getManifest = (): Promise<BundleManifest> => {
    if (!manifestPromise) {
      manifestPromise = fetchJson<BundleManifest>(
        joinUrl(baseUrl, "manifest.json")
      )
        .then((manifest) => {
          if (
            manifest.format !== kBundleFormatName ||
            manifest.version > kBundleFormatVersion
          ) {
            throw new Error(
              `Unsupported bundle manifest (format=${manifest.format}, ` +
                `version=${manifest.version}); this viewer supports ` +
                `${kBundleFormatName} <= ${kBundleFormatVersion}.`
            );
          }
          return manifest;
        })
        .catch((err: unknown) => {
          // Evict on failure so a transient fetch error isn't cached forever;
          // an unsupported-version rejection will simply recur on retry.
          manifestPromise = undefined;
          throw err;
        });
    }
    return manifestPromise;
  };

  const catalogs = new Map<string, StaticCatalog>();
  const getCatalog = async (
    kind: "transcripts" | "scans"
  ): Promise<StaticCatalog> => {
    let catalog = catalogs.get(kind);
    if (!catalog) {
      const manifest = await getManifest();
      const section: CatalogManifest | undefined = manifest[kind];
      if (!section) {
        throw new Error(`Bundle contains no ${kind} catalog`);
      }
      catalog = catalogs.get(kind) ?? new StaticCatalog(baseUrl, section);
      catalogs.set(kind, catalog);
    }
    return catalog;
  };

  const transcriptUrl = (id: string): string =>
    joinUrl(
      baseUrl,
      "transcripts",
      "items",
      `${sanitizeTranscriptId(id)}.json.zst`
    );

  const scanUrl = (scanPath: string, ...parts: string[]): string =>
    joinUrl(baseUrl, "scans", "items", encodeBase64Url(scanPath), ...parts);

  return {
    readOnly: true,
    capability: "workbench",

    getConfig: (): Promise<AppConfig> =>
      fetchJson<AppConfig>(joinUrl(baseUrl, "config.json")),

    getScanners: (): Promise<ScannersResponse> =>
      fetchJson<ScannersResponse>(joinUrl(baseUrl, "scanners.json")).catch(
        () => ({ items: [] })
      ),

    getProjectConfig: (): Promise<{ config: ProjectConfig; etag: string }> =>
      fetchJson<ProjectConfig>(joinUrl(baseUrl, "project-config.json")).then(
        (config) => ({ config, etag: "" })
      ),

    getActiveScans: (): Promise<ActiveScansResponse> =>
      Promise.resolve({ items: {} }),

    // Nothing changes in a static snapshot, so no invalidations are ever
    // signaled — but the app gates rendering on the first update, so emit
    // one constant snapshot of versions to unblock it.
    connectTopicUpdates: (
      onUpdate: (topVersions: TopicVersions) => void
    ): (() => void) => {
      let cancelled = false;
      queueMicrotask(() => {
        if (!cancelled) {
          onUpdate(kStaticTopicVersions);
        }
      });
      return () => {
        cancelled = true;
      };
    },

    // --- Listings (filter/sort/paginate applied client-side) ---

    getTranscripts: async (
      _transcriptsDir: string,
      filter?: Condition,
      orderBy?: OrderByModel | OrderByModel[],
      pagination?: Pagination
    ): Promise<TranscriptsResponse> => {
      const catalog = await getCatalog("transcripts");
      return (await catalog.query(
        filter,
        orderBy,
        pagination
      )) as TranscriptsResponse;
    },

    getScans: async (
      _scansDir: string,
      filter?: Condition,
      orderBy?: OrderByModel | OrderByModel[],
      pagination?: Pagination
    ): Promise<ScansResponse> => {
      const catalog = await getCatalog("scans");
      return (await catalog.query(
        filter,
        orderBy,
        pagination
      )) as ScansResponse;
    },

    getTranscriptsColumnValues: async (
      _transcriptsDir: string,
      column: string,
      filter: Condition | undefined
    ): Promise<ScalarValue[]> =>
      (await getCatalog("transcripts")).distinct(column, filter),

    getScansColumnValues: async (
      _scansDir: string,
      column: string,
      filter: Condition | undefined
    ): Promise<ScalarValue[]> =>
      (await getCatalog("scans")).distinct(column, filter),

    // --- Single-item reads (O(1); no catalog load) ---

    hasTranscript: (_transcriptsDir: string, id: string): Promise<boolean> =>
      urlExists(transcriptUrl(id)),

    getTranscript: async (
      _transcriptsDir: string,
      id: string
    ): Promise<Transcript> => {
      const parsed = await fetchJsonZst<TranscriptFile>(transcriptUrl(id));

      const { info, messages, timelines, attachments } = parsed;
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
      fetchJson<Status>(scanUrl(scanPath, "status.json")),

    getScannerDataframe: (
      _scansDir: string,
      scanPath: string,
      scanner: string,
      _excludeColumns?: string[]
    ): Promise<ArrayBuffer> =>
      fetchBytes(
        scanUrl(scanPath, "scanners", `${encodeURIComponent(scanner)}.arrow`)
      ),

    getScannerDataframeDetail: async (
      _scansDir: string,
      scanPath: string,
      scanner: string,
      uuid: string
    ): Promise<ScanResultDetail> => {
      const parsed = await fetchJsonZst<ScanDetailFile>(
        scanUrl(
          scanPath,
          "details",
          encodeURIComponent(scanner),
          `${encodeURIComponent(uuid)}.json.zst`
        )
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

    // --- Search / validation: hidden in static bundles ---

    getSearches: (
      _searchType: SearchRequest["type"],
      _count: number
    ): Promise<SearchInputListResponse> => Promise.resolve({ items: [] }),

    getSearchResult: (
      _transcriptDir: string,
      _transcriptId: string,
      _searchId: string,
      _scope: SearchResultScope
    ): Promise<Result | null> => Promise.resolve(null),

    getValidationSets: (): Promise<string[]> => Promise.resolve([]),

    getValidationCases: (_uri: string): Promise<ValidationCase[]> =>
      Promise.resolve([]),

    getValidationCase: (
      _uri: string,
      _caseId: string
    ): Promise<ValidationCase> => unsupported("getValidationCase"),

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
