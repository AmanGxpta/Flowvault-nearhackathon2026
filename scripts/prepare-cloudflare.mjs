// Generates an ignored owner deployment config; performs no login, remote write or deployment.
import { parseArgs } from "node:util";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname, relative } from "node:path";
const { values } = parseArgs({
  options: {
    "database-id": { type: "string" },
    name: { type: "string", default: "flowvault-demo" },
    out: { type: "string", default: ".wrangler/deploy/wrangler.json" },
  },
});
const id = values["database-id"];
if (
  !id ||
  !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id) ||
  id === "00000000-0000-4000-8000-000000000000"
)
  throw Error(
    "Supply your real owner-created D1 --database-id (not the local placeholder).",
  );
if (!/^[a-z][a-z0-9-]{2,62}$/.test(values.name))
  throw Error("Invalid Worker name.");
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
  name: values.name,
  main: relativePath(config.main),
  assets: {
    ...config.assets,
    directory: relativePath(config.assets.directory),
  },
  d1_databases: [
    { binding: "DB", database_name: values.name, database_id: id },
  ],
  services: [],
  // Monitoring and recurrence (Interface E4): every 30 minutes; reads and proposes only.
  triggers: { crons: ["*/30 * * * *"] },
  observability: { enabled: false },
  vars: {},
};
delete result.dev;
delete result.topLevelName;
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(result, null, 2) + "\n");
console.log(
  "Prepared " +
    relative(process.cwd(), out) +
    "; DB binding set, no secrets, no remote calls.",
);
