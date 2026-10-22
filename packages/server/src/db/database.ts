import fs from "node:fs";
import { fileURLToPath } from "node:url";
import Sqlite from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "./schema.ts";

export type Database = BetterSQLite3Database<typeof schema> & { $client: Sqlite.Database };

const migrationsFolder = fileURLToPath(new URL("../../drizzle", import.meta.url));

/**
 * Opens the SQLite database (a file path or ":memory:") and applies pending migrations. The
 * database file and its WAL and shared-memory files are readable by the owner only; SQLite gives
 * the WAL files the database file's mode.
 */
export function openDatabase(file: string): Database {
  const onDisk = file !== ":memory:";
  if (onDisk) fs.closeSync(fs.openSync(file, "a", 0o600));
  const privateFiles = () => {
    for (const f of [file, `${file}-wal`, `${file}-shm`]) if (fs.existsSync(f)) fs.chmodSync(f, 0o600);
  };
  if (onDisk) privateFiles();
  const sqlite = new Sqlite(file);
  sqlite.pragma("journal_mode = WAL");
  if (onDisk) privateFiles();
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder });
  return db;
}
