#!/usr/bin/env bun
/**
 * pos3-migration-probe.mjs — MEASURE the migration cost of widening SPEC §7.5.1
 * position 3 (call-site argument assignability) over the shipped corpus.
 *
 * change-id: base-annotation-enforcement-scoping-2026-09-06
 *
 * THIS IS A MEASURING INSTRUMENT, NOT A GATE. It never fails a build, is not
 * wired into CI, and the compiler-side probe it drives (`__pos3Probe` in
 * `compiler/src/type-system.ts`) pushes nothing into `errors` and is inert
 * unless `SCRML_POS3_PROBE=1`.
 *
 * WHY A PROBE INSIDE THE COMPILER RATHER THAN A STANDALONE AST WALK. The
 * question is "how many sites would a REAL implementation of position 3
 * newly reject", and a real implementation would sit exactly where
 * `inferBareVariantsAtCallArgs` already sits: at the five expression contexts
 * where the type system already resolves a callee against `fnSignatures`.
 * A standalone walk would answer a DIFFERENT question — how many sites a
 * hypothetical checker with hypothetical reach would flag — and would silently
 * over-count the sites the real checker cannot even see.
 *
 * THREE POWER LEVELS, because "the migration" is not one number. §7.5.1's ruled
 * widening order puts the LITERAL SET before position 3, so the honest answer is
 * a cost CURVE:
 *   L1 — exactly today's `inferExprType` (number / string / negated number).
 *   L2 — L1 + bool / template / `not` literals + uniform array literals.
 *   L3 — L2 + the decl-site cascade (scope-chain idents, annotated fn returns).
 *
 * PARTITIONING. A file that ALREADY fails to compile is not migration cost — it
 * is pre-existing breakage. Sites are reported separately for files that
 * compile clean today (the real migration) and files that do not.
 *
 * Run:
 *   bun docs/changes/base-annotation-enforcement-scoping-2026-09-06/pos3-migration-probe.mjs
 *   ... --dirs=examples,samples,stdlib,conformance,benchmarks    (default)
 *   ... --dirs=compiler/self-host
 *   ... --program=examples/23-trucking-dispatch   (compile a DIR as one program)
 *   ... --json=<path>                             (dump every hit)
 */

import { readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..', '..');

process.env.SCRML_POS3_PROBE = '1';
globalThis.__POS3_HITS = [];
globalThis.__POS3_COUNTS = {};

const { compileScrml } = await import(join(REPO, 'compiler', 'src', 'api.js'));

const argv = process.argv.slice(2);
const flag = (name, dflt) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : dflt;
};

const DIRS = flag('dirs', 'examples,samples,stdlib,conformance,benchmarks').split(',').filter(Boolean);
const PROGRAM = flag('program', null);
const JSON_OUT = flag('json', null);

function walkScrml(dir, out) {
  let entries;
  try { entries = readdirSync(join(REPO, dir)); } catch { return out; }
  for (const e of entries) {
    const rel = join(dir, e);
    const abs = join(REPO, rel);
    let st;
    try { st = statSync(abs); } catch { continue; }
    if (st.isDirectory()) { if (e !== 'node_modules' && e !== 'dist') walkScrml(rel, out); }
    else if (e.endsWith('.scrml')) out.push(rel);
  }
  return out;
}

/** One compile unit. Returns { errorsBefore, hits }. */
function runUnit(inputFiles) {
  globalThis.__POS3_HITS = [];
  let errorsBefore = -1;
  try {
    const res = compileScrml({ inputFiles: inputFiles.map((f) => join(REPO, f)), write: false, verbose: false });
    errorsBefore = res.errors.length;
  } catch (e) {
    errorsBefore = -1;                       // compiler THREW — not a diagnostic
  }
  return { errorsBefore, hits: globalThis.__POS3_HITS.slice() };
}

const units = PROGRAM
  ? [{ label: PROGRAM, files: walkScrml(PROGRAM, []) }]
  : DIRS.flatMap((d) => walkScrml(d, []).map((f) => ({ label: f, files: [f] })));

if (units.length === 0) { console.error('probe: enumeration produced ZERO units — refusing to report.'); process.exit(2); }

const LEVELS = ['L1', 'L2', 'L3'];
const stats = {
  units: units.length,
  compiledClean: 0,
  alreadyFailing: 0,
  threw: 0,
  byLevel: Object.fromEntries(LEVELS.map((l) => [l, { sites: 0, filesClean: new Set(), sitesInFailing: 0 }])),
};
const allHits = [];

let n = 0;
for (const u of units) {
  if (u.files.length === 0) continue;
  const { errorsBefore, hits } = runUnit(u.files);
  if (errorsBefore === -1) stats.threw++;
  else if (errorsBefore === 0) stats.compiledClean++;
  else stats.alreadyFailing++;

  // Dedup: the same call site is walked by more than one of the five contexts.
  const seen = new Set();
  for (const h of hits) {
    const key = `${h.file}|${h.line}|${h.fn}|${h.argIndex}|${h.level}|${h.argSrc}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const rec = { ...h, unit: u.label, errorsBefore };
    allHits.push(rec);
    const b = stats.byLevel[h.level];
    if (errorsBefore === 0) { b.sites++; b.filesClean.add(u.label); }
    else b.sitesInFailing++;
  }
  if (++n % 200 === 0) console.error(`  ... ${n}/${units.length}`);
}

const pad = (s, w) => String(s).padEnd(w);
console.log('');
console.log(`POSITION 3 (call-site argument assignability) — MIGRATION MEASUREMENT`);
console.log(`units: ${stats.units}   compile-clean today: ${stats.compiledClean}   already-failing: ${stats.alreadyFailing}   compiler threw: ${stats.threw}`);
console.log('');
console.log(`${pad('level', 6)} ${pad('NEW-REJECT sites', 18)} ${pad('files affected', 15)} ${pad('sites in already-failing files', 30)}`);
for (const l of LEVELS) {
  const b = stats.byLevel[l];
  console.log(`${pad(l, 6)} ${pad(b.sites, 18)} ${pad(b.filesClean.size, 15)} ${pad(b.sitesInFailing, 30)}`);
}
console.log('');
console.log('REACH — what the check could even SEE (the denominator; counts are per walk, not deduped)');
const C = globalThis.__POS3_COUNTS;
for (const k of Object.keys(C).sort()) console.log(`  ${pad(k, 28)} ${C[k]}`);
console.log('');

for (const l of LEVELS) {
  const rows = allHits.filter((h) => h.level === l && h.errorsBefore === 0);
  if (rows.length === 0) continue;
  console.log(`── ${l}: every NEW-REJECT site in a file that compiles clean today ──`);
  for (const h of rows) {
    console.log(`  ${h.unit}:${h.line}  ${h.fn}(arg ${h.argIndex} \`${h.param}\`)  declared=${h.declared}  inferred=${h.actual}  arg=${h.argKind}${h.argLitType ? '/' + h.argLitType : ''} \`${h.argSrc}\``);
  }
  console.log('');
}

if (JSON_OUT) {
  writeFileSync(join(REPO, JSON_OUT), JSON.stringify({ stats: { ...stats, byLevel: Object.fromEntries(LEVELS.map((l) => [l, { sites: stats.byLevel[l].sites, files: [...stats.byLevel[l].filesClean], sitesInFailing: stats.byLevel[l].sitesInFailing }])) }, hits: allHits }, null, 2));
  console.log(`json -> ${JSON_OUT}`);
}
