// measure-corpus.js — the MIGRATION measure for s442-bootstrap-typer-rules (brief §5):
// run the bootstrap front end (lex → parse → analyze → lower, compiled by impl#1) over every
// conformance case source (the ingest corpus) and record each case's diagnostic codes.
//
//   bun docs/changes/s442-bootstrap-typer-rules/measure-corpus.js <out.json>
//   bun docs/changes/s442-bootstrap-typer-rules/measure-corpus.js --diff <base.json> <new.json>
//
// The diff lists, per diagnostic code, the cases that newly carry it (and the ones that lost it),
// so a newly-rejecting rule reports its corpus rejections BY CASE NAME. A case whose front end
// throws is recorded as the pseudo-code "CRASH".

import { readdirSync, readFileSync, statSync, writeFileSync, existsSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = join(import.meta.dir, "..", "..", "..");
const CASES = join(ROOT, "conformance", "cases");

function caseDirs(dir, out = []) {
  for (const n of readdirSync(dir).sort()) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) caseDirs(p, out);
    else if (n === "case.scrml") out.push(dir);
  }
  return out;
}

function tally(m) {
  const t = {};
  for (const codes of Object.values(m)) for (const c of codes) t[c] = (t[c] || 0) + 1;
  return t;
}

// EXIT CODES (--diff): 0 = no case moved from clean (no diagnostic) to non-clean, and both runs
// hold the same case set; 1 = a clean → non-clean move (a newly-REJECTED program) or a case
// present in one run and missing from the other (a truncated / crashed run must not pass).
if (process.argv[2] === "--diff") {
  const a = JSON.parse(readFileSync(process.argv[3], "utf8"));
  const b = JSON.parse(readFileSync(process.argv[4], "utf8"));
  const gained = {};
  const lost = {};
  const count = (xs) => xs.reduce((m, c) => ((m[c] = (m[c] || 0) + 1), m), {});
  let changed = 0;
  const missingFromNew = Object.keys(a).filter((rel) => !(rel in b));
  const missingFromBase = Object.keys(b).filter((rel) => !(rel in a));
  const newlyRejected = Object.keys(b).filter((rel) => rel in a && a[rel].length === 0 && b[rel].length > 0);
  for (const rel of Object.keys(b)) {
    if (!(rel in a)) continue;
    const ca = count(a[rel]);
    const cb = count(b[rel]);
    let diff = false;
    for (const c of new Set([...Object.keys(ca), ...Object.keys(cb)])) {
      const d = (cb[c] || 0) - (ca[c] || 0);
      if (d > 0) (gained[c] ||= []).push(`${rel} (+${d})`);
      if (d < 0) (lost[c] ||= []).push(`${rel} (${d})`);
      if (d !== 0) diff = true;
    }
    if (diff) changed++;
  }
  const clean = (m) => Object.values(m).filter((xs) => xs.length === 0).length;
  console.log(`cases: ${Object.keys(b).length} · changed: ${changed} · clean (no diagnostic): base ${clean(a)} → new ${clean(b)}`);
  for (const [c, xs] of Object.entries(gained).sort()) console.log(`\nGAINED ${c}: ${xs.length} case(s)\n  ` + xs.join("\n  "));
  for (const [c, xs] of Object.entries(lost).sort()) console.log(`\nLOST ${c}: ${xs.length} case(s)\n  ` + xs.join("\n  "));
  const list = (title, xs) => { if (xs.length > 0) console.log(`\n${title}: ${xs.length} case(s)\n  ` + xs.join("\n  ")); };
  list("NEWLY REJECTED (clean in base, diagnostics now)", newlyRejected.map((rel) => `${rel}: ${b[rel].join(", ")}`));
  list("MISSING FROM NEW (in base only)", missingFromNew);
  list("MISSING FROM BASE (in new only)", missingFromBase);
  const bad = newlyRejected.length + missingFromNew.length + missingFromBase.length;
  console.log(`\n${bad === 0 ? "OK" : "FAIL"}: ${newlyRejected.length} newly rejected, ${missingFromNew.length} missing from new, ${missingFromBase.length} missing from base`);
  process.exit(bad === 0 ? 0 : 1);
}

const out = process.argv[2];
if (!out) {
  console.error("usage: measure-corpus.js <out.json> | --diff <base.json> <new.json>");
  process.exit(2);
}
const { loadM2 } = await import(join(ROOT, "compiler/self-host-v2/slice-m2/harness.js"));
const { frontEnd } = await import(join(ROOT, "compiler/self-host-v2/slice-m2/lowered.js"));
const { mods } = loadM2();
const result = {};
for (const dir of caseDirs(CASES)) {
  const rel = relative(CASES, dir);
  const src = readFileSync(join(dir, "case.scrml"), "utf8");
  try {
    result[rel] = frontEnd(mods, [{ path: "case.scrml", src }]).diags.map((d) => d.code).sort();
  } catch (e) {
    result[rel] = ["CRASH"];
  }
}
writeFileSync(out, JSON.stringify(result, null, 1));
const t = tally(result);
const clean = Object.values(result).filter((xs) => xs.length === 0).length;
console.log(`${Object.keys(result).length} cases · ${clean} with no diagnostic`);
for (const [c, n] of Object.entries(t).sort((x, y) => y[1] - x[1]).slice(0, 40)) console.log(`  ${n}\t${c}`);
if (!existsSync(out)) process.exit(2);
