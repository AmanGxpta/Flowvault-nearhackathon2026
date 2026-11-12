// Syntax-check real README fences with pinned Mermaid, without rendering, hosting or browser use.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
const root =
  process.env.MERMAID_VALIDATOR_ROOT ??
  join(tmpdir(), "flowvault-mermaid-validator");
const { JSDOM } = await import(
  pathToFileURL(join(root, "node_modules/jsdom/lib/api.js")).href
);
const dom = new JSDOM("<!doctype html><html><body></body></html>");
globalThis.window = dom.window;
globalThis.document = dom.window.document;
const { default: mermaid } = await import(
  pathToFileURL(join(root, "node_modules/mermaid/dist/mermaid.esm.mjs")).href
);
mermaid.initialize({ startOnLoad: false, securityLevel: "strict" });
const readme = readFileSync("README.md", "utf8");
const blocks = [...readme.matchAll(/```mermaid\s*\n([\s\S]*?)```/g)];
if (!blocks.length) throw Error("No Mermaid diagrams found.");
for (let i = 0; i < blocks.length; i++) {
  const result = await mermaid.parse(blocks[i][1]);
  console.log("PASS diagram " + (i + 1) + ": " + result.diagramType);
}
console.log(
  "Validated " +
    blocks.length +
    " README Mermaid diagrams with Mermaid " +
    JSON.parse(
      readFileSync(join(root, "node_modules/mermaid/package.json"), "utf8"),
    ).version +
    ". Syntax only, not visual rendering.",
);
