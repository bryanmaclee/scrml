#!/usr/bin/env bun
/**
 * bridge-survey-astdiff.ts — STAGE 2 of the native-bridge field-carrying survey.
 *
 * SURVEY-ONLY. Touches no compiler source. Writes only under this change-dir.
 *
 * THE QUESTION
 * ------------
 * Stage 1 established that 156 corpus cases lose a required diagnostic under the
 * native parser (`r.missing`), spanning 124 distinct codes. `r.missing` names
 * CODES, not FIELDS — it carries zero information about WHY the code stopped
 * firing. This stage produces the field-level evidence directly: for each case,
 * parse the SAME source through BOTH front-ends and diff the resulting FileAST.
 *
 *   LIVE   : splitBlocks(filePath, source)  ->  buildAST(bsResult)
 *   NATIVE : nativeParseFile(filePath, source)
 *            -> populateNativeAttrValueExprNodes(ast, filePath, errors)
 *            -> backfillNativeExprText(ast)
 *
 * The NATIVE composition above is copied from the `useNativeParser` branch of
 * `compileScrml` in compiler/src/api.js — the same three calls in the same order
 * with the same arguments, so the AST diffed here is the AST the flip feeds
 * downstream.
 *
 * THE DIFF IS FIELD-SHAPED, NOT VALUE-SHAPED
 * -------------------------------------------
 * A raw deep-diff of two ASTs is unreadable and dominated by span jitter. What
 * the cost question needs is: which KEYS, on which NODE KINDS, does the native
 * AST fail to carry? So both trees are reduced to a SIGNATURE SET:
 *
 *   "<kind>.<key>: LIVE-HAS / NATIVE-ABSENT"   key missing outright
 *   "<kind>.<key>: LIVE-HAS / NATIVE-EMPTY"    present but ""/[]/{} where live is not
 *   "<kind>.<key>: TYPE live=<t> native=<t>"   present in both, different JS type
 *   "KIND-COUNT <kind>: live=N native=M"       node kind population differs
 *   "TOP-LEVEL <key>: ..."                     FileAST root key divergence
 *
 * Signatures are collected per case as a SET (no duplicates), so a case with 40
 * `Attr.exprNode` divergences contributes one signature. Clustering then asks
 * the cost question directly: how many DISTINCT signatures cover the 156, and
 * how concentrated is the coverage?
 */
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { loadCases } from "../../../conformance/run.ts";
import { splitBlocks } from "../../../compiler/src/block-splitter.js";
import { buildAST } from "../../../compiler/src/ast-builder.js";
import { nativeParseFile } from "../../../compiler/native-parser/parse-file.js";
import { populateNativeAttrValueExprNodes } from "../../../compiler/src/native-walker/attrvalue-exprnode-walker.ts";
import { backfillNativeExprText } from "../../../compiler/src/native-walker/exprtext-backfill-walker.ts";

const HERE = import.meta.dir;
const OUT = join(HERE, "artifacts");
mkdirSync(OUT, { recursive: true });

// Keys whose VALUES are position noise; their presence/absence still matters but
// a type/emptiness comparison on them would swamp the signal.
const POSITIONAL = new Set(["start", "end", "line", "col", "column", "loc", "range", "span", "index", "pos", "offset"]);

function kindOf(n: any): string {
  if (!n || typeof n !== "object") return "?";
  return String(n.type ?? n.kind ?? n.nodeType ?? n.tag ?? "(untyped-object)");
}

function isEmptyish(v: unknown): boolean {
  if (v === undefined || v === null) return true;
  if (v === "") return true;
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === "object") return Object.keys(v as object).length === 0;
  return false;
}

function typeName(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  return typeof v;
}

/**
 * Walk a tree and build:
 *   kindKeys : kind -> key -> { seen, nonEmpty, types:Set }
 *   kindCount: kind -> N
 */
