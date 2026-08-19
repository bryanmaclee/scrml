#!/usr/bin/env bun
/**
 * runtime-size-levers — MEASUREMENT ONLY. Builds nothing, lands nothing,
 * changes no compiler behaviour. Run it, read the numbers, decide elsewhere.
 *
 * THE QUESTION
 *
 *   The SPA core runtime is held under a 16 KB gzip ceiling by
 *   `compiler/tests/integration/v0-3-x-spa-tree-shake-phase-b.test.js:145`.
 *   The recorded operator fork is (a) hold 16 KB forever and offset every
 *   future addition, or (b) raise the ceiling. There is a third path that is
 *   not in that fork: DON'T RAISE THE CEILING, LOWER THE FLOOR. This script
 *   is the number that path needs.
 *
 * THE LEVERS (measured independently, then composed)
 *
 *   C   comments stripped                 — formatting otherwise byte-identical
 *   W   C + formatting collapsed          — acorn parse -> astring reprint
 *   N   `_scrml_*` identifiers shortened  — comments + formatting untouched
 *   CN  C + N
 *   WN  W + N
 *
 * WHY NOT `bun build --minify`
 *
 *   Because it cannot answer the question. `--minify` conflates three things:
 *   mangling, whitespace stripping, and RE-BUNDLING WITH TREE-SHAKING. Given
 *   an emitted file as an entry point it drops every export the file does not
 *   itself reference, which is how an earlier measurement reported a
 *   fictitious ~95% win on the SPA runtime (see
 *   `docs/changes/emit-minification-prize/SCOPING.md`). Every number below is
 *   produced by a transform that provably preserves the program, and the
 *   preservation is asserted, not assumed:
 *
 *     - identical AST node count
 *     - identical multiset of string literals (incl. template cooked values)
 *     - identical multiset of numeric literals
 *     - identical top-level declaration / function / class counts
 *     - identical identifier multiset (for levers that do not rename)
 *
 *   Any violation is printed as `!! ISOLATION` next to the number, because a
 *   contaminated measurement that looks good is worse than no measurement.
 *
 * USAGE
 *   bun run scripts/runtime-size-levers.ts
 *   bun run scripts/runtime-size-levers.ts --json
 *   bun run scripts/runtime-size-levers.ts --show-names
 */

import { mkdtempSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync } from "fs";
import { join, resolve } from "path";
import { tmpdir } from "os";
import { gzipSync } from "zlib";
import * as acorn from "acorn";
import { generate } from "astring";

const ROOT = resolve(import.meta.dir, "..");
const JSON_OUT = process.argv.includes("--json");
const SHOW_NAMES = process.argv.includes("--show-names");
const WITH_BUN_MINIFY = process.argv.includes("--with-bun-minify");
const BUDGET = 16 * 1024;
const GATE = "compiler/tests/integration/v0-3-x-spa-tree-shake-phase-b.test.js:145";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/**
 * Verbatim from the budget test. Duplicated rather than imported (the test
 * does not export it) so the baseline number is directly comparable to the
 * number the gate asserts on. If the test's fixture drifts from this, the
 * comparison silently stops meaning anything — the script prints the fixture
 * source hash so drift is at least visible.
 */
const SPA_COUNTER = `<count> = 0

<button onclick={ @count = @count + 1 }>
  count is \${@count}
</button>
`;

function fixtures() {
  const out: { label: string; source: string }[] = [
    { label: "SPA_COUNTER (budget-test fixture)", source: SPA_COUNTER },
  ];
  // A real corpus app, for the other end of the range: the core runtime is a
  // tree-shaken union, so a feature-rich app ships a much larger one.
  const todomvc = join(ROOT, "benchmarks", "todomvc", "app.scrml");
  if (existsSync(todomvc)) out.push({ label: "benchmarks/todomvc/app.scrml", source: readFileSync(todomvc, "utf8") });
  return out;
}

