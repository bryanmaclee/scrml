#!/usr/bin/env bun
/**
 * two-wins-probe.mjs — §7.5.1 position-1 / position-2 assignability matrix,
 * PLUS the two-sided negatives the widening must not break.
 *
 * change-id: type-enforcement-two-wins-2026-09-06
 *
 * WHY THIS EXISTS. The scoping dispatch measured the position-1 literal set by
 * a matrix over {number,string,boolean} x {string,number,bool,template}. That
 * matrix only asks "does the WRONG program get rejected". It never asks the
 * other half — "does the RIGHT program still compile silently" — and a literal-
 * set widening reaches a SECOND consumer of the same classifier: §53.4's
 * predicate zone (`classifyPredicateZone`), where a `literal` SourceInfo is
 * evaluated at COMPILE TIME and the runtime guard is ELIDED.
 *
 * So this probe runs three groups:
 *
 *   POS1 / POS2 MATRIX  — 12 cells each (4 diagonal must stay silent, 8 off-
 *                         diagonal must fire E-TYPE-031).
 *   PREDICATE NEGATIVES — valid programs at a PREDICATED annotation. These are
 *                         the ones the widening can break: an INTERPOLATED
 *                         template literal has no compile-time value (the
 *                         parser records `value: ""` for a multi-quasi
 *                         template), so classifying it as a `literal` would
 *                         (a) statically evaluate the predicate against the
 *                         empty string — a FALSE E-CONTRACT-001 on valid code —
 *                         and (b) elide the runtime guard that today protects
 *                         the position.
 *   GENERAL NEGATIVES   — plain correct programs, no annotation mismatch.
 *
 * Every row is compiled through `compileScrml()`; nothing is read off the type
 * checker's source.
 *
 * Run: bun docs/changes/type-enforcement-two-wins-2026-09-06/two-wins-probe.mjs
 */

import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..', '..');
const WORK = join(HERE, 'probe-fixtures');

const { compileScrml } = await import(join(REPO, 'compiler', 'src', 'api.js'));

const RUNTIME_GUARD_MARKER = 'E-CONTRACT-001-RT';

const ANNOTS = ['number', 'string', 'boolean'];
/** literal source text -> the primitive type it denotes */
const LITERALS = [
  { tag: 'str', src: '"nope"', denotes: 'string' },
  { tag: 'num', src: '42', denotes: 'number' },
  { tag: 'bool', src: 'true', denotes: 'boolean' },
  { tag: 'tpl', src: '`tpl`', denotes: 'string' },
];

const rows = [];

// ── POS 1: annotated `let` declaration ──────────────────────────────────────
for (const a of ANNOTS) {
  for (const l of LITERALS) {
    rows.push({
      group: 'POS1',
      id: `pos1-${a}-${l.tag}`,
      what: `let v: ${a} = ${l.src}`,
      src: ['${', `    let v: ${a} = ${l.src}`, '    log(v)', '}', ''].join('\n'),
      expect: a === l.denotes ? 'SILENT' : 'E-TYPE-031',
    });
  }
}

// ── POS 2: annotated state-cell declaration ─────────────────────────────────
for (const a of ANNOTS) {
  for (const l of LITERALS) {
    rows.push({
      group: 'POS2',
      id: `pos2-${a}-${l.tag}`,
      what: `<v>: ${a} = ${l.src}`,
      src: [`<v>: ${a} = ${l.src}`, 'log(@v)', ''].join('\n'),
      expect: a === l.denotes ? 'SILENT' : 'E-TYPE-031',
    });
  }
}

