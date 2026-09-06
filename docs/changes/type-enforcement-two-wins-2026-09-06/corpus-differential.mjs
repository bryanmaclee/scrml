#!/usr/bin/env bun
/**
 * corpus-differential.mjs — snapshot BOTH halves of a compile over the whole
 * corpus, so a widening can be shown to move DIAGNOSTICS and nothing else.
 *
 * change-id: type-enforcement-two-wins-2026-09-06
 *
 * WHY THIS EXISTS, and how it differs from the scoping dispatch's
 * `corpus-diag-snapshot.mjs` (which it otherwise mirrors): that instrument
 * records the diagnostic CODE SET only. A code-set delta of zero is NOT the
 * same claim as "the emitted artifact is unchanged" — a type-system widening
 * that re-classifies a §53 predicate zone changes whether codegen emits a
 * runtime guard, with no diagnostic to show for it. So this instrument hashes
 * the EMITTED OUTPUT per file as well, and reports the two deltas separately.
 *
 * MEASURING INSTRUMENT, not a gate.
 *
 * Both sides MUST be produced at the same `--compiler-root`: the whole point is
 * a two-state comparison of one compiler, so a snapshot taken against a
 * different checkout's `compiler/src` compares two variables at once.
 *
 * Run:
 *   bun .../corpus-differential.mjs --out=<path>
 *   bun .../corpus-differential.mjs --diff=<before>,<after>
 */

import { readdirSync, statSync, writeFileSync, readFileSync } from 'node:fs';
import { join, dirname, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..', '..');
const rp = (p) => (isAbsolute(p) ? p : join(REPO, p));

const argv = process.argv.slice(2);
const flag = (n, d) => { const h = argv.find((a) => a.startsWith(`--${n}=`)); return h ? h.slice(n.length + 3) : d; };

const DIFF = flag('diff', null);
if (DIFF) {
  const [a, b] = DIFF.split(',');
  const A = JSON.parse(readFileSync(rp(a), 'utf8'));
  const B = JSON.parse(readFileSync(rp(b), 'utf8'));
  if (A.compilerRoot !== B.compilerRoot) {
    console.error(`REFUSING: compiler roots differ.\n  before ${A.compilerRoot}\n  after  ${B.compilerRoot}`);
    process.exit(2);
  }
  let gainedErr = 0, lostErr = 0, gainedWarn = 0, lostWarn = 0, artifactChanged = 0;
  const diagLines = [];
  const artLines = [];
  const onlyIn = (x, y) => x.filter((c) => !y.includes(c));
  for (const f of Object.keys(B.files)) {
    const before = A.files[f] ?? { e: [], w: [], h: null };
    const after = B.files[f];
    const ge = onlyIn(after.e, before.e), le = onlyIn(before.e, after.e);
    const gw = onlyIn(after.w, before.w), lw = onlyIn(before.w, after.w);
    if (ge.length || le.length || gw.length || lw.length) {
      diagLines.push(`${f}\n    +E ${ge.join(',') || '—'}   -E ${le.join(',') || '—'}   +W ${gw.join(',') || '—'}   -W ${lw.join(',') || '—'}`);
      gainedErr += ge.length; lostErr += le.length; gainedWarn += gw.length; lostWarn += lw.length;
    }
    if (before.h !== after.h) { artifactChanged++; artLines.push(`${f}\n    ${before.h} -> ${after.h}`); }
  }
  const missing = Object.keys(A.files).filter((f) => !(f in B.files));
  console.log(`compiler root (both sides): ${A.compilerRoot}`);
  console.log(`files: before ${Object.keys(A.files).length}  after ${Object.keys(B.files).length}  present-only-in-before ${missing.length}`);
  console.log('');
  console.log(`DIAGNOSTIC delta — files changed: ${diagLines.length}   +errors ${gainedErr}  -errors ${lostErr}  +warnings ${gainedWarn}  -warnings ${lostWarn}`);
  if (diagLines.length) console.log(diagLines.join('\n'));
  console.log('');
  console.log(`ARTIFACT-CONTENT delta — files whose emitted output hash changed: ${artifactChanged}`);
  if (artLines.length) console.log(artLines.join('\n'));
  process.exit(0);
}

const COMPILER_ROOT = join(REPO, 'compiler', 'src');
const { compileScrml } = await import(join(COMPILER_ROOT, 'api.js'));

const DIRS = flag('dirs', 'examples,samples,stdlib,conformance,benchmarks').split(',').filter(Boolean);
const OUT = flag('out', null);
if (!OUT) { console.error('need --out=<path>'); process.exit(2); }

function walk(dir, out) {
  let es; try { es = readdirSync(join(REPO, dir)); } catch { return out; }
  for (const e of es) {
    const rel = join(dir, e); const abs = join(REPO, rel);
    let st; try { st = statSync(abs); } catch { continue; }
    if (st.isDirectory()) { if (e !== 'node_modules' && e !== 'dist') walk(rel, out); }
    else if (e.endsWith('.scrml')) out.push(rel);
  }
  return out;
}

/**
 * Hash the emitted artifact for one compile. Keys are sorted so Map iteration
 * order cannot show up as a false delta. `null` when nothing was emitted (an
 * errored compile) — a null-to-null comparison is not an artifact change.
 */
function hashOutputs(result) {
  const outs = result.outputs;
  if (!outs || typeof outs.entries !== 'function') return null;
  const parts = [];
  for (const [src, o] of [...outs.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    for (const k of Object.keys(o || {}).sort()) {
      const v = o[k];
      // `\0` as the field separator: `v` is arbitrary emitted JS, so any
      // printable delimiter could occur inside it and let two distinct
      // snapshots hash the same. Written as an ESCAPE, not as a literal NUL
      // byte, so this file stays ASCII and git treats it as text.
      if (typeof v === 'string') parts.push(`${src}\0${k}\0${v}`);
    }
  }
  if (parts.length === 0) return null;
  return createHash('sha256').update(parts.join('')).digest('hex').slice(0, 16);
}

const files = DIRS.flatMap((d) => walk(d, []));
if (files.length === 0) { console.error('enumeration produced ZERO files — refusing.'); process.exit(2); }

const snap = {};
let n = 0, threw = 0, emittedNothing = 0;
for (const f of files) {
  let e = [], w = [], h = null;
  try {
    const r = compileScrml({ inputFiles: [join(REPO, f)], write: false, verbose: false });
    e = [...new Set(r.errors.map((x) => x.code ?? 'NOCODE'))].sort();
    w = [...new Set((r.warnings ?? []).map((x) => x.code ?? 'NOCODE'))].sort();
    h = hashOutputs(r);
    if (h === null) emittedNothing++;
  } catch (err) { e = ['THREW']; threw++; }
  snap[f] = { e, w, h };
  if (++n % 300 === 0) console.error(`  ... ${n}/${files.length}`);
}
writeFileSync(rp(OUT), JSON.stringify({ compilerRoot: COMPILER_ROOT, files: snap }, null, 0));
console.error(`snapshot: ${files.length} files -> ${OUT}`);
console.error(`  SKIPPED POPULATIONS: compiler THREW on ${threw}; emitted NO artifact (errored or non-emitting) on ${emittedNothing}.`);
