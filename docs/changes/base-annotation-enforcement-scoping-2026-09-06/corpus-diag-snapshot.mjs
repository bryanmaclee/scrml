#!/usr/bin/env bun
/**
 * corpus-diag-snapshot.mjs — snapshot the diagnostic CODE SET every corpus file
 * produces, so two compiler states can be diffed exactly.
 *
 * change-id: base-annotation-enforcement-scoping-2026-09-06
 *
 * MEASURING INSTRUMENT, not a gate. Used to measure the blast radius of a
 * candidate widening: snapshot on a clean tree, apply the candidate, snapshot
 * again, `--diff` the two. A widening's migration cost is exactly the set of
 * files that gain an ERROR they did not have.
 *
 * Run:
 *   bun .../corpus-diag-snapshot.mjs --out=<path>
 *   bun .../corpus-diag-snapshot.mjs --diff=<before>,<after>
 */

import { readdirSync, statSync, writeFileSync, readFileSync } from 'node:fs';
import { join, dirname, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

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
  let gainedErr = 0, lostErr = 0, gainedWarn = 0, lostWarn = 0;
  const lines = [];
  for (const f of Object.keys(B)) {
    const before = A[f] ?? { e: [], w: [] };
    const after = B[f];
    const ge = after.e.filter((c) => !before.e.includes(c));
    const le = before.e.filter((c) => !after.e.includes(c));
    const gw = after.w.filter((c) => !before.w.includes(c));
    const lw = before.w.filter((c) => !after.w.includes(c));
    if (ge.length || le.length || gw.length || lw.length) {
      lines.push(`${f}\n    +E ${ge.join(',') || '—'}   -E ${le.join(',') || '—'}   +W ${gw.join(',') || '—'}   -W ${lw.join(',') || '—'}`);
      gainedErr += ge.length; lostErr += le.length; gainedWarn += gw.length; lostWarn += lw.length;
    }
  }
  console.log(`files changed: ${lines.length}   +errors ${gainedErr}  -errors ${lostErr}  +warnings ${gainedWarn}  -warnings ${lostWarn}`);
  console.log(lines.join('\n'));
  process.exit(0);
}

const { compileScrml } = await import(join(REPO, 'compiler', 'src', 'api.js'));

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

const files = DIRS.flatMap((d) => walk(d, []));
if (files.length === 0) { console.error('enumeration produced ZERO files — refusing.'); process.exit(2); }

const snap = {};
let n = 0;
for (const f of files) {
  let e = [], w = [];
  try {
    const r = compileScrml({ inputFiles: [join(REPO, f)], write: false, verbose: false });
    e = [...new Set(r.errors.map((x) => x.code ?? 'NOCODE'))].sort();
    w = [...new Set((r.warnings ?? []).map((x) => x.code ?? 'NOCODE'))].sort();
  } catch (err) { e = ['THREW']; }
  snap[f] = { e, w };
  if (++n % 300 === 0) console.error(`  ... ${n}/${files.length}`);
}
writeFileSync(rp(OUT), JSON.stringify(snap, null, 0));
console.error(`snapshot: ${files.length} files -> ${OUT}`);
