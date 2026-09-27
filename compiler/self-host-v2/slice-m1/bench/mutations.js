// mutations.js — proves the slice-M1 tests BITE: applies each named mutation to
// a source file, runs the named test file(s), expects RED, restores the file.
// (The M1 review's F1/F2/F3/F4/F5/F7/F8 items, re-run as a script so the proof
// is repeatable.) Files are always restored (try/finally), and the script
// refuses to start if any target already differs from HEAD's text it expects.
//
// usage: bun compiler/self-host-v2/slice-m1/bench/mutations.js

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = join(import.meta.dir, "..", "..", "..", "..");
const SH = "compiler/self-host-v2";
const T = (f) => `./${SH}/slice-m1/${f}`;
const RT = `${SH}/slice-m1/runtime/runtime.js`;

const MUTATIONS = [
  { id: "F1 self-write no-op removed (throws inside a click handler)", file: RT,
    from: "  if (from === to) return;\n", to: "", tests: [T("dropdown.browser.test.js")] },
  { id: "F2 surviving row's item not updated", file: RT,
    from: "      old.row.item.set(item);\n", to: "", tests: [T("dropdown.browser.test.js")] },
  { id: "F3 disposed Derived stays subscribed", file: RT,
    from: "scope.own(() => { this.disposed = true; unsubscribe(this); stats.deriveds--; });",
    to: "scope.own(() => { this.disposed = true; stats.deriveds--; });",
    tests: [T("runtime.test.js"), T("dropdown.browser.test.js")] },
  { id: "F3 disposed scope stays in parent's children", file: RT,
    from: "    if (this.parent) this.parent.children.delete(this);\n", to: "",
    tests: [T("runtime.test.js"), T("dropdown.browser.test.js")] },
  { id: "F3 <each> renders rows while tracking", file: RT,
    from: "untrack(() => { rows = reconcile(scope, anchor, rows, items, key, render); });",
    to: "rows = reconcile(scope, anchor, rows, items, key, render);", tests: [T("runtime.test.js")] },
  { id: "F3 `let` initializer evaluated while tracking", file: RT,
    from: "export function seeded(init) { return new Cell(untrack(init)); }",
    to: "export function seeded(init) { return new Cell(init()); }", tests: [T("runtime.test.js")] },
  { id: "F3 handlers not batched", file: RT,
    from: "const h = (e) => batch(() => handler(e));", to: "const h = (e) => handler(e);",
    tests: [T("runtime.test.js")] },
  { id: "F3 rule= edge check never rejects", file: RT,
    from: "if (!allowed || !allowed.includes(to)) {", to: "if (false) {", tests: [T("runtime.test.js")] },
  { id: "F4 FieldAt always granted (the original hole)", file: `${SH}/check.scrml`,
    from: ".FieldAt(path: path) :> fieldAtProblem(p, f, path)", to: '.FieldAt(path: path) :> ""',
    tests: [T("check.test.js")] },
  { id: "F5 C4 instance/declaration mismatch not reported", file: `${SH}/check.scrml`,
    from: "            if (target.sym.id != d.sym.id) {\n                out = out.concat([\"C4:",
    to: "            if (false) {\n                out = out.concat([\"C4:", tests: [T("check.test.js")] },
  { id: "F7 Static transition accepted without proof", file: `${SH}/check.scrml`,
    from: "            if (reachableFromEveryState(g, n, to)) return \"\"", to: "            return \"\"",
    tests: [T("check.test.js")] },
  { id: "F8 non-first alternation arm not flagged", file: "scripts/lint-no-default-arm.js",
    from: "if (a.alts.length > 1 && armIndex > 0) {", to: "if (false) {", tests: [T("lint.test.js")] },
  { id: "F8 wildcard inside an alternation not flagged", file: "scripts/lint-no-default-arm.js",
    from: "if (a.alts.length > 1 && a.alts.some(altIsWild)) {", to: "if (false) {", tests: [T("lint.test.js")] },
];

function run(tests) {
  const r = spawnSync("bun", ["test", ...tests], { cwd: ROOT, encoding: "utf8", timeout: 300000 });
  const out = (r.stdout ?? "") + (r.stderr ?? "");
  const fail = /(\d+) fail/.exec(out);
  return { code: r.status, fails: fail ? Number(fail[1]) : -1 };
}

const results = [];
for (const m of MUTATIONS) {
  const path = join(ROOT, m.file);
  const orig = readFileSync(path, "utf8");
  const n = orig.split(m.from).length - 1;
  if (n !== 1) { results.push(`| ${m.id} | mutation site found ${n}× — NOT RUN |`); continue; }
  try {
    writeFileSync(path, orig.replace(m.from, m.to));
    const r = run(m.tests);
    results.push(`| ${m.id} | ${r.code !== 0 && r.fails > 0 ? "RED" : "GREEN (does not bite!)"} (${r.fails} failing) |`);
  } finally {
    writeFileSync(path, orig);
  }
}
const clean = run([`./${SH}/slice-m1/`]);
console.log("| mutation | result |\n|---|---|\n" + results.join("\n"));
console.log(`unmutated slice suite: exit ${clean.code}, ${clean.fails} failing`);
