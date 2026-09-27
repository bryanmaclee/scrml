// mutations.js — proves the slice tests BITE: applies each named mutation to a
// COPY of the source (a mirror under .tmp/ — the source is never edited, so a
// kill mid-run cannot leave it mutated), runs the named test file(s) on the
// mirror, expects RED, restores the copy. (The M1 review's F1–F8 items plus
// the M2 front-end and fix-round mutations, re-run as a script so the proof is
// repeatable.) A mutation whose site is not found exactly once is NOT RUN.
//
// usage: bun compiler/self-host-v2/slice-m1/bench/mutations.js

import { cpSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = join(import.meta.dir, "..", "..", "..", "..");
const SH = "compiler/self-host-v2";
const T = (f) => `./${SH}/slice-m1/${f}`;
const T2 = (f) => `./${SH}/slice-m2/${f}`;
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
    from: "  if (constructing === 0) return new Cell(untrack(init));",
    to: "  if (constructing === 0) return new Cell(init());", tests: [T("runtime.test.js")] },
  { id: "L12(b) instance creation deferred to mount (M1's behaviour)", file: `${SH}/print.scrml`,
    from: 'handles: hs, shared: [], rows: [], slot: jid("slot$"), prebuilt: true }',
    to: 'handles: hs, shared: [], rows: [], slot: jid("slot$"), prebuilt: false }',
    tests: [T("dropdown.browser.test.js")] },
  { id: "L12(b) shared instance registered only after its factory ran", file: RT,
    from: "    decl.shared = inst;\n    factory(inst);\n",
    to: "    factory(inst);\n    decl.shared = inst;\n",
    tests: [T("dropdown.browser.test.js")] },
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
  // ---- slice M2: one per front-end phase (the equality proof or the source-level suite goes RED) ----
  { id: "M2 parse: markup children that are elements are dropped", file: `${SH}/parse.scrml`,
    from: "                out = out.concat([rn.n])\n", to: "",
    tests: [T2("lower.test.js")] },
  { id: "M2 analyze: `@x` of a program field resolved to the shared instance everywhere (L1 broken)", file: `${SH}/analyze.scrml`,
    from: "        if (inProgramCtx(env)) return InstRef.Lexical(0)\n", to: "",
    tests: [T2("lower.test.js")] },
  { id: "M2 analyze: `<*x/>` mis-resolved (every reference taken as predefined)", file: `${SH}/analyze.scrml`,
    from: "        const d: DeclSrc | not = declNamed(env.g, e.tag)\n        if (d is not) {",
    to: "        const d: DeclSrc | not = not\n        if (d is not) {",
    tests: [T2("front.test.js")] },
  { id: "M2 lower: a field's edit grants dropped (a graph field loses its Transition grant)", file: `${SH}/lower.scrml`,
    from: "            grants: f.grants, graph: f.graph, exported: f.exported, wcap: f.wcap,",
    to: "            grants: { replace: f.grants.replace, edits: [] }, graph: f.graph, exported: f.exported, wcap: f.wcap,",
    tests: [T2("lower.test.js")] },
  { id: "M2 lower: L7 ternary arms swapped", file: `${SH}/lower.scrml`,
    from: "        return Expr.Match(test, [tArm, fArm])", to: "        return Expr.Match(test, [fArm, tArm])",
    tests: [T2("lower.test.js")] },
  { id: "M2 analyze: the spread shape treated as a genuine replace (O58 (b) hole reopened)", file: `${SH}/analyze.scrml`,
    from: "        if (p.path.length == 0 && isSelfSpread(target, value)) return resolveSpread(env, e, p, f, value, st)\n", to: "",
    tests: [T2("front.test.js")] },
  { id: "F-B lower: reset of a user declaration's field inlines the DECLARED initializer (ignores the use-site value)", file: `${SH}/lower.scrml`,
    from: "        if (!isProgramKind(di.kind)) return [Stmt.Write(w.cap, target, w.edit, Expr.InitOf(d, target, idx), w.check)]\n", to: "",
    tests: [T2("front.test.js")] },
  { id: "S437 reads require narrowing: an un-narrowed read through a `T | not` handle accepted", file: `${SH}/analyze.scrml`,
    from: "        if (!r.x.maybe) return r\n", to: "        return r\n",
    tests: [T2("front.test.js")] },
  { id: "F8 non-first alternation arm not flagged", file: "scripts/lint-no-default-arm.js",
    from: "if (a.alts.length > 1 && armIndex > 0) {", to: "if (false) {", tests: [T("lint.test.js")] },
  { id: "F8 wildcard inside an alternation not flagged", file: "scripts/lint-no-default-arm.js",
    from: "if (a.alts.length > 1 && a.alts.some(altIsWild)) {", to: "if (false) {", tests: [T("lint.test.js")] },
];

function run(tests, cwd) {
  const r = spawnSync("bun", ["test", ...tests], { cwd, encoding: "utf8", timeout: 300000 });
  const out = (r.stdout ?? "") + (r.stderr ?? "");
  const fail = /(\d+) fail/.exec(out);
  return { code: r.status, fails: fail ? Number(fail[1]) : -1 };
}

// The mutations run on a MIRROR, never on the source (review INFO: a SIGKILL
// mid-run must not leave source mutated). The mirror (inside the worktree's
// gitignored .tmp/, so node_modules resolves by walking up) holds a COPY of
// compiler/self-host-v2 and scripts/lint-no-default-arm.js, plus symlinks to
// what the copies import read-only (compiler/src, compiler/native-parser,
// compiler/SPEC.md). A mutation edits the mirror's file and restores it from
// the copy's original text; the mirror is deleted at the end.
const MIRROR = join(ROOT, ".tmp", `mutations-${process.pid}`);
rmSync(MIRROR, { recursive: true, force: true });
mkdirSync(join(MIRROR, "compiler"), { recursive: true });
mkdirSync(join(MIRROR, "scripts"), { recursive: true });
cpSync(join(ROOT, SH), join(MIRROR, SH), { recursive: true });
cpSync(join(ROOT, "scripts", "lint-no-default-arm.js"), join(MIRROR, "scripts", "lint-no-default-arm.js"));
for (const rel of ["compiler/src", "compiler/native-parser", "compiler/SPEC.md", "bunfig.toml", "package.json"]) {
  symlinkSync(join(ROOT, rel), join(MIRROR, rel));
}

const results = [];
try {
  for (const m of MUTATIONS) {
    const path = join(MIRROR, m.file);
    const orig = readFileSync(path, "utf8");
    const n = orig.split(m.from).length - 1;
    if (n !== 1) { results.push(`| ${m.id} | mutation site found ${n}× — NOT RUN |`); continue; }
    try {
      writeFileSync(path, orig.replace(m.from, m.to));
      const r = run(m.tests, MIRROR);
      results.push(`| ${m.id} | ${r.code !== 0 && r.fails > 0 ? "RED" : "GREEN (does not bite!)"} (${r.fails} failing) |`);
    } finally {
      writeFileSync(path, orig);
    }
  }
  const clean = run([`./${SH}/slice-m1/`, `./${SH}/slice-m2/`], MIRROR);
  console.log("| mutation | result |\n|---|---|\n" + results.join("\n"));
  console.log(`unmutated slice suite (on the mirror): exit ${clean.code}, ${clean.fails} failing`);
} finally {
  rmSync(MIRROR, { recursive: true, force: true });
}
