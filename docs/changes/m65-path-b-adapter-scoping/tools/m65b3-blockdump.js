// m65b3-blockdump.js — Phase-0 diagnostic for the hoist-gap (M6.5.b.3).
// Dumps the native LIFTED block-stream (what collectHoisted walks) as a
// kind/name tree, plus the live + native FileAST hoisted-collection lengths.
// USAGE: bun run <thisfile> <path-to-.scrml>
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { splitBlocks } from "../../../../compiler/src/block-splitter.js";
import { buildAST } from "../../../../compiler/src/ast-builder.js";
import { nativeParseFile } from "../../../../compiler/native-parser/parse-file.js";
import { parseMarkupTrace, liftBareBlocks } from "../../../../compiler/native-parser/parse-markup.js";

const fileArg = process.argv[2];
const filePath = resolve(fileArg);
const src = readFileSync(filePath, "utf8");

function blockTree(blocks, indent) {
  const pad = "  ".repeat(indent);
  let out = "";
  for (const b of (blocks || [])) {
    if (b == null) continue;
    let label = b.kind;
    if (b.kind === "Markup") label += `<${b.name}>`;
    if (b.kind === "LogicEscape" || b.kind === "Meta") {
      const kinds = Array.isArray(b.body) ? b.body.map(s => s && s.kind).join(",") : "(no body)";
      label += ` body=[${kinds}]`;
    }
    if (b.kind === "Text") {
      const t = (b.text || b.value || "").slice(0,40).replace(/\n/g," ");
      label += ` "${t}"`;
    }
    out += pad + label + "\n";
    if (Array.isArray(b.children) && b.children.length) {
      out += blockTree(b.children, indent + 1);
    }
  }
  return out;
}

// LIVE
const bs = splitBlocks(filePath, src);
const tab = buildAST(bs);
console.log("=== LIVE hoisted lengths ===");
console.log(JSON.stringify({
  imports: tab.ast.imports.length,
  exports: tab.ast.exports.length,
  typeDecls: tab.ast.typeDecls.length,
  components: tab.ast.components.length,
  machineDecls: tab.ast.machineDecls.length,
  channelDecls: tab.ast.channelDecls.length,
  hasProgramRoot: tab.ast.hasProgramRoot,
}));

// NATIVE — raw lifted block stream
const run = parseMarkupTrace(src);
const ctx = run && run.ctx ? run.ctx : null;
const rawBlocks = ctx && Array.isArray(ctx.nodes) ? ctx.nodes : [];
const blocks = liftBareBlocks(rawBlocks, src, null, ctx);
console.log("\n=== NATIVE LIFTED block-stream (what collectHoisted walks) ===");
console.log(blockTree(blocks, 0));

const r = nativeParseFile(filePath, src);
console.log("=== NATIVE hoisted lengths ===");
console.log(JSON.stringify({
  imports: r.ast.imports.length,
  exports: r.ast.exports.length,
  typeDecls: r.ast.typeDecls.length,
  components: r.ast.components.length,
  machineDecls: r.ast.machineDecls.length,
  channelDecls: r.ast.channelDecls.length,
  hasProgramRoot: r.ast.hasProgramRoot,
}));
