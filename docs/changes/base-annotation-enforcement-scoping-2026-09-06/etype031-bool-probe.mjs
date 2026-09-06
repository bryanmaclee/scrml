#!/usr/bin/env bun
/**
 * etype031-bool-probe.mjs — reproduce §7.5.1's ONE normative SHALL cell by cell,
 * and measure the blast radius of closing its two boolean-literal misses.
 *
 * change-id: base-annotation-enforcement-scoping-2026-09-06
 *
 * MEASURING INSTRUMENT, not a gate. Compiles each cell and prints the codes.
 * Run before and after a candidate fix to see (a) which cells close and
 * (b) which UNRELATED cells change — the fix widens `SourceInfo`, whose
 * `literal` arm feeds the §53 predicate-zone classifier, so "one missing
 * case" is not obviously local.
 *
 * Run: bun docs/changes/base-annotation-enforcement-scoping-2026-09-06/etype031-bool-probe.mjs
 */

import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..', '..');
const TMP = join(HERE, '.bool-probe-tmp');

const { compileScrml } = await import(join(REPO, 'compiler', 'src', 'api.js'));

const L = (...lines) => lines.join('\n') + '\n';

const CASES = [];

// ── §7.5.1 position 1, the full annotation x literal matrix ─────────────────
const ANNOTS = ['string', 'number', 'boolean', 'int'];
const LITS = { '"str"': '"str"', '42': '42', 'true': 'true', '`tpl`': '`tpl`' };
for (const a of ANNOTS) {
  for (const [lname, lsrc] of Object.entries(LITS)) {
    CASES.push({
      id: `pos1 ${a} = ${lname}`,
      src: L('${', `    let v: ${a} = ${lsrc}`, '    print(v)', '}'),
    });
  }
}

// ── the un-annotated arm (does the classifier feed inference?) ───────────────
CASES.push({ id: 'unannot let v = true', src: L('${', '    let v = true', '    print(v)', '}') });
CASES.push({ id: 'unannot let v = 42', src: L('${', '    let v = 42', '    print(v)', '}') });
CASES.push({ id: 'unannot let v = `t`', src: L('${', '    let v = `t`', '    print(v)', '}') });

// ── §53 predicate zone — the surface the widened SourceInfo also feeds ───────
CASES.push({ id: 'pred number(>0) = 50 (static, ok)', src: L('${', '    let v: number(>0) = 50', '    print(v)', '}') });
CASES.push({ id: 'pred number(>0) = -5 (static, FAIL)', src: L('${', '    let v: number(>0) = -5', '    print(v)', '}') });
CASES.push({ id: 'pred number(>0) = true (bool at predicated pos)', src: L('${', '    let v: number(>0) = true', '    print(v)', '}') });
CASES.push({ id: 'pred string(len>2) = true', src: L('${', '    let v: string(len>2) = true', '    print(v)', '}') });

// ── reactive cell (the SAME classifier, second call site) ────────────────────
CASES.push({ id: 'cell <n>: number = true', src: L('<n>: number = true', '${', '    print(@n)', '}') });
CASES.push({ id: 'cell <b>: boolean = true', src: L('<b>: boolean = true', '${', '    print(@b)', '}') });
CASES.push({ id: 'cell <n>: number(>0) = true', src: L('<n>: number(>0) = true', '${', '    print(@n)', '}') });

rmSync(TMP, { recursive: true, force: true });
mkdirSync(TMP, { recursive: true });

const pad = (s, w) => String(s).padEnd(w);
console.log(`${pad('case', 42)} ${pad('errors', 34)} warnings`);
console.log('-'.repeat(110));
for (let i = 0; i < CASES.length; i++) {
  const c = CASES[i];
  const f = join(TMP, `c${String(i).padStart(2, '0')}.scrml`);
  writeFileSync(f, c.src);
  let errs = [], warns = [];
  try {
    const r = compileScrml({ inputFiles: [f], write: false, verbose: false });
    errs = r.errors.map((e) => e.code ?? String(e).slice(0, 24));
    warns = (r.warnings ?? []).map((w) => w.code ?? String(w).slice(0, 24));
  } catch (e) {
    errs = [`THREW:${String(e.message ?? e).slice(0, 20)}`];
  }
  console.log(`${pad(c.id, 42)} ${pad(errs.join(',') || '—', 34)} ${warns.join(',') || '—'}`);
}
rmSync(TMP, { recursive: true, force: true });
