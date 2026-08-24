/**
 * S372 trace probe — BLAST RADIUS.
 *
 * For every corpus .scrml that uses `${ render <name>( `, measure:
 *   - does the component body take the NATIVE re-parse path (sourceNeedsLiveFallback
 *     component-expander.ts:1079 does NOT trip)?  -> would change behaviour on a fix
 *   - does the compiled artifact contain an EMPTY render site?
 *
 * Read-only against compiler source. Run from the worktree root:
 *   bun docs/changes/render-snippet-slot-trace-2026-08-24/probe-blast-radius.mjs
 */
import { resolve } from "path";
import { readFileSync, mkdirSync, existsSync } from "fs";
import { execSync } from "child_process";
import { compileScrml } from "../../../compiler/src/api.js";
import { nativeParseFile } from "../../../compiler/native-parser/parse-file.js";
import { splitBlocks } from "../../../compiler/src/block-splitter.js";
import { buildAST } from "../../../compiler/src/ast-builder.js";

const WT = "/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-a0dd2d0e2d66cb063";
const ROOT =
  "/tmp/claude-1000/-home-bryan-maclee-scrmlMaster-scrml/c20a4934-e469-4e73-bdcc-bc7e84917205/scratchpad/s372-blast";

const files = execSync(
  "grep -rl '\\${ *render [A-Za-z_$][A-Za-z0-9_$]*(' --include='*.scrml' . | grep -v node_modules | sort",
  { cwd: WT, encoding: "utf8" },
).trim().split("\n");

/** Verbatim copy of component-expander.ts:1079 sourceNeedsLiveFallback. */
function sourceNeedsLiveFallback(source) {
  if (/\b(?:const|let|tilde|lin)\s+(?:fn|lin|server|pure)\s*[:=]/.test(source)) return true;
  if (/`[^`]*\$\{/.test(source)) return true;
  if (/<\s*(?:each|match)\b/.test(source)) return true;
  return false;
}

console.log("file".padEnd(70) + " render-sites  native-path?  compiles  empty-sites");
console.log("-".repeat(114));

let nativeCount = 0, emptyCount = 0;
const rows = [];

for (const rel of files) {
  const abs = resolve(WT, rel);
  const src = readFileSync(abs, "utf8");
  const sites = (src.match(/\$\{ *render [A-Za-z_$][A-Za-z0-9_$]*\(/g) ?? []).length;

  // Component-def bodies in this file: approximate by testing the WHOLE file source
  // against the fallback predicate — a file whose bodies contain <each>/<match>/
  // template-interp is the only way the live path is taken. Conservative: report both.
  const wholeFileFallback = sourceNeedsLiveFallback(src);

  // Empirically: run each component-def body found in the compiled TAB AST through
  // the same native parse and count empty Render escape-hatches.
  let empties = 0, compileErrs = "n/a", natives = 0;
  try {
    const outDir = resolve(ROOT, rel.replace(/[^A-Za-z0-9]/g, "_"));
    mkdirSync(outDir, { recursive: true });
    let tab = null;
    const r = compileScrml({
      inputFiles: [abs],
      write: true,
      outputDir: outDir,
      selfHostModules: { buildAST: (bs) => (tab = buildAST(bs, null)) },
    });
    compileErrs = String((r.errors ?? []).filter((e) => (e.severity ?? "error") === "error").length);

    // Walk every component-def raw in the TAB AST, run BOTH parsers, count Render loss.
    // De-dup: a component-def node is ALIASED into logic.body, logic.components and
    // ast.components, so a naive walk counts it 3x. Track object identity.
    const defs = [];
    const seenDefs = new Set();
    const seenNodes = new Set();
    (function walk(n) {
      if (!n || typeof n !== "object") return;
      if (seenNodes.has(n)) return;
      seenNodes.add(n);
      if (Array.isArray(n)) return n.forEach(walk);
      if (n.kind === "component-def" && typeof n.raw === "string" && !seenDefs.has(n)) {
        seenDefs.add(n);
        defs.push(n);
      }
      for (const [k, v] of Object.entries(n)) {
        if (k === "parent") continue;
        if (v && typeof v === "object") walk(v);
      }
    })(tab?.ast);

    for (const d of defs) {
      if (!/render\s+[A-Za-z_$][A-Za-z0-9_$]*\s*\(/.test(d.raw)) continue;
      const takesNative = !sourceNeedsLiveFallback(d.raw);
      if (takesNative) natives++;
      const parsed = takesNative
        ? nativeParseFile(abs + "#" + d.name, d.raw)
        : buildAST(splitBlocks(abs + "#" + d.name, d.raw));
      const seen2 = new Set();
      (function walk2(n) {
        if (!n || typeof n !== "object") return;
        if (seen2.has(n)) return;
        seen2.add(n);
        if (Array.isArray(n)) return n.forEach(walk2);
        if (n.kind === "escape-hatch" && n.nativeKind === "Render") empties++;
        for (const [k, v] of Object.entries(n)) {
          if (k === "parent") continue;
          if (v && typeof v === "object") walk2(v);
        }
      })(parsed.ast);
    }
  } catch (e) {
    compileErrs = "THREW:" + String(e.message).slice(0, 30);
  }

  if (natives > 0) nativeCount++;
  if (empties > 0) emptyCount++;
  rows.push({ rel, sites, natives, wholeFileFallback, compileErrs, empties });
  console.log(
    rel.padEnd(70) +
      String(sites).padStart(6) +
      String(natives > 0 ? "yes" : "no").padStart(14) +
      String(compileErrs).padStart(10) +
      String(empties).padStart(13),
  );
}

console.log("-".repeat(114));
console.log(`files scanned: ${files.length}`);
console.log(`files whose component bodies take the NATIVE re-parse path: ${nativeCount}`);
console.log(`files with at least one EMPTY Render escape-hatch (behaviour CHANGES on a fix): ${emptyCount}`);
