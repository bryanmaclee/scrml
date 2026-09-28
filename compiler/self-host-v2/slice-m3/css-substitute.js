// css-substitute.js — the bootstrap STYLESHEET substitute for the CSS sub-seam of CG
// (s440-bootstrap-css-theme-t3; compiler/src/pipeline-seam.ts `CSS`).
//
//   bun scripts/hybrid.ts --swap CSS=compiler/self-host-v2/slice-m3/css-substitute.js --footprint
//
// impl#1 still owns html / clientJs / serverJs (they swap only as one CG unit, dpa-051 §8.4); this
// substitute owns FileOutput.css's user-stylesheet part: impl#1's per-file FileAST → the stylesheet
// shim (../css-ingest.scrml) → the stylesheet Core (CssUnit) → the bootstrap emitter (../css.scrml).
// It is JS glue and makes no language decision of its own:
//   - `generateCss` refuses (throws) on a not-yet shape: the footprint grader grades only cases whose
//     footprint is inside the implemented set, and a silent partial sheet would be a guessed mapping.
//   - `footprint(cgArgs)` = the stylesheet constructs of every file of the compile + the not-yet
//     reasons (dpa-051 §8.2).
//   - `gradeCss` = the CSS HALF of the grade. Conformance never observes CSS (conformance/normalize.ts
//     defers computed style to v1.next), so a css pass is judged by the css oracle: spec-derived
//     computed-style assertions evaluated in real Chromium over the hybrid's build output
//     (css-oracle.js).
//
// THROWAWAY with ../css-ingest.scrml: delete it when the bootstrap front end produces the stylesheet
// Core from source.

import { join } from "node:path";
import { loadBundle, SELF_HOST_V2 } from "../slice-m1/harness.js";
import { makeEncoder } from "./encode.js";
import { closeBrowser, gradeCssCases, gradeSheet, oracleCores, oracleSources } from "./css-oracle.js";

export const CSS_MODULES = [
  "core.scrml",
  "walk.scrml",
  "measure.scrml",
  "ingest.scrml",
  "css.scrml",
  "css-ingest.scrml",
  "slice-m3/css.core.scrml",
];

/** The compiled stylesheet modules (css-ingest · css · the hand-built Cores), compiled once by impl#1. */
export function loadCss() {
  return loadBundle(join(SELF_HOST_V2, "slice-m3", "css-bundle.scrml"), CSS_MODULES);
}

const { mods } = loadCss();
const I = mods.ingest;
const CI = mods["css-ingest"];
const C = mods.css;
export const cssMods = mods;

const { encodeNode } = makeEncoder(I);

/** Ingest one file's AST. → { unit, why: string[] } */
export function ingestFile(ast, mode) {
  return CI.ingestCss(encodeNode(ast), mode ?? "browser");
}

/**
 * The FOOTPRINT of a compile: the union of every file's stylesheet constructs, and every file's
 * not-yet reasons (a multi-file program is graded only when every file is inside the set).
 */
export function footprint(cgArgs) {
  const constructs = new Set();
  const notYet = [];
  for (const f of cgArgs.files ?? []) {
    const r = ingestFile(f.ast, cgArgs.mode);
    if (r.why.length > 0) notYet.push(...r.why);
    else for (const c of C.cssFootprint(r.unit)) constructs.add(c);
  }
  return { constructs: notYet.length === 0 ? [...constructs].sort() : [], notYet: [...new Set(notYet)] };
}

/** The CSS stage entry: `(nodes, cssBlocks, errors, fileAST, { filePath, mode }) -> string`. */
export function generateCss(nodes, cssBlocks, errors, fileAST, ctx) {
  // CG passes the per-file record (`{ filePath, ast, … }`, an element of cgArgs.files) — the same
  // object footprint() reads `.ast` from.
  const r = ingestFile(fileAST?.ast ?? fileAST, ctx?.mode);
  if (r.why.length > 0) throw new Error(`css-ingest: not-yet — ${r.why.join("; ")}`);
  return C.emitCss(r.unit);
}

/**
 * The css half of the footprint grade (hybrid.ts calls it for the GRADED cases). `cases` =
 * [{ relDir, source, auxFiles }]; returns Map<relDir, { pass, reasons } | null> (null = no oracle).
 */
export async function gradeCss({ stageOverrides, cases }) {
  return gradeCssCases(stageOverrides, cases);
}

/** The css-only sources (css-oracle/sources/), classified + graded by the same footprint loop. */
export function cssExtraCases() {
  return oracleSources().map(({ relDir, source, auxFiles }) => ({ relDir, source, auxFiles }));
}

/**
 * The Core-level oracles (css-oracle/core/): a hand-built stylesheet Core (css.core.scrml) → the
 * bootstrap emitter → Chromium over the spec's page html. The §66.17 T3 shapes live here — impl#1's
 * front end rejects every T3 source, so they cannot arrive through the shim.
 */
export async function gradeCssCores({ only } = {}) {
  const out = [];
  for (const k of oracleCores()) {
    if (only && !only.has(k.relDir)) continue;
    const build = mods["css.core"][k.spec.core];
    if (typeof build !== "function") {
      out.push({ relDir: k.relDir, constructs: [], pass: false, reasons: [`css.core.scrml exports no \`${k.spec.core}\``] });
      continue;
    }
    const unit = build();
    const constructs = [...C.cssFootprint(unit)].sort();
    const r = await gradeSheet(C.emitCss(unit), k.spec.html, k.spec);
    out.push({ relDir: k.relDir, constructs, pass: r.pass, reasons: r.reasons });
  }
  return out;
}

export const closeCss = closeBrowser;
