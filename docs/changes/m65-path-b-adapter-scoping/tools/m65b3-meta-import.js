import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseMarkupTrace, liftBareBlocks } from "../../../../compiler/native-parser/parse-markup.js";
import { splitBlocks } from "../../../../compiler/src/block-splitter.js";
import { buildAST } from "../../../../compiler/src/ast-builder.js";

const fp = resolve(process.argv[2]);
const src = readFileSync(fp, "utf8");
const run = parseMarkupTrace(src);
const ctx = run && run.ctx ? run.ctx : null;
const blocks = liftBareBlocks(ctx.nodes, src, null, ctx);
function findMeta(bs) {
  for (const b of bs || []) {
    if (b && b.kind === "Meta") return b;
    if (b && Array.isArray(b.children)) { const r = findMeta(b.children); if (r) return r; }
  }
  return null;
}
const meta = findMeta(blocks);
console.log("=== NATIVE Meta body Import/Export stmts ===");
for (const s of (meta ? meta.body : [])) {
  if (s.kind === "Import") console.log("Import:", JSON.stringify({ source: s.source, specifiers: s.specifiers && s.specifiers.length }));
  if (s.kind === "Export") console.log("Export:", JSON.stringify({ exportedName: s.exportedName, hasDecl: !!s.declaration, declKind: s.declaration && s.declaration.kind }));
  if (s.kind === "VarDecl") console.log("VarDecl declKind:", s.declKind, "names:", (s.declarations||[]).map(d=>d.target&&d.target.name));
}
console.log("\n=== LIVE ast.imports ===");
const tab = buildAST(splitBlocks(fp, src));
for (const imp of tab.ast.imports) {
  console.log(JSON.stringify({ kind: imp.kind, source: imp.source, names: imp.names, raw: (imp.raw||"").slice(0,60) }));
}
