#!/usr/bin/env bun
/**
 * bridge-survey-repair.ts — STAGE 3: the CAUSAL test.
 *
 * SURVEY-ONLY. Touches NO compiler source, and in particular touches nothing
 * under compiler/native-parser/ (transition-FROZEN). The repairs below run in
 * THIS FILE, over the assembled native FileAST, and exist only to answer
 * "would carrying field X have made the diagnostic fire?".
 *
 * HOW IT INJECTS WITHOUT PATCHING ANYTHING
 * ----------------------------------------
 * `compileScrml` (compiler/src/api.js) already exposes a TAB-stage override:
 *
 *     : selfHostModules?.buildAST
 *       ? (bsResult) => selfHostModules.buildAST(bsResult)
 *
 * So passing `selfHostModules: { buildAST }` routes the parse through an
 * arbitrary function with no file patch and no `parser` option — which also
 * means no I-PARSER-NATIVE-SHADOW noise. The override here reproduces the
 * `useNativeParser` branch exactly (nativeParseFile ->
 * populateNativeAttrValueExprNodes -> backfillNativeExprText) and then applies
 * ONE named repair, so the delta is attributable to that repair alone.
 *
 * BASELINE DISCIPLINE
 * -------------------
 * The `none` repair is run first and MUST reproduce stage 1's 156 newly-missing
 * cases. If it does not, the injection point is not equivalent to the flip and
 * every repair number below it is void.
 */
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadCases } from "../../../conformance/run.ts";
import { compileScrml } from "../../../compiler/src/api.js";
import { nativeParseFile } from "../../../compiler/native-parser/parse-file.js";
import { buildAST as liveBuildAST } from "../../../compiler/src/ast-builder.js";
import { populateNativeAttrValueExprNodes } from "../../../compiler/src/native-walker/attrvalue-exprnode-walker.ts";
import { backfillNativeExprText } from "../../../compiler/src/native-walker/exprtext-backfill-walker.ts";

const HERE = import.meta.dir;
const OUT = join(HERE, "artifacts");
mkdirSync(OUT, { recursive: true });

// ---------------------------------------------------------------------------
// Repairs. Each takes the assembled native FileAST and mutates it in place.
// ---------------------------------------------------------------------------
function walk(n: any, fn: (o: any) => void, seen = new Set<object>()) {
  if (!n || typeof n !== "object") return;
  if (seen.has(n)) return;
  seen.add(n);
  if (Array.isArray(n)) { for (const v of n) walk(v, fn, seen); return; }
  fn(n);
  for (const v of Object.values(n)) if (v && typeof v === "object") walk(v, fn, seen);
}

const REPAIRS: Record<string, (ast: any) => void> = {
  none: () => {},

  /** P1 — populate every `logic` node's typeDecls index from its own body. */
  typeDecls: (ast) => {
    walk(ast, (o) => {
      if (o.kind === "logic" && Array.isArray(o.body) && Array.isArray(o.typeDecls) && o.typeDecls.length === 0) {
        o.typeDecls = o.body.filter((s: any) => s && s.kind === "type-decl");
      }
    });
  },

  /** The three `function-decl` keys live carries and native does not. */
  functionDeclKeys: (ast) => {
    walk(ast, (o) => {
      if (o.kind !== "function-decl") return;
      if (!("isHandleEscapeHatch" in o)) o.isHandleEscapeHatch = false;
      if (!("hasReturnType" in o)) o.hasReturnType = false;
      if (!("returnTypeAnnotation" in o)) o.returnTypeAnnotation = null;
    });
  },

  /** The two `engine-decl` opener flags live carries and native does not. */
  engineDeclKeys: (ast) => {
    walk(ast, (o) => {
      if (o.kind !== "engine-decl") return;
      if (!("openerEffectMalformed" in o)) o.openerEffectMalformed = false;
      if (!("serverFlagBare" in o)) o.serverFlagBare = false;
    });
  },

  /** All three field-level repairs at once — the "carry the missing keys" upper bound. */
  allFieldKeys: (ast) => {
    REPAIRS.typeDecls(ast);
    REPAIRS.functionDeclKeys(ast);
    REPAIRS.engineDeclKeys(ast);
  },
};

/**
 * ORACLE repairs — these read the LIVE AST for the same source and copy values onto the
 * native one. They are NOT implementable fixes (a fix cannot consult the parser it
 * replaces); they are MEASUREMENTS. Each isolates one class of divergence and answers
 * "how many of the 156 are caused by THIS class alone?".
 *
 * Matching is by (kind, name) then by (kind, ordinal) within the kind — good enough for a
 * bound: where the trees disagree structurally the match simply fails and the case is left
 * un-repaired, which biases the number DOWN, never up.
 */
