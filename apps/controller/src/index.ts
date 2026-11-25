import { openDb } from "./db.ts";
import { log } from "./log.ts";
import { seedPlaybooks } from "./playbooks.ts";

const db = openDb();
const seeded = seedPlaybooks(db);
const port = Number(process.env.PORT || 4100);

Bun.serve({
  port,
  routes: {
    "/healthz": () => Response.json({ ok: true }),
  },
  fetch: () => Response.json({ error: "NOT_FOUND", message: "no such route" }, { status: 404 }),
});
log("info", "controller listening", { port, seededPlaybooks: seeded });
