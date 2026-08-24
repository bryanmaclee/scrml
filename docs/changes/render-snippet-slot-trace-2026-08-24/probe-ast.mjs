/**
 * S372 trace probe — dump the TAB-stage AST for a `${render name()}` slot site.
 *
 * Uses the SANCTIONED `selfHostModules.buildAST` seam in compileScrml (api.js:1259)
 * to wrap the real buildAST — no compiler source is modified.
 *
 * Run from the worktree root:
 *   bun docs/changes/render-snippet-slot-trace-2026-08-24/probe-ast.mjs
 */
import { resolve } from "path";
import { writeFileSync, mkdirSync } from "fs";
import { compileScrml } from "../../../compiler/src/api.js";
import { buildAST } from "../../../compiler/src/ast-builder.js";

const ROOT =
  "/tmp/claude-1000/-home-bryan-maclee-scrmlMaster-scrml/c20a4934-e469-4e73-bdcc-bc7e84917205/scratchpad/s372-ast";

const D = "$";
const src = [
  "<program>",
  "",
  "  const Card = <div class=\"card\" props={ body: snippet }>",
  "    <div class=\"card__body\">" + D + "{render body()}</div>",
  "  </>",
  "",
  "  <div class=\"app\">",
  "    <Card>",
  "      <em slot=\"body\">SLOTTED-EM</em>",
  "    </Card>",
  "  </div>",
  "",
  "</program>",
  "",
].join("\n");

mkdirSync(ROOT, { recursive: true });
const input = resolve(ROOT, "b1.scrml");
writeFileSync(input, src);

let captured = null;

compileScrml({
  inputFiles: [input],
  write: true,
  outputDir: resolve(ROOT, "out"),
  selfHostModules: {
    buildAST: (bsResult) => {
      const r = buildAST(bsResult, null);
      captured = r;
      return r;
    },
  },
});

function findLogicWithRender(node, path, hits) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    node.forEach((n, i) => findLogicWithRender(n, `${path}[${i}]`, hits));
    return;
  }
  const s = (() => {
    try {
      return JSON.stringify(node);
    } catch {
      return "";
    }
  })();
  if (node.kind === "logic" && s.includes("render")) hits.push({ path, node });
  for (const [k, v] of Object.entries(node)) {
    if (k === "parent") continue;
    if (v && typeof v === "object") findLogicWithRender(v, `${path}.${k}`, hits);
  }
}

console.log("=".repeat(78));
console.log("TAB AST — every `logic` node whose subtree text mentions `render`");
console.log("=".repeat(78));
const hits = [];
findLogicWithRender(captured?.ast, "ast", hits);
// de-dup by path prefix (keep the shallowest)
const seen = new Set();
for (const h of hits) {
  const key = JSON.stringify(h.node);
  if (seen.has(key)) continue;
  seen.add(key);
  console.log(`\n--- ${h.path}`);
  console.log(JSON.stringify(h.node, null, 2).slice(0, 2600));
}
if (hits.length === 0) console.log("(none)");

console.log("");
console.log("=".repeat(78));
console.log("components registry on the FileAST");
console.log("=".repeat(78));
const comps = captured?.ast?.components;
if (!comps) {
  console.log("ast.components ABSENT");
} else {
  const entries = comps instanceof Map ? [...comps.entries()] : Object.entries(comps);
  console.log(`count=${entries.length}`);
  for (const [name, info] of entries) {
    console.log(`\n### ${name}`);
    console.log(JSON.stringify(info, null, 2).slice(0, 3000));
  }
}
