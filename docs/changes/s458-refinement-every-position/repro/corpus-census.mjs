// s458 Phase 0 — corpus census (dry-run classification, base = origin/main).
// 1. Find every refinement-shaped type annotation in samples/ examples/ conformance/ stdlib/ (*.scrml).
// 2. Classify its POSITION (decl / param / return / struct field / enum payload / const) from the source line.
// 3. Ask the REAL TS reader (type-system.ts resolveTypeExpr) what it makes of the annotation text, and what the
//    shared judge (emit-predicates predicateToJsExpr) would emit — "judgeable" vs "fail-open (`true`)" vs "not read".
// 4. COMPILE each file that carries one (base compiler) and record its error codes, so a fail-closed default's
//    newly-refused population is countable against the base result.
// 5. Count WRITE sites the root design would newly judge: reassignments of a refined cell (`@x =`), and calls
//    with a literal argument to a refined parameter.
// Usage: bun docs/changes/s458-refinement-every-position/repro/corpus-census.mjs [--no-compile]
import { resolve, dirname, relative } from "path";
import { fileURLToPath } from "url";
import { readFileSync, readdirSync, statSync, mkdirSync, rmSync, writeFileSync, copyFileSync } from "fs";

const here = dirname(fileURLToPath(import.meta.url));
const wt = resolve(here, "../../../..");
const { resolveTypeExpr } = await import(resolve(wt, "compiler/src/type-system.js"));
const { predicateToJsExpr } = await import(resolve(wt, "compiler/src/codegen/emit-predicates.ts"));
const { compileScrml } = await import(resolve(wt, "compiler/src/api.js"));
const doCompile = !process.argv.includes("--no-compile");

function walk(d, out) {
  for (const n of readdirSync(d)) {
    const p = resolve(d, n);
    if (n === "node_modules" || n === "dist" || n.startsWith(".")) continue;
    const s = statSync(p);
    if (s.isDirectory()) walk(p, out); else if (n.endsWith(".scrml")) out.push(p);
  }
  return out;
}
const files = ["samples", "examples", "conformance", "stdlib"].flatMap((d) => walk(resolve(wt, d), []));

const BASE = "(string|number|integer|int|boolean)";
const SHARED = "(req|length\\(|pattern\\(|min\\(|max\\(|gt\\(|lt\\(|gte\\(|lte\\(|eq\\(|neq\\(|oneOf\\(|notIn\\()";
// annotation text after a `:` — base(pred) [label] | base.chain | base sharedcore... | Enum oneOf/notIn(...)
const ANNOT = new RegExp(
  `:\\s*((?:${BASE}\\s*\\((?:[^()]|\\((?:[^()]|\\([^()]*\\))*\\))*\\)(?:\\s*\\[[A-Za-z_]\\w*\\])?)` +
  `|(?:${BASE}(?:\\.(?:req|[a-z]+\\([^)]*\\)))+)` +
  `|(?:(?:${BASE}|[A-Z]\\w*)(?:\\s+${SHARED}(?:[^,}\\n=]*?))+(?=\\s*(?:,|}|=|\\)|$))))`, "g");

