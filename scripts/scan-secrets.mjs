// Scans the actual Git submission boundary, including untracked source; never prints secret values.
import { execFileSync, spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  copyFileSync,
  lstatSync,
  rmSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
const root = process.cwd(),
  stage = mkdtempSync(join(tmpdir(), "flowvault-secret-scan-"));
try {
  const files = execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    { encoding: "utf8" },
  )
    .split("\0")
    .filter(Boolean);
  for (const f of files) {
    const source = resolve(root, f);
    if (!source.startsWith(root + "/")) throw Error("Unexpected scan path.");
    if (!existsSync(source)) continue;
    if (lstatSync(source).isSymbolicLink())
      throw Error("Review symlink before publication: " + f);
    mkdirSync(dirname(join(stage, f)), { recursive: true });
    copyFileSync(source, join(stage, f));
  }
  const binary = process.env.GITLEAKS_BIN ?? "gitleaks";
  const result = spawnSync(
    binary,
    [
      "dir",
      stage,
      "--config",
      join(root, ".gitleaks.toml"),
      "--redact=100",
      "--max-decode-depth=2",
      "--report-format=json",
      "--report-path",
      join(tmpdir(), "flowvault-gitleaks-redacted.json"),
    ],
    { stdio: "inherit" },
  );
  if (result.error)
    throw Error(
      "Install gitleaks, or set GITLEAKS_BIN to its executable path.",
    );
  console.log(
    JSON.stringify({
      scannedSubmissionFiles: files.length,
      scope: "tracked plus nonignored untracked working-tree contents",
      report: "OS temporary directory, redacted; never committed",
    }),
  );
  process.exitCode = result.status ?? 1;
} finally {
  rmSync(stage, { recursive: true, force: true });
}
