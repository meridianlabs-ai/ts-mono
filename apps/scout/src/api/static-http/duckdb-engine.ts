import * as duckdb from "@duckdb/duckdb-wasm";
import duckdbEhWorker from "@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js?url";
import duckdbMvpWorker from "@duckdb/duckdb-wasm/dist/duckdb-browser-mvp.worker.js?url";
import duckdbEhWasm from "@duckdb/duckdb-wasm/dist/duckdb-eh.wasm?url";
import duckdbMvpWasm from "@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm?url";
import { fromArrow } from "arquero";

import type { SqlParam } from "./condition-sql";

export class StaticDuckDB {
  private dbPromise: Promise<duckdb.AsyncDuckDB> | undefined;
  private connectionPromise: Promise<duckdb.AsyncDuckDBConnection> | undefined;

  async queryObjects(sql: string, params: SqlParam[] = []): Promise<object[]> {
    return fromArrow(await this.queryBytes(sql, params)).objects();
  }

  async queryArrowIpc(
    sql: string,
    params: SqlParam[] = []
  ): Promise<Uint8Array> {
    return this.queryBytes(sql, params);
  }

  private async queryBytes(
    sql: string,
    params: SqlParam[]
  ): Promise<Uint8Array> {
    const connection = await this.connection();
    if (params.length === 0) {
      return connection.useUnsafe((bindings, conn) =>
        bindings.runQuery(conn, sql)
      );
    }

    const statementId = await connection.useUnsafe((bindings, conn) =>
      bindings.createPrepared(conn, sql)
    );
    try {
      return await connection.useUnsafe((bindings, conn) =>
        bindings.runPrepared(conn, statementId, params)
      );
    } finally {
      await connection.useUnsafe((bindings, conn) =>
        bindings.closePrepared(conn, statementId)
      );
    }
  }

  private connection(): Promise<duckdb.AsyncDuckDBConnection> {
    if (!this.connectionPromise) {
      this.connectionPromise = this.db().then((db) => db.connect());
    }
    return this.connectionPromise;
  }

  private async db(): Promise<duckdb.AsyncDuckDB> {
    if (!this.dbPromise) {
      this.dbPromise = createDuckDB();
    }
    return this.dbPromise;
  }
}

const createDuckDB = async (): Promise<duckdb.AsyncDuckDB> => {
  const bundle = await duckdb.selectBundle({
    mvp: {
      mainModule: duckdbMvpWasm,
      mainWorker: duckdbMvpWorker,
    },
    eh: {
      mainModule: duckdbEhWasm,
      mainWorker: duckdbEhWorker,
    },
  });

  if (!bundle.mainWorker) {
    throw new Error("DuckDB-WASM selected a bundle without a browser worker");
  }

  // Wrap the DuckDB worker in a thin shim that forces ranged (identity)
  // responses for Parquet reads — see duckdb-range.worker.ts. The real DuckDB
  // worker URL is handed to the shim via the Worker `name` option, which it
  // loads with importScripts.
  const realWorkerUrl = new URL(bundle.mainWorker, window.location.href).href;
  const worker = new Worker(
    new URL("./duckdb-range.worker.ts", import.meta.url),
    { type: "classic", name: realWorkerUrl }
  );
  const db = new duckdb.AsyncDuckDB(new duckdb.ConsoleLogger(), worker);
  await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
  await configureBundledExtensions(db);
  return db;
};

export const absoluteUrl = (url: string): string => {
  if (typeof window === "undefined") return url;
  return new URL(url, window.location.href).href;
};

const configureBundledExtensions = async (
  db: duckdb.AsyncDuckDB
): Promise<void> => {
  const connection = await db.connect();
  try {
    await runSql(
      connection,
      `SET custom_extension_repository = ${sqlStringLiteral(
        extensionRepositoryUrl()
      )}`
    );
    // Load httpfs so that read_parquet('http://…') reads via HTTP range
    // requests (footer + only the needed column chunks) instead of the JS
    // runtime's whole-file buffering. The extension is vendored alongside
    // parquet under the custom repository.
    await runSql(connection, "INSTALL httpfs");
    await runSql(connection, "LOAD httpfs");
    // Cache Parquet footers and HTTP file metadata across queries. Every static
    // query wraps the catalog/data file in a fresh read_parquet(url), so without
    // these each query re-issues a HEAD (file size) plus a footer range read
    // before touching column data. These caches are database-global, so the
    // long-lived query connection reuses the parsed footer and discovered size.
    await runSql(connection, "SET enable_object_cache=true");
    await runSql(connection, "SET enable_http_metadata_cache=true");
  } finally {
    await connection.close();
  }
};

const runSql = (
  connection: duckdb.AsyncDuckDBConnection,
  sql: string
): Promise<Uint8Array> =>
  connection.useUnsafe((bindings, conn) => bindings.runQuery(conn, sql));

const extensionRepositoryUrl = (): string => {
  if (typeof window === "undefined") {
    return "./duckdb-extensions";
  }
  return new URL("./duckdb-extensions", window.location.href).href.replace(
    /\/$/,
    ""
  );
};

const sqlStringLiteral = (value: string): string =>
  `'${value.replace(/'/g, "''")}'`;
