import { fileURLToPath } from "node:url";
import Sqlite from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "./schema.ts";

export type Database = BetterSQLite3Database<typeof schema> & { $client: Sqlite.Database };

const migrationsFolder = fileURLToPath(new URL("../../drizzle", import.meta.url));

/** Opens the SQLite database (a file path or ":memory:") and applies pending migrations. */
export function openDatabase(file: string): Database {
  const sqlite = new Sqlite(file);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder });
  return db;
}
