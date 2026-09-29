// css-oracle-both.js — run every css oracle (conformance css halves + css-only sources) against
// PURE impl#1 and against the CSS-swapped hybrid, side by side (s440-bootstrap-css-theme-t3).
//
// The oracle is SPEC-derived, not impl#1-derived, so this is the R26 triage view: a row where impl#1
// FAILS is an impl#1 finding (or a bad oracle — triage it); a row where only the hybrid fails is a
// bootstrap bug. Parity between the two is NOT the grade.
//
//   bun compiler/self-host-v2/slice-m3/bench/css-oracle-both.js [--filter <substr>]

import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as sub from "../css-substitute.js";
import { closeBrowser, gradeBuilt, oracleFor, oracleSources, ORACLE_DIR } from "../css-oracle.js";

const CASES = join(import.meta.dir, "..", "..", "..", "..", "conformance", "cases");
const filter = (() => { const i = process.argv.indexOf("--filter"); return i === -1 ? null : process.argv[i + 1]; })();

const items = [];
for (const p of new Bun.Glob("conformance/**/*.json").scanSync({ cwd: ORACLE_DIR })) {
  const relDir = p.replace(/^conformance\//, "").replace(/\.json$/, "");
  items.push({ relDir, source: readFileSync(join(CASES, relDir, "case.scrml"), "utf8"), auxFiles: {}, spec: oracleFor(relDir) });
}
for (const s of oracleSources()) items.push(s);

let impl1Fails = 0, hybridFails = 0;
try {
  for (const it of items.sort((a, b) => a.relDir.localeCompare(b.relDir))) {
    if (filter && !it.relDir.includes(filter)) continue;
    const a = await gradeBuilt(`impl1-${it.relDir}`, it.source, it.auxFiles, null, it.spec);
    let b;
    try {
      b = await gradeBuilt(`hybrid-${it.relDir}`, it.source, it.auxFiles, { CSS: sub }, it.spec);
    } catch (e) {
      b = { pass: false, reasons: [String(e?.message ?? e).split("\n")[0]] };
    }
    if (!a.pass) impl1Fails++;
    if (!b.pass) hybridFails++;
    console.log(`${a.pass ? "pass" : "FAIL"}  ${b.pass ? "pass" : "FAIL"}  ${it.relDir}`);
    for (const r of a.reasons) console.log(`      impl#1: ${r}`);
    for (const r of b.reasons) console.log(`      hybrid: ${r}`);
  }
} finally {
  await closeBrowser();
}
console.log(`\nimpl#1 fails ${impl1Fails} · hybrid (CSS swapped) fails ${hybridFails}   (columns: impl#1, hybrid)`);
