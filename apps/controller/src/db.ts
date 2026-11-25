import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export function openDb(path = process.env.DB_PATH || "./data/controller.db"): Database {
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path, { create: true, strict: true });
  db.run("PRAGMA journal_mode = WAL");
  db.run("PRAGMA busy_timeout = 5000");
  db.run(`CREATE TABLE IF NOT EXISTS playbooks (
    id TEXT PRIMARY KEY, version INTEGER NOT NULL, body TEXT NOT NULL, updated_at TEXT NOT NULL)`);
  return db;
}
