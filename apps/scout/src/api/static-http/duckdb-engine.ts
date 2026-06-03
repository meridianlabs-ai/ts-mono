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
  private readonly registeredFiles = new Set<string>();

  async queryObjects(sql: string, params: SqlParam[] = []): Promise<object[]> {
    return fromArrow(await this.queryBytes(sql, params)).objects();
  }

  async queryArrowIpc(
    sql: string,
    params: SqlParam[] = []
  ): Promise<Uint8Array> {
    return this.queryBytes(sql, params);
  }

  async registerHttpFile(name: string, url: string): Promise<void> {
    if (this.registeredFiles.has(name)) return;
    const db = await this.db();
    await db.registerFileURL(
      name,
      absoluteUrl(url),
      duckdb.DuckDBDataProtocol.HTTP,
      true
    );
    this.registeredFiles.add(name);
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

  const worker = new Worker(bundle.mainWorker);
  const db = new duckdb.AsyncDuckDB(new duckdb.ConsoleLogger(), worker);
  await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
  await configureBundledExtensions(db);
  return db;
};

const absoluteUrl = (url: string): string => {
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