// ── PREDICATE NEGATIVES — valid programs at a §53 predicated annotation ─────
// Each of these compiles clean TODAY. A literal-set widening that makes any of
// them error is a two-sided failure, not a win.
rows.push({
  group: 'PRED-NEG',
  id: 'pred-tpl-static-passes',
  what: 'string(.length >= 5) = `hello world`  (static template, satisfies)',
  src: ['${', '    let s: string(.length >= 5) = `hello world`', '    log(s)', '}', ''].join('\n'),
  expect: 'SILENT',
});
rows.push({
  group: 'PRED-NEG',
  id: 'pred-tpl-interp',
  what: 'string(.length >= 5) = `${a} world` (INTERPOLATED — value unknown)',
  src: ['${', '    let a = "hello"', '    let s: string(.length >= 5) = `${a} world`', '    log(s)', '}', ''].join('\n'),
  expect: 'SILENT',
  wantGuard: true,
});
rows.push({
  group: 'PRED-NEG',
  id: 'pred-tpl-interp-email',
  what: 'string(email) = `${u}@example.com` (INTERPOLATED named shape)',
  src: ['${', '    let u = "bryan"', '    let s: string(email) = `${u}@example.com`', '    log(s)', '}', ''].join('\n'),
  expect: 'SILENT',
  wantGuard: true,
});
rows.push({
  group: 'PRED-NEG',
  id: 'pred-cell-tpl-static',
  what: 'state cell <s>: string(.length >= 5) = `hello world` (static, satisfies)',
  src: ['<s>: string(.length >= 5) = `hello world`', 'log(@s)', ''].join('\n'),
  expect: 'SILENT',
});
rows.push({
  group: 'UPSTREAM-BUG',
  id: 'bug-cell-tpl-interp',
  // ⚑ FLIP MARKER. This row asserts a BUG, on purpose, so that fixing the bug
  // turns a green row red rather than passing unnoticed.
  //
  // A state-cell initialized with an INTERPOLATED template literal loses its
  // initializer entirely before the type system ever sees it: the parsed
  // `initExpr` is `lit{ litType:"template", raw:"``", value:"" }` and codegen
  // emits `_scrml_cs_init_set("s", () => ``)` — the empty string. That is a
  // PRE-EXISTING data-loss defect (it reproduces with no annotation at all, and
  // on the un-predicated form, neither of which this change touches); the
  // static form `<s> = `hello world`` emits correctly.
  //
  // The consequence for §7.5.1 is that the S402 literal-set widening reasons
  // correctly about an AST that is already wrong, and reports
  // `E-CONTRACT-001 … Value  does not satisfy the predicate` — an empty value
  // the author never wrote. Fixing the drop is upstream work; when it lands,
  // this row must become SILENT +guard.
  what: '⚑ FLIP — <s>: string(.length >= 5) = `${@a} world`; init is DROPPED upstream',
  src: ['<a> = "hello"', '<s>: string(.length >= 5) = `${@a} world`', 'log(@s)', ''].join('\n'),
  expect: 'E-CONTRACT-001',
});
rows.push({
  group: 'PRED-NEG',
  id: 'pred-tpl-interp-shortfall',
  what: 'string(.length >= 5) = `${a}` where a="hi" — NOT statically decidable',
  src: ['${', '    let a = "hi"', '    let s: string(.length >= 5) = `${a}`', '    log(s)', '}', ''].join('\n'),
  expect: 'SILENT',
  wantGuard: true,
});
rows.push({
  group: 'PRED-POS',
  id: 'pred-tpl-static-fails',
  what: 'string(.length >= 5) = `hi` — a STATIC template IS statically decidable',
  src: ['${', '    let s: string(.length >= 5) = `hi`', '    log(s)', '}', ''].join('\n'),
  expect: 'E-CONTRACT-001',
});
rows.push({
  group: 'PRED-POS',
  id: 'pred-str-static-fails-control',
  what: 'string(.length >= 5) = "hi" — the double-quoted control for the row above',
  src: ['${', '    let s: string(.length >= 5) = "hi"', '    log(s)', '}', ''].join('\n'),
  expect: 'E-CONTRACT-001',
});
rows.push({
  group: 'PRED-NEG',
  id: 'pred-bool-at-numeric',
  what: 'number(>0) = true — predicated, so §7.5.1 pos 1 does not apply; guard stands',
  src: ['${', '    let x: number(>0) = true', '    log(x)', '}', ''].join('\n'),
  expect: 'SILENT',
  wantGuard: true,
});
rows.push({
  group: 'PRED-NEG',
  id: 'pred-static-num-ok',
  what: 'number(>0) = 5  (control — already static today)',
  src: ['${', '    let x: number(>0) = 5', '    log(x)', '}', ''].join('\n'),
  expect: 'SILENT',
});

// ── GENERAL NEGATIVES — plain correct programs ──────────────────────────────
rows.push({
  group: 'NEG',
  id: 'neg-bool-unannotated',
  what: 'let flag = true (un-annotated bool — must not warn UNPROVEN)',
  src: ['${', '    let flag = true', '    log(flag)', '}', ''].join('\n'),
  expect: 'SILENT',
  wantNoWarn: 'W-TYPE-031-UNPROVEN',
});
rows.push({
  group: 'NEG',
  id: 'neg-tpl-unannotated',
  what: 'let s = `hi` (un-annotated template — must not warn UNPROVEN)',
  src: ['${', '    let s = `hi`', '    log(s)', '}', ''].join('\n'),
  expect: 'SILENT',
  wantNoWarn: 'W-TYPE-031-UNPROVEN',
});
rows.push({
  group: 'NEG',
  id: 'neg-tpl-interp-unannotated',
  what: 'let s = `${a}!` (interpolated, un-annotated)',
  src: ['${', '    let a = "hi"', '    let s = `${a}!`', '    log(s)', '}', ''].join('\n'),
  expect: 'SILENT',
  wantNoWarn: 'W-TYPE-031-UNPROVEN',
});
rows.push({
  group: 'NEG',
  id: 'neg-annot-tpl-string',
  what: 'let s: string = `${a}!` (interpolated into `string` — valid)',
  src: ['${', '    let a = "hi"', '    let s: string = `${a}!`', '    log(s)', '}', ''].join('\n'),
  expect: 'SILENT',
});
rows.push({
  group: 'NEG',
  id: 'neg-cell-bool',
  what: '<flag>: boolean = true',
  src: ['<flag>: boolean = true', 'log(@flag)', ''].join('\n'),
  expect: 'SILENT',
});
rows.push({
  group: 'NEG',
  id: 'neg-cell-int',
  what: '<n>: int = "s" — `int` is OUTSIDE §7.5.1’s enumerated set, stays silent',
  src: ['<n>: int = "s"', 'log(@n)', ''].join('\n'),
  expect: 'SILENT',
});
rows.push({
  group: 'NEG',
  id: 'neg-cell-no-annot',
  what: '<n> = 0 (no annotation)',
  src: ['<n> = 0', 'log(@n)', ''].join('\n'),
  expect: 'SILENT',
});
rows.push({
  group: 'NEG',
  id: 'neg-cell-optional-not',
  what: '<s>: string | not = not',
  src: ['<s>: string | not = not', 'log(@s)', ''].join('\n'),
  expect: 'SILENT',
});

