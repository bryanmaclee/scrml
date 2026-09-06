#!/usr/bin/env bun
/** inspect-case.ts <relDir> — dump LIVE vs NATIVE FileAST shape for one corpus
 *  case. Survey-only; reads, prints, writes nothing. */
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadCases } from "../../../conformance/run.ts";
import { splitBlocks } from "../../../compiler/src/block-splitter.js";
import { buildAST } from "../../../compiler/src/ast-builder.js";
import { nativeParseFile } from "../../../compiler/native-parser/parse-file.js";
import { populateNativeAttrValueExprNodes } from "../../../compiler/src/native-walker/attrvalue-exprnode-walker.ts";
import { backfillNativeExprText } from "../../../compiler/src/native-walker/exprtext-backfill-walker.ts";

const want = process.argv[2];
const depth = Number(process.argv[3] ?? 3);
const c = loadCases().find((x) => x.relDir === want);
if (!c) { console.error(`no case ${want}`); process.exit(1); }

const dir = mkdtempSync(join(tmpdir(), "scrml-inspect-"));
const file = join(dir, "case.scrml");
writeFileSync(file, c.source, "utf8");
for (const [n, s] of Object.entries(c.auxFiles)) writeFileSync(join(dir, n), s, "utf8");

const live = buildAST(splitBlocks(file, c.source)).ast;
const r = nativeParseFile(file, c.source);
if (!Array.isArray(r.errors)) r.errors = [];
populateNativeAttrValueExprNodes(r.ast, r.filePath || file, r.errors);
backfillNativeExprText(r.ast);
rmSync(dir, { recursive: true, force: true });

function outline(n: any, d: number, indent = ""): string {
  if (n === null || n === undefined) return String(n);
  if (Array.isArray(n)) {
    if (n.length === 0) return "[]";
    if (d <= 0) return `[${n.length} items]`;
    return "[\n" + n.map((v) => indent + "  " + outline(v, d - 1, indent + "  ")).join(",\n") + "\n" + indent + "]";
  }
  if (typeof n !== "object") return JSON.stringify(n);
  const kind = n.type ?? n.kind ?? "(obj)";
  if (d <= 0) return `{${kind} ...${Object.keys(n).length} keys}`;
  const parts: string[] = [];
  for (const [k, v] of Object.entries(n)) {
    if (k === "start" || k === "end" || k === "line" || k === "col") continue;
    parts.push(indent + "  " + k + ": " + outline(v, d - 1, indent + "  "));
  }
  return "{\n" + parts.join(",\n") + "\n" + indent + "}";
}

console.log("=== SOURCE ===");
console.log(c.source);
console.log("");
console.log("=== LIVE root keys:", Object.keys(live).join(", "));
console.log("=== NATIVE root keys:", Object.keys(r.ast).join(", "));
console.log("");
console.log("=== LIVE ===");
console.log(outline(live, depth));
console.log("");
console.log("=== NATIVE ===");
console.log(outline(r.ast, depth));
console.log("");
console.log("=== native parse errors:", JSON.stringify((r.errors ?? []).map((e: any) => e?.code ?? e?.message)));