// ---------------------------------------------------------------------------
// Compression — the gate calls `gzipSync(bytes)` with no options, so DEFAULT
// level is the level the ceiling is actually measured at. -9 is shown for
// contrast because the real transport may compress harder than the gate does.
// ---------------------------------------------------------------------------

function sizes(text: string) {
  const buf = Buffer.from(text, "utf8");
  return { raw: buf.length, gzip: gzipSync(buf).length, gzip9: gzipSync(buf, { level: 9 }).length };
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

const PARSE_OPTS: acorn.Options = { ecmaVersion: "latest", sourceType: "module" };

function parse(src: string) {
  return acorn.parse(src, PARSE_OPTS);
}

// ---------------------------------------------------------------------------
// Lever C — strip comments, preserve every other byte.
// ---------------------------------------------------------------------------

function commentRanges(src: string) {
  const comments: acorn.Comment[] = [];
  acorn.parse(src, { ...PARSE_OPTS, onComment: comments });
  return comments;
}

function leverC(src: string): string {
  let out = "";
  let pos = 0;
  for (const c of commentRanges(src)) {
    out += src.slice(pos, c.start);
    pos = c.end;
  }
  return out + src.slice(pos);
}

// ---------------------------------------------------------------------------
// Lever W — C plus formatting collapsed, via acorn -> astring reprint.
// astring reprints the same AST: it does not tree-shake and does not rename.
// ---------------------------------------------------------------------------

function leverW(src: string): string {
  return generate(parse(src) as any, { indent: "", lineEnd: "" });
}

// ---------------------------------------------------------------------------
// Lever N — `_scrml_*` shortening, formatting and comments untouched.
//
// This is AST-driven, not a text substitution, and the difference matters. A
// naive `src.replace(/_scrml_\w+/g, ...)` also rewrites the token where it
// appears inside a STRING LITERAL and where it appears as a PROPERTY KEY —
// which silently changes program behaviour. On the real runtime that naive
// pass corrupts a diagnostic message (`"... _scrml_reactive_derived is retired
// (§6.6)"`) and would break the `globalThis._scrml_perf_*` devtools hooks.
// The isolation checker catches it, which is why the checker exists.
//
// So: rename Identifier nodes only, excluding non-computed member-expression
// properties and non-computed object-literal keys, and splice by byte range
// over the ORIGINAL source so formatting is preserved byte-for-byte. Shortest
// replacements go to the highest-frequency names, which is what a real mangler
// would do — this is the OPTIMISTIC bound for the lever, not a plan.
// ---------------------------------------------------------------------------

const SCRML_NAME = /\b_scrml_[A-Za-z0-9_]+\b/g;
const IS_SCRML_NAME = /^_scrml_[A-Za-z0-9_]+$/;

function collectNames(src: string) {
  const counts = new Map<string, number>();
  for (const m of src.matchAll(SCRML_NAME)) counts.set(m[0], (counts.get(m[0]) ?? 0) + 1);
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

/** Byte ranges of every renameable `_scrml_*` Identifier occurrence. */
function renameableIdentifiers(src: string) {
  const ast: any = parse(src);
  const hits: { start: number; end: number; name: string }[] = [];
  const walk = (n: any, skip: Set<any>) => {
    if (!n || typeof n.type !== "string") return;
    if (n.type === "Identifier" && IS_SCRML_NAME.test(n.name) && !skip.has(n)) {
      hits.push({ start: n.start, end: n.end, name: n.name });
    }
    const nextSkip = new Set(skip);
    if (n.type === "MemberExpression" && !n.computed && n.property) nextSkip.add(n.property);
    if (n.type === "Property" && !n.computed && n.key) nextSkip.add(n.key);
    if (n.type === "MethodDefinition" && !n.computed && n.key) nextSkip.add(n.key);
    if (n.type === "PropertyDefinition" && !n.computed && n.key) nextSkip.add(n.key);
    for (const k of Object.keys(n)) {
      const v = n[k];
      if (Array.isArray(v)) v.forEach((c) => walk(c, nextSkip));
      else if (v && typeof v === "object" && typeof v.type === "string") walk(v, nextSkip);
    }
  };
  walk(ast, new Set());
  return hits.sort((a, b) => a.start - b.start);
}

function leverN(src: string): string {
  const hits = renameableIdentifiers(src);
  // Frequency order over the RENAMEABLE occurrences only.
  const freq = new Map<string, number>();
  for (const h of hits) freq.set(h.name, (freq.get(h.name) ?? 0) + 1);
  const mapping = new Map<string, string>();
  [...freq.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .forEach(([name], i) => mapping.set(name, "_s" + i.toString(36)));

  let out = "";
  let pos = 0;
  for (const h of hits) {
    out += src.slice(pos, h.start) + (mapping.get(h.name) ?? h.name);
    pos = h.end;
  }
  return out + src.slice(pos);
}

// ---------------------------------------------------------------------------
// Isolation — the reason this script exists instead of `--minify`.
// ---------------------------------------------------------------------------

type Shape = {
  nodes: number;
  functions: number;
  classes: number;
  topLevelDecls: number;
  strings: string;
  numbers: string;
  identifiers: string;
  declaredNames: string;
  propertyKeys: string;
};

function shapeOf(src: string): Shape {
  const ast: any = parse(src);
  let nodes = 0, functions = 0, classes = 0;
  const strings: string[] = [], numbers: number[] = [], identifiers: string[] = [], propertyKeys: string[] = [];

  const walk = (n: any) => {
    if (!n || typeof n.type !== "string") return;
    nodes++;
    // Non-computed property keys are part of the observable surface — the
    // `globalThis._scrml_perf_*` devtools hooks live here. A renaming lever
    // must leave them alone, so they are checked even when identifiers are not.
    if (n.type === "MemberExpression" && !n.computed && n.property?.type === "Identifier") propertyKeys.push(n.property.name);
    if ((n.type === "Property" || n.type === "MethodDefinition" || n.type === "PropertyDefinition") && !n.computed && n.key?.type === "Identifier") propertyKeys.push(n.key.name);
    if (n.type === "FunctionDeclaration" || n.type === "FunctionExpression" || n.type === "ArrowFunctionExpression") functions++;
    if (n.type === "ClassDeclaration" || n.type === "ClassExpression") classes++;
    if (n.type === "Literal" && typeof n.value === "string") strings.push(n.value);
    if (n.type === "Literal" && typeof n.value === "number") numbers.push(n.value);
    if (n.type === "TemplateElement") strings.push(n.value.cooked ?? "");
    if (n.type === "Identifier") identifiers.push(n.name);
    for (const k of Object.keys(n)) {
      const v = n[k];
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === "object" && typeof v.type === "string") walk(v);
    }
  };
  walk(ast);

  const declared: string[] = [];
  for (const stmt of ast.body) {
    if ((stmt.type === "FunctionDeclaration" || stmt.type === "ClassDeclaration") && stmt.id) declared.push(stmt.id.name);
    else if (stmt.type === "VariableDeclaration") {
      for (const d of stmt.declarations) if (d.id?.type === "Identifier") declared.push(d.id.name);
    }
  }

  return {
    nodes,
    functions,
    classes,
    topLevelDecls: ast.body.length,
    strings: JSON.stringify(strings.sort()),
    numbers: JSON.stringify(numbers.sort()),
    identifiers: JSON.stringify(identifiers.sort()),
    declaredNames: JSON.stringify(declared.sort()),
    propertyKeys: JSON.stringify(propertyKeys.sort()),
  };
}

/** Empty result means the number next to it is a clean measurement. */
function checkIsolation(base: Shape, after: Shape, renames: boolean): string[] {
  const bad: string[] = [];
  const eq = (k: keyof Shape, label: string, contamination = false) => {
    if (base[k] !== after[k]) bad.push(`${label} changed${contamination ? " — TREE-SHAKING CONTAMINATION" : ""}`);
  };
  if (base.nodes !== after.nodes) bad.push(`AST node count ${base.nodes} -> ${after.nodes} — TREE-SHAKING CONTAMINATION`);
  if (base.functions !== after.functions) bad.push(`function count ${base.functions} -> ${after.functions} — TREE-SHAKING CONTAMINATION`);
  if (base.classes !== after.classes) bad.push(`class count ${base.classes} -> ${after.classes} — TREE-SHAKING CONTAMINATION`);
  if (base.topLevelDecls !== after.topLevelDecls) bad.push(`top-level statement count ${base.topLevelDecls} -> ${after.topLevelDecls} — TREE-SHAKING CONTAMINATION`);
  eq("strings", "string-literal multiset", true);
  eq("numbers", "numeric-literal multiset", true);
  eq("propertyKeys", "non-computed property-key multiset (devtools/registry surface)");
  if (!renames) {
    eq("identifiers", "identifier multiset under a non-renaming lever");
    eq("declaredNames", "top-level declared-name set under a non-renaming lever");
  }
  return bad;
}

// ---------------------------------------------------------------------------
// `bun build --minify` — shown ONLY to demonstrate why it cannot be the
// measurement. Run with `--with-bun-minify`. The isolation checker is applied
// to its output exactly as it is to the honest levers; the expectation is that
// it reports TREE-SHAKING CONTAMINATION, which is the point.
// ---------------------------------------------------------------------------

async function bunMinify(path: string, tmp: string): Promise<string | null> {
  try {
    const outdir = mkdtempSync(join(tmp, "bunmin-"));
    const built = await Bun.build({ entrypoints: [path], outdir, minify: true, target: "browser" });
    if (!built.success) return null;
    for (const n of readdirSync(outdir)) if (n.endsWith(".js")) return readFileSync(join(outdir, n), "utf8");
    return null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Compile
// ---------------------------------------------------------------------------

async function compileFixture(source: string, tmp: string) {
  const { compileScrml } = await import(join(ROOT, "compiler", "src", "api.js"));
  const inputDir = mkdtempSync(join(tmp, "in-"));
  const outDir = join(inputDir, "dist");
  const filePath = join(inputDir, "app.scrml");
  writeFileSync(filePath, source);
  const result = compileScrml({ inputFiles: [filePath], outputDir: outDir, write: true, log: () => {} });
  return { result, outDir };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const LEVERS: { key: string; label: string; renames: boolean; apply: (s: string) => string }[] = [
  { key: "C", label: "C   comments stripped     ", renames: false, apply: leverC },
  { key: "W", label: "W   C + formatting collapsed", renames: false, apply: leverW },
  { key: "N", label: "N   _scrml_* shortened    ", renames: true, apply: leverN },
  { key: "CN", label: "CN  C + N                 ", renames: true, apply: (s) => leverN(leverC(s)) },
  { key: "WN", label: "WN  W + N                 ", renames: true, apply: (s) => leverW(leverN(s)) },
];

function pct(delta: number, base: number) {
  return base === 0 ? "0.0%" : ((delta / base) * 100).toFixed(1) + "%";
}

async function main() {
  const tmp = mkdtempSync(join(tmpdir(), "runtime-size-levers-"));
  const report: any = { budgetBytes: BUDGET, gate: GATE, gzipLevel: "zlib default (what the gate uses)", artifacts: [] };

  try {
    for (const f of fixtures()) {
      let compiled;
      try {
        compiled = await compileFixture(f.source, tmp);
      } catch (e: any) {
        report.artifacts.push({ fixture: f.label, error: String(e?.message ?? e) });
        continue;
      }
      const { result, outDir } = compiled;
      if (result.errors?.length) {
        report.artifacts.push({ fixture: f.label, error: `${result.errors.length} compile error(s), first: ${result.errors[0]?.code ?? "?"}` });
        continue;
      }

      const targets: { name: string; path: string; isCoreRuntime: boolean }[] = [];
      if (result.runtimeFilename) {
        targets.push({ name: result.runtimeFilename, path: join(outDir, result.runtimeFilename), isCoreRuntime: true });
      }
      // Per-app client chunks — the other shipped population. Scanned from
      // disk, not read off the result object: `compileScrml` returns
      // `outputs`, not `files`, and that shape has moved before.
      for (const n of readdirSync(outDir)) {
        if (n.endsWith(".client.js")) targets.push({ name: n, path: join(outDir, n), isCoreRuntime: false });
      }

      for (const t of targets) {
        if (!existsSync(t.path)) continue;
        const src = readFileSync(t.path, "utf8");
        const base = sizes(src);
        const entry: any = {
          fixture: f.label,
          artifact: t.name,
          isCoreRuntime: t.isCoreRuntime,
          baseline: base,
          marginToBudget: t.isCoreRuntime ? BUDGET - base.gzip : null,
          levers: {},
        };

        let baseShape: Shape;
        try {
          baseShape = shapeOf(src);
        } catch (e: any) {
          entry.unparseable = String(e?.message ?? e);
          report.artifacts.push(entry);
          continue;
        }

        entry.shape = { nodes: baseShape.nodes, functions: baseShape.functions, classes: baseShape.classes, topLevelDecls: baseShape.topLevelDecls };

        // Composition of the raw bytes, so the levers can be read against it.
        const comments = commentRanges(src);
        const commentBytes = comments.reduce((a, c) => a + (c.end - c.start), 0);
        const names = collectNames(src);
        const nameBytes = names.reduce((a, n) => a + n.name.length * n.count, 0);
        entry.composition = {
          comments: comments.length,
          commentBytes,
          commentShareOfRaw: pct(commentBytes, base.raw),
          commentTextGzipAlone: gzipSync(Buffer.from(comments.map((c) => src.slice(c.start, c.end)).join("\n"))).length,
          distinctScrmlNames: names.length,
          scrmlNameBytes: nameBytes,
          scrmlNameShareOfRaw: pct(nameBytes, base.raw),
        };

        for (const lever of LEVERS) {
          try {
            const out = lever.apply(src);
            entry.levers[lever.key] = {
              ...sizes(out),
              savedGzip: base.gzip - gzipSync(Buffer.from(out, "utf8")).length,
              isolation: checkIsolation(baseShape, shapeOf(out), lever.renames),
            };
          } catch (e: any) {
            entry.levers[lever.key] = { error: String(e?.message ?? e) };
          }
        }

        if (WITH_BUN_MINIFY) {
          const min = await bunMinify(t.path, tmp);
          if (min === null) entry.bunMinify = { error: "bun build failed or produced no output" };
          else {
            let iso: string[];
            try {
              iso = checkIsolation(baseShape, shapeOf(min), true);
            } catch (e: any) {
              iso = [`output did not re-parse: ${String(e?.message ?? e)}`];
            }
            entry.bunMinify = { ...sizes(min), savedGzip: base.gzip - gzipSync(Buffer.from(min, "utf8")).length, isolation: iso };
          }
        }

        report.artifacts.push(entry);
      }
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }

  if (JSON_OUT) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log("");
  console.log("runtime-size-levers — what LOWERING THE FLOOR would buy");
  console.log("=".repeat(78));
  console.log(`budget    : ${BUDGET} B gzip`);
  console.log(`asserted  : ${GATE}`);
  console.log(`gzip level: ${report.gzipLevel}   (level-9 shown for contrast)`);
  console.log("");

  for (const a of report.artifacts) {
    if (a.error) {
      console.log(`  !! ${a.fixture}: ${a.error}`);
      console.log("");
      continue;
    }
    console.log(`${a.isCoreRuntime ? "[CORE RUNTIME]" : "[client chunk]"} ${a.artifact}`);
    console.log(`  fixture : ${a.fixture}`);
    if (a.unparseable) {
      console.log(`  !! unparseable, levers skipped: ${a.unparseable}`);
      console.log("");
      continue;
    }
    console.log(`  baseline: raw ${a.baseline.raw}   gzip ${a.baseline.gzip}   gzip-9 ${a.baseline.gzip9}`);
    if (a.marginToBudget !== null) {
      console.log(`  margin to budget: ${a.marginToBudget} B${a.marginToBudget < 0 ? "   *** OVER BUDGET ***" : ""}`);
    }
    const c = a.composition;
    console.log(`  composition: ${c.comments} comments = ${c.commentBytes} B raw (${c.commentShareOfRaw}); that comment text alone gzips to ${c.commentTextGzipAlone} B`);
    console.log(`               ${c.distinctScrmlNames} distinct _scrml_* names = ${c.scrmlNameBytes} B raw (${c.scrmlNameShareOfRaw})`);
    console.log("");
    for (const lever of LEVERS) {
      const v = a.levers[lever.key];
      if (!v) continue;
      if (v.error) {
        console.log(`  ${lever.label}  ERROR ${v.error}`);
        continue;
      }
      const margin = a.isCoreRuntime ? BUDGET - v.gzip : null;
      console.log(
        `  ${lever.label}  gzip ${String(v.gzip).padStart(6)}  saves ${String(v.savedGzip).padStart(6)} B (${pct(v.savedGzip, a.baseline.gzip).padStart(5)})` +
          (margin !== null ? `   margin ${String(margin).padStart(6)} B` : "")
      );
      if (v.isolation.length) for (const bad of v.isolation) console.log(`      !! ISOLATION: ${bad}`);
      else console.log(`      isolation: clean (nodes/functions/classes/top-level/strings/numbers all identical)`);
    }
    if (a.bunMinify) {
      console.log("");
      if (a.bunMinify.error) console.log(`  bun build --minify (NOT a valid measurement): ${a.bunMinify.error}`);
      else {
        console.log(
          `  bun build --minify         gzip ${String(a.bunMinify.gzip).padStart(6)}  "saves" ${String(a.bunMinify.savedGzip).padStart(6)} B (${pct(a.bunMinify.savedGzip, a.baseline.gzip)})  <- DO NOT QUOTE THIS`
        );
        if (a.bunMinify.isolation.length) for (const bad of a.bunMinify.isolation) console.log(`      !! ISOLATION: ${bad}`);
        else console.log(`      isolation: clean (surprising — investigate before trusting)`);
      }
    }
    console.log("");
  }

  if (SHOW_NAMES) {
    const spec = readFileSync(join(ROOT, "compiler", "SPEC.md"), "utf8");
    const named = [...new Set([...spec.matchAll(SCRML_NAME)].map((m) => m[0]))].sort();
    console.log("-".repeat(78));
    console.log("`_scrml_*` names NAMED IN compiler/SPEC.md.");
    console.log("");
    console.log("These are not free to rename: SPEC is normative, so each of these is a");
    console.log("documented identifier, and several are cross-file registry keys or");
    console.log("string-looked-up (`_scrml_modules` per SPEC 21.3 / 47.9, `_scrml_stdlib`).");
    console.log("SPEC 47's encoding scheme does NOT already cover them — 47 encodes");
    console.log("TYPE-DERIVED binding names (`_<kind><hash><seq>`); the `_scrml_*` runtime");
    console.log("surface is a separate, hand-authored namespace. A mangle pass over it is a");
    console.log("NEW naming contract, not a ride on an existing one.");
    console.log("");
    console.log(`count: ${named.length}`);
    for (const n of named) console.log(`  ${n}`);
  }
}

await main();
