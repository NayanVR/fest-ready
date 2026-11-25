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
  db.run(`CREATE TABLE IF NOT EXISTS incidents (
    n INTEGER PRIMARY KEY AUTOINCREMENT,
    alert TEXT NOT NULL, state TEXT NOT NULL, owner TEXT, playbook TEXT, value TEXT,
    split INTEGER NOT NULL DEFAULT 0,
    step_started_at INTEGER,  -- current canary step start (ms)
    fallback_at INTEGER,      -- latest approve or rollback (ms): probes count from here
    rolled_back_at INTEGER,   -- latest rollback (ms): cooldown start
    opened_at TEXT NOT NULL, mitigated_at TEXT, resolved_at TEXT, closed_at TEXT, close_note TEXT)`);
  db.run(`CREATE TABLE IF NOT EXISTS findings (
    id INTEGER PRIMARY KEY AUTOINCREMENT, incident INTEGER NOT NULL,
    source TEXT NOT NULL, playbook TEXT, value TEXT, cause TEXT NOT NULL,
    summary TEXT NOT NULL, evidence TEXT NOT NULL, nubi_url TEXT, submitted_at TEXT NOT NULL)`);
  // Raw order events, read only through the playbook's `events` field names.
  // ponytail: kept forever (emptyDir DB is reset per demo); add a retention DELETE if it grows
  db.run(`CREATE TABLE IF NOT EXISTS order_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT, received_at INTEGER NOT NULL, body TEXT NOT NULL)`);
  db.run("CREATE INDEX IF NOT EXISTS order_events_received ON order_events(received_at)");
  db.run(`CREATE TABLE IF NOT EXISTS probe_results (
    id INTEGER PRIMARY KEY AUTOINCREMENT, incident INTEGER NOT NULL, ts INTEGER NOT NULL,
    ok INTEGER NOT NULL, status INTEGER, error TEXT)`);
  db.run(`CREATE TABLE IF NOT EXISTS audit (
    id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL, incident INTEGER,
    actor TEXT NOT NULL, action TEXT NOT NULL, before TEXT, after TEXT, read_back TEXT, result TEXT NOT NULL)`);
  return db;
}
