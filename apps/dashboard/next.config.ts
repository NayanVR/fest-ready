import { readFileSync } from "node:fs";

// Dev convenience: copy only the dashboard's own vars from the repo-root .env.
// In the cluster they come from the Deployment env, and the file doesn't exist.
try {
  for (const line of readFileSync("../../.env", "utf8").split("\n")) {
    const m = line.match(/^(ADMIN_SECRET|CONTROLLER_URL|SHOP_URL|DEMO_PROVIDERS)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
} catch {}

export default { agentRules: false }; // stop `next dev` re-creating apps/dashboard/AGENTS.md (repo root has the only one)
