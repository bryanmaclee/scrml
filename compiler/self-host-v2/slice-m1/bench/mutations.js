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

// The M3 typer mutations all edit analyze.scrml and are judged by the two
// typer suites: [id, from, to] triples.
const TYPER = (rows) => rows.map(([id, from, to]) => ({
  id, file: `${SH}/analyze.scrml`, from, to, tests: [T2("typer-gap.test.js"), T2("typer.test.js")],
}));

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
  // ---- M3 item 1: the typer and the scope pass — one per check family, plus the
  // REVERSE mutations for the shapes the SPEC makes legal (a "stays silent" test
  // must go RED when the typer starts rejecting what the SPEC accepts) ----
  ...TYPER([
    ["M3 typer: a write's value never checked (§66.1 rule 5 off)",
     "        if (fitsType(x, target) != Verdict.Fails) return ts\n", "        return ts\n"],
    ["M3 typer: `not` into a non-optional type accepted (E-TYPE-041 off)",
     "        if (maybeInner(target) is some) return ts\n        return report(ts, env, span, \"E-TYPE-041\"",
     "        return ts\n        return report(ts, env, span, \"E-TYPE-041\""],
    ["M3 typer: call arity never checked",
     "        if (n >= 0 && n != args.length) {", "        if (false) {"],
    ["M3 typer: `<each in=…>` over a non-sequence accepted",
     "        if (k == 5 || k == 6) return ts\n", "        return ts\n"],
    ["M3 typer: use-site construction values never checked (§66.9 rule 8 / §7.5.1 position 2)",
     "                if (f.annotated && f.trusted) {\n                    ts = checkInit(", "                if (false) {\n                    ts = checkInit("],
    ["M3 typer: a declaration's own initializer never checked (§7.5.1 position 2)",
     "            if (f.annotated && f.trusted) ts = checkInit(", "            if (false) ts = checkInit("],
    ["M3 typer: number → int treated as provably wrong (S404 refinement ignored)",
     "            if (vk == 1) return Verdict.Unproven", "            if (vk == 1) return Verdict.Fails"],
    ["M3 typer: `a || b` typed bool whatever its operands (JS operand semantics lost)",
     "            .Or :> boolPair(a, b)", "            .Or :> known(Type.Bool)"],
    ["M3 typer: a `T | not` value into a `T` position treated as provably wrong",
     "            if (r == Verdict.Fails) return Verdict.Fails\n            return Verdict.Unproven\n", "            return Verdict.Fails\n"],
    ["M3 typer: the Typing table not recorded (no type per expression node)",
     "        return rvt(r.vt, record(r.ts, e.nid, r.vt))\n", "        return rvt(r.vt, r.ts)\n"],
    ["M3 REVERSE: a ternary test checked as `bool` (the SPEC makes it boolean-coercible)",
     "        const rt: RVT = typeExpr(env, test, ts)\n",
     "        const rt0: RVT = typeExpr(env, test, ts)\n        const rt: RVT = rvt(rt0.vt, checkValue(env, rt0.vt, Type.Bool, test.span, \"a condition\", rt0.ts))\n"],
    ["M3 REVERSE: an `if=` checked as `bool` (§17.1.1 boolean-coercible)",
     "                // `if=` is boolean-COERCIBLE (§17.1.1): typed, never checked\n                ts = typeAttrValue(env, a.value, ts).ts\n",
     "                const cv: RVT = typeAttrValue(env, a.value, ts)\n                ts = cv.ts\n                if (a.name == \"if\") ts = checkValue(env, cv.vt, Type.Bool, a.span, \"a condition\", ts)\n"],
    ["M3 REVERSE: a call's first argument checked against `int` (§7.5.1 position 3 \"SHALL compile\")",
     "        const ret: Type | not = fi.ret\n",
     "        if (args.length > 0) ts = checkValue(env, exprType0(ts, args[0].nid), Type.Int, e.span, \"an argument\", ts)\n        const ret: Type | not = fi.ret\n"],
    ["M3 scope: duplicate program cells accepted (E-SCOPE-010 off)",
     "                if (i >= 0) {\n                    const f: FieldInfo = d.fields[j]", "                if (false) {\n                    const f: FieldInfo = d.fields[j]"],
    ["M3 scope: duplicate file-scope functions accepted",
     "            if (i >= 0) {\n                const f: FnInfo = t.fns[j]", "            if (false) {\n                const f: FnInfo = t.fns[j]"],
    ["M3 scope: the §7.3.3 function-block rule off (E-SCOPE-REDECLARE)",
     "                out = out.concat(blockRedeclares(f.path, af.body, af.params, true))\n", ""],
    ["M3 scope: inline handler blocks not checked",
     "            out = out.concat(handlerRedeclares(f.path, fileMarkup(f.items)))\n", ""],
    ["M3 REVERSE: nested blocks inherit the parameters (shadowing wrongly refused)",
     "            for (const nb of nestedBlocks(s)) { out = out.concat(blockRedeclares(file, nb, [], inFn)) }",
     "            for (const nb of nestedBlocks(s)) { out = out.concat(blockRedeclares(file, nb, params, inFn)) }"],
    ["M3 scope: two `as=` of one name in one scope accepted",
     "                if (dup is not && o.owner == h.owner && o.name == h.name) dup = o\n", "                if (false) dup = o\n"],
    ["M3 scope: a program cell named like a declaration accepted",
     "                } else if (d.sym.id == t.program.id && visibleDeclNamed(files, t, d.file, names[j])) {", "                } else if (false) {"],
    ["M3 scope: a handle named like a program cell accepted",
     "            } else if (h.owner == progNid && cells.indexOf(h.name) >= 0) {", "            } else if (false) {"],
    // ---- fix round 1 ----
    ["FR1-A: a local's reassignments not joined into its type (typed from the initializer only)",
     "                if (annotOf(env.t, ls) is not) ts1 = contribute(ts1, ls, r.vt)\n", ""],
    ["FR1-A: a local's annotation ignored (typed from its initializer)",
     "        if (annot is some) return keepTEnv(tWithLocal(env, sym, known(annot)), r.ts)\n", ""],
    ["FR1-B: a whole-struct literal's fields not checked",
     "        return checkLitFields(env, value, checkValue(env, v, target, value.span, what, ts))", "        return checkValue(env, v, target, value.span, what, ts)"],
    ["FR1-C: a parse-recovery node typed as the `not` literal",
     ".Recovered :> rvt(VType.Unknown, ts)", ".Recovered :> rvt(VType.Absent, ts)"],
    ["FR1-C: a write into a field whose declaration failed to parse still checked",
     "        if (!f.trusted) return ts\n", ""],
    ["FR1-C: arity checked against a signature that did not parse",
     "                if (!sigOk || !allParamsTyped(af.params)) arity = -1\n", ""],
    ["FR1-D: every declaration in the link set claims `@name` (not only the visible ones)",
     "                if (d.file == file || importsName(files, file, name)) return true", "                return true"],
    ["FR1-G2: a row-scoped handle checked against program cells",
     "            } else if (h.owner == progNid && cells.indexOf(h.name) >= 0) {", "            } else if (cells.indexOf(h.name) >= 0) {"],
    ["FR1-G1: `<each in=not>` accepted",
     "        if (isAbsentVT(v)) {\n            return report(", "        if (false) {\n            return report("],
    ["FR1-F1: a duplicate type name in one file accepted",
     "                if (first.file == ti.file) {\n                    out = out.concat([mkDiag(ti.file, ti.span, \"E-BOOTSTRAP-REDECLARE\"",
     "                if (false) {\n                    out = out.concat([mkDiag(ti.file, ti.span, \"E-BOOTSTRAP-REDECLARE\""],
    ["FR1-F2: duplicate parameter names accepted",
     "                out = out.concat([mkDiag(file, ps[j].span, \"E-BOOTSTRAP-REDECLARE\"", "                if (false) out = out.concat([mkDiag(file, ps[j].span, \"E-BOOTSTRAP-REDECLARE\""],
  ]),
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