interface Prof {
  kindKeys: Map<string, Map<string, { seen: number; nonEmpty: number; types: Set<string> }>>;
  kindCount: Map<string, number>;
}

function profile(root: unknown): Prof {
  const kindKeys = new Map<string, Map<string, { seen: number; nonEmpty: number; types: Set<string> }>>();
  const kindCount = new Map<string, number>();
  const seenObjs = new Set<object>();
  const stack: unknown[] = [root];
  let budget = 400000;
  while (stack.length > 0 && budget-- > 0) {
    const n = stack.pop();
    if (!n || typeof n !== "object") continue;
    if (seenObjs.has(n as object)) continue;
    seenObjs.add(n as object);
    if (Array.isArray(n)) {
      for (const v of n) stack.push(v);
      continue;
    }
    const k = kindOf(n);
    kindCount.set(k, (kindCount.get(k) ?? 0) + 1);
    let keys = kindKeys.get(k);
    if (!keys) { keys = new Map(); kindKeys.set(k, keys); }
    for (const [key, v] of Object.entries(n as Record<string, unknown>)) {
      if (key.startsWith("_")) continue; // compiler-internal scratch
      let e = keys.get(key);
      if (!e) { e = { seen: 0, nonEmpty: 0, types: new Set() }; keys.set(key, e); }
      e.seen++;
      if (!isEmptyish(v)) e.nonEmpty++;
      e.types.add(typeName(v));
      if (v && typeof v === "object") stack.push(v);
    }
  }
  return { kindKeys, kindCount };
}

/** Signature set for one case: what the NATIVE tree fails to carry vs LIVE. */
function signatures(live: Prof, native: Prof): string[] {
  const sigs = new Set<string>();

  // Node-kind population differences.
  const kinds = new Set([...live.kindCount.keys(), ...native.kindCount.keys()]);
  for (const k of kinds) {
    const l = live.kindCount.get(k) ?? 0;
    const n = native.kindCount.get(k) ?? 0;
    if (l > 0 && n === 0) sigs.add(`KIND-ABSENT ${k} (live=${l} native=0)`);
    else if (l === 0 && n > 0) sigs.add(`KIND-EXTRA ${k} (live=0 native=${n})`);
    else if (l !== n) sigs.add(`KIND-COUNT ${k}`);
  }

  // Per-kind key differences (only for kinds present in BOTH — a wholly absent
  // kind is already reported and would otherwise emit one signature per key).
  for (const [k, lkeys] of live.kindKeys) {
    const nkeys = native.kindKeys.get(k);
    if (!nkeys) continue;
    for (const [key, le] of lkeys) {
      const ne = nkeys.get(key);
      if (!ne) {
        if (le.nonEmpty > 0) sigs.add(`${k}.${key}: LIVE-HAS / NATIVE-ABSENT`);
        continue;
      }
      if (POSITIONAL.has(key)) continue;
      if (le.nonEmpty > 0 && ne.nonEmpty === 0) {
        sigs.add(`${k}.${key}: LIVE-HAS / NATIVE-EMPTY`);
        continue;
      }
      const lt = [...le.types].sort().join("|");
      const nt = [...ne.types].sort().join("|");
      if (lt !== nt) sigs.add(`${k}.${key}: TYPE live=${lt} native=${nt}`);
    }
  }
  // Keys native invents that live never carries (can cause spurious diagnostics).
  for (const [k, nkeys] of native.kindKeys) {
    const lkeys = live.kindKeys.get(k);
    if (!lkeys) continue;
    for (const [key, ne] of nkeys) {
      if (!lkeys.has(key) && ne.nonEmpty > 0) sigs.add(`${k}.${key}: NATIVE-ONLY-KEY`);
    }
  }
  return [...sigs].sort();
}