const TEXT_KEYS = [
  "init", "expr", "condition", "raw", "bodyRaw", "typeAnnotation",
  "derivedExprText", "inlineMatchBody", "value", "body", "shorthandBodyRaw",
  "openerEffect", "serverSource", "initial", "initialCell",
];

function indexByKind(root: any) {
  const m = new Map<string, any[]>();
  walk(root, (o) => {
    const k = o.kind ?? o.type;
    if (typeof k !== "string") return;
    const arr = m.get(k) ?? [];
    arr.push(o);
    m.set(k, arr);
  });
  return m;
}

function oracleCopy(nativeAst: any, liveAst: any, keys: string[]) {
  const li = indexByKind(liveAst);
  const ni = indexByKind(nativeAst);
  for (const [kind, nnodes] of ni) {
    const lnodes = li.get(kind);
    if (!lnodes) continue;
    for (let i = 0; i < nnodes.length; i++) {
      const nn = nnodes[i];
      // prefer a name match, else same-ordinal
      let ln = typeof nn.name === "string" ? lnodes.find((x: any) => x.name === nn.name) : undefined;
      if (!ln) ln = lnodes[i];
      if (!ln) continue;
      for (const k of keys) {
        if (k in ln && typeof ln[k] !== "object") nn[k] = ln[k];
      }
    }
  }
}

const ORACLES: Record<string, string[]> = {
  oracleText: TEXT_KEYS,
};

function makeBuildAST(name: string) {
  return (bsResult: any) => {
    const filePath = bsResult.filePath;
    const source = readFileSync(filePath, "utf8");
    const r = nativeParseFile(filePath, source);
    if (r && r.ast) {
      if (!Array.isArray(r.errors)) r.errors = [];
      populateNativeAttrValueExprNodes(r.ast, r.filePath || filePath, r.errors);
      backfillNativeExprText(r.ast);
      if (name in ORACLES) {
        // bsResult IS the live BS output for this file, so buildAST(bsResult) is the live
        // TAB result — the oracle, obtained without re-splitting.
        const liveAst = liveBuildAST(bsResult).ast;
        oracleCopy(r.ast, liveAst, ORACLES[name]);
      } else {
        REPAIRS[name](r.ast);
      }
    }
    return r;
  };
}

function compileWith(source: string, aux: Record<string, string>, repairName: string): string[] {
  const dir = mkdtempSync(join(tmpdir(), "scrml-repair-"));
  try {
    const file = join(dir, "case.scrml");
    writeFileSync(file, source, "utf8");
    for (const [n, s] of Object.entries(aux)) writeFileSync(join(dir, n), s, "utf8");
    const result = compileScrml({
      inputFiles: [file],
      write: false,
      outputDir: join(dir, "out"),
      log: () => {},
      selfHostModules: { buildAST: makeBuildAST(repairName) },
    }) as { errors?: Array<{ code?: string }>; warnings?: Array<{ code?: string }> };
    const set = new Set<string>();
    for (const d of result.errors ?? []) if (d?.code) set.add(d.code);
    for (const d of result.warnings ?? []) if (d?.code) set.add(d.code);
    return [...set];
  } catch {
    return [];
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
const stage1 = JSON.parse(readFileSync(join(OUT, "codes.json"), "utf8")) as any[];
const byRelDir = new Map(stage1.map((r) => [r.relDir, r]));
const targets = loadCases().filter((c) => (byRelDir.get(c.relDir)?.newlyMissing ?? []).length > 0);
console.log(`target cases (stage-1 newlyMissing): ${targets.length}`);

const names = process.argv.slice(2).length > 0
  ? process.argv.slice(2)
  : [...Object.keys(REPAIRS), ...Object.keys(ORACLES)];
const summary: Record<string, { stillMissing: number; recovered: string[] }> = {};

for (const name of names) {
  let stillMissing = 0;
  const recovered: string[] = [];
  for (const c of targets) {
    const want: string[] = byRelDir.get(c.relDir).newlyMissing;
    const got = new Set(compileWith(c.source, c.auxFiles, name));
    const remaining = want.filter((k) => !got.has(k));
    if (remaining.length > 0) stillMissing++;
    else recovered.push(c.relDir);
  }
  summary[name] = { stillMissing, recovered };
  console.log(
    `repair=${name.padEnd(16)} still-missing ${String(stillMissing).padStart(3)}/${targets.length}` +
      `   RECOVERED ${recovered.length}`,
  );
  if (recovered.length > 0 && recovered.length <= 25) {
    for (const r of recovered) console.log(`      + ${r}`);
  }
}

writeFileSync(join(OUT, "repair.json"), JSON.stringify(summary, null, 2), "utf8");