// ── run ─────────────────────────────────────────────────────────────────────

rmSync(WORK, { recursive: true, force: true });
mkdirSync(WORK, { recursive: true });

function compileOne(file) {
  try {
    return compileScrml({ inputFiles: [file], write: false });
  } catch (err) {
    return { errors: [{ code: '(threw)', message: String(err && err.message) }], warnings: [], lintDiagnostics: [] };
  }
}

function hasRuntimeGuard(result) {
  const outs = result.outputs;
  if (!outs || typeof outs.values !== 'function') return false;
  for (const o of outs.values()) {
    for (const k of ['clientJs', 'serverJs', 'libraryJs']) {
      if (o && typeof o[k] === 'string' && o[k].includes(RUNTIME_GUARD_MARKER)) return true;
    }
  }
  return false;
}

let failures = 0;
const out = [];
for (const r of rows) {
  const f = join(WORK, `${r.id}.scrml`);
  writeFileSync(f, r.src);
  const res = compileOne(f);
  const errs = (res.errors || []).map((d) => d.code || '(uncoded)');
  const warns = (res.warnings || []).map((d) => d.code || d.rule || '(uncoded)');
  const guard = hasRuntimeGuard(res);

  let ok;
  if (r.expect === 'SILENT') ok = errs.length === 0;
  else ok = errs.includes(r.expect);
  if (r.wantGuard !== undefined && ok) ok = guard === r.wantGuard;
  if (r.wantNoWarn !== undefined && ok) ok = !warns.includes(r.wantNoWarn);
  if (!ok) failures++;

  out.push({
    group: r.group,
    id: r.id,
    what: r.what,
    expect: r.expect
      + (r.wantGuard === undefined ? '' : r.wantGuard ? ' +guard' : ' -guard')
      + (r.wantNoWarn === undefined ? '' : ' no-' + r.wantNoWarn.replace('W-TYPE-031-', '')),
    got: (errs.length ? errs.join(',') : 'silent') + (guard ? ' +guard' : ''),
    warns: warns.join(',') || '—',
    ok,
    msgs: (res.errors || []).map((d) => (d.message || '').split('\n')[0]),
  });
}

const W_ID = Math.max(...out.map((r) => r.id.length));
const W_WHAT = Math.max(...out.map((r) => r.what.length));
console.log('');
console.log('§7.5.1 two-wins probe — every row VERIFIED BY EXECUTION');
console.log('');
console.log(`| ${'id'.padEnd(W_ID)} | ${'what'.padEnd(W_WHAT)} | ${'expect'.padEnd(18)} | ${'got'.padEnd(20)} | warnings`);
console.log(`|${'-'.repeat(W_ID + 2)}|${'-'.repeat(W_WHAT + 2)}|${'-'.repeat(20)}|${'-'.repeat(22)}|${'-'.repeat(10)}`);
let lastGroup = null;
for (const r of out) {
  if (r.group !== lastGroup) { console.log(`|  ── ${r.group} ──`); lastGroup = r.group; }
  console.log(`| ${(r.ok ? ' ' : '!') + r.id.padEnd(W_ID - 1)} | ${r.what.padEnd(W_WHAT)} | ${r.expect.padEnd(18)} | ${r.got.padEnd(20)} | ${r.warns}`);
}
console.log('');
for (const r of out.filter((x) => !x.ok)) {
  console.log(`MISMATCH ${r.id}: expected ${r.expect}, got ${r.got}`);
  for (const m of r.msgs) console.log(`    ${m}`);
}
console.log('');
console.log(`rows ${out.length}   matching ${out.length - failures}   MISMATCHED ${failures}`);
process.exit(failures ? 1 : 0);