function position(line, idx, inStruct, inEnum) {
  const before = line.slice(0, idx);
  if (/^\s*(export\s+)?(server\s+)?(function|fn)\b/.test(line) || /\(\s*[A-Za-z_]\w*\s*$/.test(before) || /,\s*[A-Za-z_]\w*\s*$/.test(before) && /(function|fn)\s+\w+\s*\(/.test(line)) return "param";
  if (/^\s*(const\s+)?<[A-Za-z_]\w*>\s*$/.test(before)) return /^\s*const\s/.test(line) ? "derived-cell" : "state-cell";
  if (/^\s*let\s+\w+\s*$/.test(before)) return "let";
  if (/^\s*const\s+\w+\s*$/.test(before)) return "const";
  if (inEnum) return "enum-payload";
  if (inStruct) return "struct-field";
  return "other";
}

const rows = [];
const reassign = [];
const literalCalls = [];
for (const f of files) {
  const src = readFileSync(f, "utf8");
  const lines = src.split("\n");
  let inStruct = false, inEnum = false, depth = 0;
  const refinedCells = new Set();
  const refinedFns = new Map(); // fn name -> [param index -> annot]
  lines.forEach((line, i) => {
    if (/type\s+\w+\s*:\s*struct\s*=\s*\{/.test(line)) { inStruct = true; inEnum = false; depth = 0; }
    if (/type\s+\w+\s*:\s*enum\s*=\s*\{/.test(line)) { inEnum = true; inStruct = false; depth = 0; }
    if (/^\s*\/\//.test(line)) return;
    ANNOT.lastIndex = 0;
    let m;
    while ((m = ANNOT.exec(line))) {
      const annot = m[1].trim();
      const pos = position(line, m.index, inStruct, inEnum);
      let t;
      try { t = resolveTypeExpr(annot, new Map()); } catch (e) { t = { kind: "threw" }; }
      let reader = "not-read (asIs)";
      if (t && t.kind === "predicated") {
        const js = t.predicate && t.predicate.kind === "variant-set" ? "variant-set" : predicateToJsExpr(t.predicate, "v");
        reader = /^\(?true\)?$/.test(js) || /\btrue\b/.test(js) ? "fail-open (true)" : "judgeable";
      } else if (/^[A-Z]/.test(annot)) {
        reader = "enum-subset (needs registry)";
      }
      rows.push({ file: relative(wt, f), line: i + 1, pos, annot, reader });
      const cell = line.match(/^\s*<([A-Za-z_]\w*)>\s*:/);
      if (cell && t && t.kind === "predicated") refinedCells.add(cell[1]);
      const fn = line.match(/(?:function|fn)\s+([A-Za-z_]\w*)\s*\(([^)]*)\)/);
      if (fn) {
        const ps = fn[2].split(",").map((s) => s.trim());
        ps.forEach((p, pi) => { if (p.includes(annot)) { const arr = refinedFns.get(fn[1]) ?? []; arr[pi] = annot; refinedFns.set(fn[1], arr); } });
      }
    }
    for (const ch of line) { if (ch === "{") depth++; else if (ch === "}") { depth--; if (depth <= 0) { inStruct = false; inEnum = false; } } }
  });
  // write sites
  lines.forEach((line, i) => {
    for (const c of refinedCells) {
      if (new RegExp(`@${c}\\s*=(?!=)`).test(line) && !new RegExp(`^\\s*<${c}>`).test(line)) reassign.push(`${relative(wt, f)}:${i + 1}: ${line.trim().slice(0, 90)}`);
    }
    for (const [fn, params] of refinedFns) {
      const re = new RegExp(`\\b${fn}\\s*\\(([^()]*)\\)`, "g");
      let mm;
      while ((mm = re.exec(line))) {
        if (/(function|fn)\s+$/.test(line.slice(0, mm.index))) continue;
        const args = mm[1].split(",").map((s) => s.trim());
        args.forEach((a, ai) => { if (params[ai] && /^(-?\d|"|'|`)/.test(a)) literalCalls.push(`${relative(wt, f)}:${i + 1}: ${fn}(${a}) -> ${params[ai]}`); });
      }
    }
  });
}

// struct types carrying a refined field (any form) → where values of that type are WRITTEN
const refinedStructs = new Map(); // file -> Set(name)
for (const r of rows) {
  if (r.pos !== "struct-field") continue;
  const src = readFileSync(resolve(wt, r.file), "utf8").split("\n");
  for (let i = r.line - 1; i >= 0; i--) {
    const m = src[i].match(/type\s+([A-Z]\w*)\s*:\s*struct/);
    if (m) { const s = refinedStructs.get(r.file) ?? new Set(); s.add(m[1]); refinedStructs.set(r.file, s); break; }
  }
}
const structWrites = [];
for (const [file, names] of refinedStructs) {
  const lines = readFileSync(resolve(wt, file), "utf8").split("\n");
  lines.forEach((line, i) => {
    for (const n of names) {
      if (new RegExp(`type\\s+${n}\\b`).test(line)) continue;
      const kinds = [];
      if (new RegExp(`\\(\\s*\\w+\\s*:\\s*${n}\\b|,\\s*\\w+\\s*:\\s*${n}\\b`).test(line)) kinds.push("param");
      if (new RegExp(`(<\\w+>|let\\s+\\w+|const\\s+\\w+)\\s*:\\s*${n}(\\[\\])?\\s*=`).test(line)) kinds.push("decl");
      if (new RegExp(`\\b${n}\\s*\\{`).test(line)) kinds.push("ctor");
      if (new RegExp(`for=${n}\\b`).test(line)) kinds.push("formFor/tableFor for=");
      if (new RegExp(`schemaFor\\(\\s*${n}\\b`).test(line)) kinds.push("schemaFor");
      if (kinds.length) structWrites.push(`${file}:${i + 1}: [${kinds.join(",")}] ${line.trim().slice(0, 80)}`);
    }
  });
}

const by = (k) => rows.reduce((acc, r) => ((acc[r[k]] = (acc[r[k]] ?? 0) + 1), acc), {});
console.log(`corpus files scanned: ${files.length}`);
console.log(`refinement-shaped annotations: ${rows.length} in ${new Set(rows.map((r) => r.file)).size} files`);
console.log("by position:", JSON.stringify(by("pos")));
console.log("by TS-reader verdict:", JSON.stringify(by("reader")));
const cross = {};
for (const r of rows) { const k = `${r.pos} | ${r.reader}`; cross[k] = (cross[k] ?? 0) + 1; }
console.log("position x reader:"); for (const [k, v] of Object.entries(cross).sort()) console.log(`   ${String(v).padStart(4)}  ${k}`);
console.log(`\nreassignments of a refined cell (@x = ...): ${reassign.length}`); reassign.forEach((s) => console.log("   " + s));
console.log(`\nliteral arguments to a refined parameter: ${literalCalls.length}`); literalCalls.forEach((s) => console.log("   " + s));
console.log(`\nuses of a struct type that carries a refined field: ${structWrites.length}`); structWrites.forEach((s) => console.log("   " + s));
console.log("\nall rows:"); for (const r of rows) console.log(`   ${r.file}:${r.line} [${r.pos}] ${r.annot} => ${r.reader}`);

if (doCompile) {
  const scratch = resolve(wt, ".tmp/s458-census");
  rmSync(scratch, { recursive: true, force: true });
  mkdirSync(scratch, { recursive: true });
  const fileSet = [...new Set(rows.map((r) => r.file))];
  console.log(`\nbase compile of the ${fileSet.length} carrying files (error codes only):`);
  for (const rel of fileSet) {
    let codes = "?";
    try {
      const r = compileScrml({ inputFiles: [resolve(wt, rel)], write: false, outputDir: resolve(scratch, rel.replace(/[\/.]/g, "_")), log: () => {} });
      codes = [...new Set((r.errors ?? []).filter((e) => (e.severity ?? "error") === "error" && !/^[WI]-/.test(e.code ?? "")).map((e) => e.code))].join(",") || "clean";
    } catch (e) { codes = "THREW " + String(e.message).slice(0, 60); }
    console.log(`   ${rel}: ${codes}`);
  }
}
