import type { Event } from "@tsmono/inspect-common/types";
import { expandEvents } from "@tsmono/inspect-common/utils";
import { asyncJsonParse } from "@tsmono/util";

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
  ScanRow,
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
import { expandInputEvents } from "../expandInputEvents";

import {
  buildListingSql,
  conditionToSql,
  limitParams,
  quoteIdentifier,
  quoteLiteral,
} from "./condition-sql";
import { absoluteUrl, StaticDuckDB } from "./duckdb-engine";

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

interface ScanCatalogRow {
  bundleId: string;
  statusPath: string;
  scannerPaths: Record<string, string>;
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
  return asyncJsonParse<T>(await res.text());
};

const unsupported = <T>(op: string): Promise<T> =>
  Promise.reject(new StaticBundleError(op));

export const apiScoutStatic = (
  context: StaticBundleContext = {}
): ScoutApiV2 => {
  const baseUrl = context.bundleBaseUrl ?? "./api";
  const db = new StaticDuckDB();

  // Query catalogs by their absolute http(s) URL so DuckDB reads them through
  // httpfs (HEAD + ranged column-chunk GETs) rather than buffering the whole
  // file via registerFileURL. Keeps listing/filtering scalable as catalogs grow.
  const transcriptsCatalog = absoluteUrl(
    joinUrl(baseUrl, "transcripts", "catalog.parquet")
  );
  const scansCatalog = absoluteUrl(
    joinUrl(baseUrl, "scans", "catalog.parquet")
  );

  return {
    capability: "workbench",
    readOnly: true,

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

    getTranscripts: async (
      _transcriptsDir: string,
      filter?: Condition,
      orderBy?: OrderByModel | OrderByModel[],
      pagination?: Pagination
    ): Promise<TranscriptsResponse> => {
      return queryCatalogListing<TranscriptInfo>(
        db,
        transcriptsCatalog,
        "transcript_id",
        filter,
        orderBy,
        pagination
      );
    },

    getScans: async (
      _scansDir: string,
      filter?: Condition,
      orderBy?: OrderByModel | OrderByModel[],
      pagination?: Pagination
    ): Promise<ScansResponse> => {
      return queryCatalogListing<ScanRow>(
        db,
        scansCatalog,
        "scan_id",
        filter,
        orderBy,
        pagination
      );
    },

    getTranscriptsColumnValues: async (
      _transcriptsDir: string,
      column: string,
      filter: Condition | undefined
    ): Promise<ScalarValue[]> => {
      return queryDistinct(db, transcriptsCatalog, column, filter);
    },

    getScansColumnValues: async (
      _scansDir: string,
      column: string,
      filter: Condition | undefined
    ): Promise<ScalarValue[]> => {
      return queryDistinct(db, scansCatalog, column, filter);
    },

    hasTranscript: async (
      _transcriptsDir: string,
      id: string
    ): Promise<boolean> => {
      const rows = await db.queryObjects(
        `SELECT COUNT(*) AS total_count FROM ${catalogTable(
          transcriptsCatalog
        )} WHERE "transcript_id" = ?`,
        [id]
      );
      return numberField(firstRow(rows), "total_count") > 0;
    },

    getTranscript: async (
      _transcriptsDir: string,
      id: string
    ): Promise<Transcript> => {
      const rows = await db.queryObjects(
        `SELECT row_json, content_file FROM ${catalogTable(
          transcriptsCatalog
        )} WHERE "transcript_id" = ? LIMIT 1`,
        [id]
      );
      const row = firstRow(rows, `Transcript '${id}' not found`);
      const info = await asyncJsonParse<TranscriptInfo>(
        stringField(row, "row_json")
      );

      // Open the transcript's content from the native parquet via httpfs range
      // reads (HEAD + ranged column-chunk GETs). Attachments are inlined at
      // write time, so no attachment resolution is needed here.
      const url = absoluteUrl(
        joinUrl(baseUrl, stringField(row, "content_file"))
      );
      const contentRows = await db.queryObjects(
        `SELECT messages, events, events_data, timelines FROM ${catalogTable(
          url
        )} WHERE "transcript_id" = ? LIMIT 1`,
        [id]
      );
      const content = firstRow(
        contentRows,
        `Transcript content '${id}' not found`
      );

      const messages = await asyncJsonParse<MessagesEventsResponse["messages"]>(
        stringField(content, "messages")
      );
      const rawEvents =
        (await parseOptionalJson<MessagesEventsResponse["events"]>(
          content,
          "events"
        )) ?? [];
      const eventsData = await parseOptionalJson<
        MessagesEventsResponse["events_data"]
      >(content, "events_data");
      const timelines = await parseOptionalJson<
        MessagesEventsResponse["timelines"]
      >(content, "timelines");
      const events = expandEvents(rawEvents, eventsData ?? null);

      return {
        ...info,
        messages,
        events,
        timelines: timelines ?? [],
      };
    },

    getScan: async (_scansDir: string, scanPath: string): Promise<Status> => {
      const row = await lookupScanCatalogRow(db, scansCatalog, scanPath);
      return fetchJson<Status>(joinUrl(baseUrl, row.statusPath));
    },

    getScannerDataframe: async (
      _scansDir: string,
      scanPath: string,
      scanner: string,
      excludeColumns?: string[]
    ): Promise<Uint8Array> => {
      const parquetUrl = scannerParquetUrl(
        baseUrl,
        await lookupScanCatalogRow(db, scansCatalog, scanPath),
        scanner
      );
      const projection = scannerProjection(excludeColumns);
      return db.queryArrowIpc(
        `SELECT ${projection} FROM ${catalogTable(parquetUrl)}`
      );
    },

    getScannerDataframeDetail: async (
      _scansDir: string,
      scanPath: string,
      scanner: string,
      uuid: string
    ): Promise<ScanResultDetail> => {
      const parquetUrl = scannerParquetUrl(
        baseUrl,
        await lookupScanCatalogRow(db, scansCatalog, scanPath),
        scanner
      );
      const rows = await db.queryObjects(
        `SELECT * FROM ${catalogTable(parquetUrl)} WHERE "uuid" = ? LIMIT 1`,
        [uuid]
      );
      const row = firstRow(rows, `No row found for uuid: ${uuid}`);
      const inputType = scannerInputType(row);
      const input = await asyncJsonParse<ScannerInputResponse["input"]>(
        stringField(row, "input")
      );
      const inputData = await parseOptionalJson<
        ScannerInputResponse["input_data"]
      >(row, "input_data");
      const scanEvents =
        (await parseOptionalJson<Event[]>(row, "scan_events")) ?? [];

      return {
        input: {
          input_type: inputType,
          input: expandInputEvents(input, inputType, inputData ?? null),
        },
        scanEvents,
      };
    },

    getValidationSets: (): Promise<string[]> => Promise.resolve([]),

    getValidationCases: (_uri: string): Promise<ValidationCase[]> =>
      unsupported("getValidationCases"),

    getValidationCase: async (
      _uri: string,
      _caseId: string
    ): Promise<ValidationCase> => {
      return unsupported("getValidationCase");
    },

    getSearches: (): Promise<SearchInputListResponse> =>
      Promise.resolve({ items: [] }),

    getSearchResult: (
      _transcriptDir: string,
      _transcriptId: string,
      _searchId: string,
      _scope: SearchResultScope
    ): Promise<Result | null> => Promise.resolve(null),

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

const queryCatalogListing = async <T extends object>(
  db: StaticDuckDB,
  catalogName: string,
  idColumn: string,
  filter: Condition | undefined,
  orderBy: OrderByModel | OrderByModel[] | undefined,
  pagination: Pagination | undefined
): Promise<{
  items: T[];
  total_count: number;
  next_cursor: Record<string, ScalarValue> | null;
}> => {
  const listingSql = buildListingSql(filter, orderBy, pagination, idColumn);
  const table = catalogTable(catalogName);
  const countWhere = listingSql.countWhere
    ? ` WHERE ${listingSql.countWhere.sql}`
    : "";
  const rowsWhere = listingSql.where ? ` WHERE ${listingSql.where.sql}` : "";

  const [countRows, rows] = await Promise.all([
    db.queryObjects(
      `SELECT COUNT(*) AS total_count FROM ${table}${countWhere}`,
      listingSql.countWhere?.params ?? []
    ),
    db.queryObjects(
      `SELECT row_json FROM ${table}${rowsWhere}${listingSql.orderBy}${listingSql.limit}`,
      [...(listingSql.where?.params ?? []), ...limitParams(pagination)]
    ),
  ]);

  const items = await Promise.all(
    rows.map((row) => asyncJsonParse<T>(stringField(row, "row_json")))
  );
  if (listingSql.needsReverse) {
    items.reverse();
  }

  const edgeItem =
    pagination && items.length === pagination.limit
      ? pagination.direction === "forward"
        ? items.at(-1)
        : items[0]
      : undefined;
  const nextCursor = edgeItem
    ? buildCursor(edgeItem, listingSql.orderColumns)
    : null;

  return {
    items,
    total_count: numberField(firstRow(countRows), "total_count"),
    next_cursor: nextCursor,
  };
};

const queryDistinct = async (
  db: StaticDuckDB,
  catalogName: string,
  column: string,
  filter: Condition | undefined
): Promise<ScalarValue[]> => {
  const table = catalogTable(catalogName);
  const where = filter ? buildListingWhere(filter) : null;
  const whereClause = where ? ` WHERE ${where.sql}` : "";
  const columnSql = quoteIdentifier(column);
  const rows = await db.queryObjects(
    `SELECT DISTINCT ${columnSql} AS value FROM ${table}${whereClause} ORDER BY ${columnSql} ASC`,
    where?.params ?? []
  );
  return rows.map((row) => scalarValue(objectField(row, "value")));
};

const buildListingWhere = (filter: Condition) => conditionToSql(filter);

const lookupScanCatalogRow = async (
  db: StaticDuckDB,
  scansCatalog: string,
  scanPath: string
): Promise<ScanCatalogRow> => {
  const rows = await db.queryObjects(
    `SELECT bundle_id, status_path, scanner_paths_json FROM ${catalogTable(
      scansCatalog
    )} WHERE "static_path" = ? OR "scan_id" = ? OR "location" = ? LIMIT 1`,
    [scanPath, scanPath, scanPath]
  );
  const row = firstRow(rows, `Scan '${scanPath}' not found`);
  return {
    bundleId: stringField(row, "bundle_id"),
    statusPath: stringField(row, "status_path"),
    scannerPaths: await asyncJsonParse<Record<string, string>>(
      stringField(row, "scanner_paths_json")
    ),
  };
};

const scannerParquetUrl = (
  baseUrl: string,
  scan: ScanCatalogRow,
  scanner: string
): string => {
  const scannerPath = scan.scannerPaths[scanner];
  if (!scannerPath) {
    throw new Error(
      `Scanner '${scanner}' not found in scan '${scan.bundleId}'`
    );
  }
  // Use the fully-qualified URL so DuckDB reads it via httpfs (HTTP range
  // requests) rather than registering it as a whole-file buffer. This lets
  // column-pruning (SELECT … EXCLUDE) skip unneeded column chunks over the wire.
  return absoluteUrl(joinUrl(baseUrl, scannerPath));
};

const scannerProjection = (excludeColumns: string[] | undefined): string => {
  const excluded = (excludeColumns ?? [])
    .map((column) => column.trim())
    .filter((column) => column.length > 0);
  if (excluded.length === 0) return "*";
  return `* EXCLUDE (${excluded.map(quoteIdentifier).join(", ")})`;
};

const catalogTable = (catalogName: string): string =>
  `read_parquet(${quoteLiteral(catalogName)})`;

const buildCursor = <T extends object>(
  row: T,
  orderColumns: OrderByModel[]
): Record<string, ScalarValue> => {
  const cursor: Record<string, ScalarValue> = {};
  for (const ob of orderColumns) {
    cursor[ob.column] = scalarValue(objectField(row, ob.column));
  }
  return cursor;
};

const parseOptionalJson = async <T>(
  row: object,
  column: string
): Promise<T | null> => {
  const raw = objectField(row, column);
  if (raw === null || raw === undefined || raw === "") return null;
  if (typeof raw !== "string") {
    throw new Error(`Expected JSON string column '${column}'`);
  }
  return asyncJsonParse<T>(raw);
};

const firstRow = (
  rows: object[],
  error = "Expected at least one row"
): object => {
  const row = rows[0];
  if (!row) throw new Error(error);
  return row;
};

const objectField = (row: object, field: string): unknown => {
  for (const [key, value] of Object.entries(row)) {
    if (key === field) return value;
  }
  return undefined;
};

const stringField = (row: object, field: string): string => {
  const value = objectField(row, field);
  if (typeof value !== "string") {
    throw new Error(`Expected string field '${field}'`);
  }
  return value;
};

const numberField = (row: object, field: string): number => {
  const value = objectField(row, field);
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  throw new Error(`Expected numeric field '${field}'`);
};

const scalarValue = (value: unknown): ScalarValue => {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (value === undefined) return null;
  throw new Error(`Expected scalar value, received ${typeof value}`);
};

const scannerInputType = (row: object): ScannerInputResponse["input_type"] => {
  const value = stringField(row, "input_type");
  if (
    value === "transcript" ||
    value === "event" ||
    value === "events" ||
    value === "message" ||
    value === "messages" ||
    value === "timeline" ||
    value === "timelines"
  ) {
    return value;
  }
  throw new Error(`Unsupported scanner input type: ${value}`);
};
