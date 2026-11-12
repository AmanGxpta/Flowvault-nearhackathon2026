import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
const require = createRequire(import.meta.url);
const hash = (source) => createHash("sha256").update(source).digest("hex");
export function patchMeteorSource(source, entry) {
  if (hash(source) === entry.patchedSha256) return source;
  if (hash(source) !== entry.originalSha256)
    throw new Error(
      "Meteor SDK bytes changed; review the connection-key logging patch before enabling this SDK.",
    );
  const needle = "console.log(accessKey);";
  if (source.split(needle).length !== 2)
    throw new Error("Expected exactly one Meteor connection-key log.");
  const patched = source.replace(
    needle,
    "/* FlowVault: never log a wallet connection key. */",
  );
  if (hash(patched) !== entry.patchedSha256)
    throw new Error("Meteor logging patch failed verification.");
  return patched;
}
export function patchInstalledMeteor() {
  const manifest = JSON.parse(
    readFileSync(
      new URL("./vendor/meteor-sdk-patch.json", import.meta.url),
      "utf8",
    ),
  );
  const meteorRequire = createRequire(
    require.resolve("@near-wallet-selector/meteor-wallet"),
  );
  const packagePath = meteorRequire.resolve("@meteorwallet/sdk/package.json");
  const pkg = JSON.parse(readFileSync(packagePath, "utf8"));
  if (pkg.version !== manifest.version)
    throw new Error(
      "Meteor SDK version changed; review the connection-key logging patch.",
    );
  for (const entry of manifest.files) {
    const path = resolve(dirname(packagePath), entry.path);
    const source = readFileSync(path, "utf8");
    const patched = patchMeteorSource(source, entry);
    if (source !== patched) writeFileSync(path, patched);
  }
}
if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
)
  patchInstalledMeteor();