// ---------------------------------------------------------------------------
function parseBoth(source: string, auxFiles: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), "scrml-astdiff-"));
  try {
    const file = join(dir, "case.scrml");
    writeFileSync(file, source, "utf8");
    for (const [n, c] of Object.entries(auxFiles)) writeFileSync(join(dir, n), c, "utf8");

    let liveAst: unknown = null;
    let liveErr: string | null = null;
    try {
      const bs = splitBlocks(file, source);
      liveAst = buildAST(bs).ast;
    } catch (e) { liveErr = String((e as Error)?.message ?? e).slice(0, 200); }

    let nativeAst: unknown = null;
    let nativeErr: string | null = null;
    let nativeParseErrors: string[] = [];
    try {
      const r = nativeParseFile(file, source);
      if (r && r.ast) {
        if (!Array.isArray(r.errors)) r.errors = [];
        populateNativeAttrValueExprNodes(r.ast, r.filePath || file, r.errors);
        backfillNativeExprText(r.ast);
        nativeAst = r.ast;
        nativeParseErrors = (r.errors ?? []).map((e: any) => String(e?.code ?? e?.message ?? e).slice(0, 80));
      } else {
        nativeErr = "nativeParseFile returned no ast";
      }
    } catch (e) { nativeErr = String((e as Error)?.message ?? e).slice(0, 200); }

    return { liveAst, liveErr, nativeAst, nativeErr, nativeParseErrors };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
const codes = JSON.parse(readFileSync(join(OUT, "codes.json"), "utf8")) as any[];
const byRelDir = new Map(codes.map((r) => [r.relDir, r]));
const cases = loadCases();

const targets = cases.filter((c) => (byRelDir.get(c.relDir)?.newlyMissing ?? []).length > 0);
console.log(`cases with newlyMissing: ${targets.length}`);

const rows: any[] = [];
let n = 0;
for (const c of targets) {
  n++;
  if (n % 25 === 0) console.log(`  ... ${n}/${targets.length}`);
  const p = parseBoth(c.source, c.auxFiles);
  let sigs: string[] = [];
  let note = "";
  if (p.liveErr) note = `LIVE-THREW: ${p.liveErr}`;
  else if (p.nativeErr) note = `NATIVE-THREW: ${p.nativeErr}`;
  else sigs = signatures(profile(p.liveAst), profile(p.nativeAst));
  rows.push({
    relDir: c.relDir,
    id: c.expected.id,
    newlyMissing: byRelDir.get(c.relDir).newlyMissing,
    nativeParseErrors: p.nativeParseErrors,
    note,
    sigs,
  });
}

writeFileSync(join(OUT, "astdiff.json"), JSON.stringify(rows, null, 2), "utf8");

// --- clustering -------------------------------------------------------------
const sigHist = new Map<string, number>();
for (const r of rows) for (const s of r.sigs) sigHist.set(s, (sigHist.get(s) ?? 0) + 1);
const noSig = rows.filter((r) => r.sigs.length === 0);
const threw = rows.filter((r) => r.note);

console.log("");
console.log(`cases profiled                    : ${rows.length}`);
console.log(`cases with ZERO AST divergence    : ${noSig.length}`);
console.log(`cases where a parse threw         : ${threw.length}`);
console.log(`cases with native parse ERRORS    : ${rows.filter((r) => r.nativeParseErrors.length > 0).length}`);
console.log(`distinct divergence signatures    : ${sigHist.size}`);
console.log("");
console.log("top signatures by case coverage:");
for (const [s, v] of [...sigHist].sort((a, b) => b[1] - a[1]).slice(0, 45)) {
  console.log(`  ${String(v).padStart(4)}/${rows.length}  ${s}`);
}
console.log("");
console.log("cases with ZERO AST divergence (the code stopped firing for a NON-field reason):");
for (const r of noSig.slice(0, 40)) {
  console.log(`  ${r.relDir}  missing=${JSON.stringify(r.newlyMissing)} nativeErrs=${JSON.stringify(r.nativeParseErrors.slice(0, 3))}`);
}
