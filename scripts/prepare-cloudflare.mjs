// Generates an ignored owner deployment config; performs no login, remote write or deployment.
// Flags override environment variables (used by `npm run deploy` and CI):
//   --database-id  FLOWVAULT_D1_DATABASE_ID  the owner-created D1 database UUID (required)
//   --name         FLOWVAULT_WORKER_NAME     Worker name (default flowvault-app)
//   --domain       FLOWVAULT_DOMAIN          optional custom domain, e.g. app.flowvault.live; its zone must
//                                            already be active on Cloudflare, or the deploy fails
import { parseArgs } from "node:util";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname, relative } from "node:path";
const { values } = parseArgs({
  options: {
    "database-id": { type: "string" },
    name: { type: "string" },
    domain: { type: "string" },
    out: { type: "string", default: ".wrangler/deploy/wrangler.json" },
  },
});
const env = (k) => (process.env[k] ?? "").trim() || undefined;
const id = values["database-id"] ?? env("FLOWVAULT_D1_DATABASE_ID");
const name = values.name ?? env("FLOWVAULT_WORKER_NAME") ?? "flowvault-app";
const domain = (values.domain ?? env("FLOWVAULT_DOMAIN") ?? "").toLowerCase() || null;
if (
  !id ||
  !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id) ||
  id === "00000000-0000-4000-8000-000000000000"
)
  throw Error(
    "Supply your real owner-created D1 --database-id or FLOWVAULT_D1_DATABASE_ID (not the local placeholder).",
  );
if (!/^[a-z][a-z0-9-]{2,62}$/.test(name))
  throw Error("Invalid Worker name.");
if (domain && !/^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain))
  throw Error("Invalid --domain / FLOWVAULT_DOMAIN: give a bare hostname such as app.flowvault.live.");
const built = resolve("dist/server/wrangler.json");
const config = JSON.parse(readFileSync(built, "utf8"));
if (config.main !== "index.js" || !config.no_bundle)
  throw Error("Unexpected built Worker shape. Inspect before deployment.");
const out = resolve(values.out);
if (!out.startsWith(resolve(".wrangler") + "/"))
  throw Error("Deployment config must stay inside ignored .wrangler/.");
const relativePath = (p) => relative(dirname(out), resolve(dirname(built), p));
const result = {
  ...config,
  name,
  main: relativePath(config.main),
  assets: {
    ...config.assets,
    directory: relativePath(config.assets.directory),
  },
  d1_databases: [
    { binding: "DB", database_name: name, database_id: id },
  ],
  services: [],
  // Monitoring and recurrence (Interface E4): every 30 minutes; reads and proposes only.
  triggers: { crons: ["*/30 * * * *"] },
  observability: { enabled: false },
  vars: {},
  // The custom domain is declared here so every deploy keeps it (Cloudflare creates its DNS record and certificate).
  ...(domain ? { routes: [{ pattern: domain, custom_domain: true }] } : {}),
};
delete result.route;
if (!domain) delete result.routes;
delete result.dev;
delete result.topLevelName;
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(result, null, 2) + "\n");
console.log(
  "Prepared " +
    relative(process.cwd(), out) +
    " for Worker " + name +
    (domain ? " on " + domain : " (workers.dev only)") +
    "; DB binding set, no secrets, no remote calls.",
);
