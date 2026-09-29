// mutations.js — proves the slice tests BITE: applies each named mutation to a
// COPY of the source (a mirror under .tmp/ — the source is never edited, so a
// kill mid-run cannot leave it mutated), runs the named test file(s) on the
// mirror, expects RED, restores the copy. (The M1 review's F1–F8 items plus
// the M2 front-end and fix-round mutations, re-run as a script so the proof is
// repeatable.) A mutation whose site is not found exactly once is NOT RUN.
//
// THE GATE: the script exits NON-ZERO if any mutation is NOT RUN (its site
// moved — the proof silently shrank) or GREEN (the tests do not bite), or if
// the unmutated suite fails on the mirror. It exits 0 only when every
// mutation ran and went RED.
//
// usage: bun compiler/self-host-v2/slice-m1/bench/mutations.js
//        MUTATIONS_PROOF=absent   — run ONE synthetic mutation whose site does not exist (must exit ≠ 0)
//        MUTATIONS_PROOF=harmless — run ONE synthetic mutation that edits only a comment (GREEN; must exit ≠ 0)

import { cpSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = join(import.meta.dir, "..", "..", "..", "..");
const SH = "compiler/self-host-v2";
const T = (f) => `./${SH}/slice-m1/${f}`;
const T2 = (f) => `./${SH}/slice-m2/${f}`;
const T4 = (f) => `./${SH}/slice-m4/${f}`;
const RT = `${SH}/slice-m1/runtime/runtime.js`;

// The M3 typer mutations all edit analyze.scrml and are judged by the two
// typer suites: [id, from, to] triples.
// A 4th element names another bootstrap file (default analyze.scrml).
// (s442: the S440-ruled suite typer-s440.test.js judges them too.)
const TYPER = (rows) => rows.map(([id, from, to, file]) => ({
  id, file: `${SH}/${file ?? "analyze.scrml"}`, from, to, tests: [T2("typer-gap.test.js"), T2("typer.test.js"), T2("typer-s440.test.js")],
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
  // ---- S440: #1109 review fixes re-landed + spread writes all-or-nothing ----
  { id: "S440 F1: a spread override's value read AFTER the earlier writes (no snapshot local)", file: `${SH}/lower.scrml`,
    from: "                writes = writes.concat([Stmt.Write(w.cap, one, w.edit, Expr.Local(t), w.check)])",
    to: "                writes = writes.concat([Stmt.Write(w.cap, one, w.edit, lowerExpr(c, ps[sw.prop].value), w.check)])",
    tests: [T2("front.test.js")] },
  { id: "S440 F-A: the Commit's writes not batched (observers flush between writes outside a handler)", file: `${SH}/print.scrml`,
    from: "        return checks.concat([sexpr(rtCall(ctx, \"batch\", [JsExpr.JArrow([], writes)]))])\n", to: "        return checks.concat(writes)\n",
    tests: [T2("front.test.js")] },
  { id: "S440 ruling: STRICT SNAPSHOT off (override values read the live `@x`)", file: `${SH}/lower.scrml`,
    from: "        const sc: LC = { t: c.t, file: c.file, subst: c.subst, snap: snapOf(operand, snap, fields) }\n",
    to: "        const sc: LC = { t: c.t, file: c.file, subst: c.subst, snap: not }\n",
    tests: [T2("front.test.js")] },
  { id: "S440 N1: the spread snapshot is the WHOLE instance again (every field read → rt.snapshot, widened tracking)", file: `${SH}/lower.scrml`,
    from: "                const f: SnapField | not = snapFieldOf(s.fields, rest[0])\n",
    to: "                const f: SnapField | not = not\n",
    tests: [T2("front.test.js")] },
  { id: "S440 ruling: a duplicate spread-override key accepted (E-STRUCT-DUPLICATE-KEY off for the spread shape)", file: `${SH}/analyze.scrml`,
    from: "            if (ps[k].name == ps[j].name) return true\n", to: "            if (false) return true\n",
    tests: [T2("front.test.js")] },
  { id: "S440 F-A: the Commit re-resolves the instance per write (no `Let inst = Handle(…)`)", file: `${SH}/lower.scrml`,
    from: "        const one: InstRef = InstRef.Narrowed(inst)\n        let lets: Stmt[] = [Stmt.Let(inst, Expr.Handle(instOf(c, ws[0].w.inst)))]\n",
    to: "        const one: InstRef = instOf(c, ws[0].w.inst)\n        let lets: Stmt[] = []\n",
    tests: [T2("front.test.js")] },
  { id: "S440 F2: `@h` not narrowed inside its own `given` (E-DECL-HANDLE-NOT-NARROWED again)", file: `${SH}/analyze.scrml`,
    from: "        if (hn != \"\") inner = withNarrow(inner,", to: "        if (false) inner = withNarrow(inner,",
    tests: [T2("front.test.js")] },
  { id: "S440 all-or-nothing: the printed commit writes BEFORE it checks the edges", file: `${SH}/print.scrml`,
    from: "        return checks.concat([sexpr(rtCall(ctx, \"batch\", [JsExpr.JArrow([], writes)]))])\n",
    to: "        return [sexpr(rtCall(ctx, \"batch\", [JsExpr.JArrow([], writes)]))].concat(checks)\n",
    tests: [T2("front.test.js")] },
  { id: "S440 all-or-nothing: lower emits the spread's writes ungrouped (no Commit)", file: `${SH}/lower.scrml`,
    from: "        return lets.concat([Stmt.Commit(writes)])\n", to: "        return lets.concat(writes)\n",
    tests: [T2("front.test.js")] },
  { id: "S440 all-or-nothing: the commit's edge check skipped (an off-graph override is written silently)", file: `${SH}/print.scrml`,
    from: "        if (!isTransitionEdit(edit) || !isRuntimeEdge(check)) return []\n", to: "        return []\n",
    tests: [T2("front.test.js")] },
  { id: "S440 C7: a Commit write storing a non-Local accepted", file: `${SH}/check.scrml`,
    from: "            .Lit(lit: x) :> \"a Commit write's value is not a Local (the snapshot)\"", to: "            .Lit(lit: x) :> \"\"",
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
     "        if (kindOf(s) == 5) return ts\n", "        return ts\n"],
    ["M3 typer: use-site construction values never checked (§66.9 rule 8 / §7.5.1 position 2)",
     "                if (f.annotated && f.trusted) {\n                    ts = checkInit(", "                if (false) {\n                    ts = checkInit("],
    ["M3 typer: a declaration's own initializer never checked (§7.5.1 position 2)",
     "            if (f.annotated && f.trusted) ts = checkInit(", "            if (false) ts = checkInit("],
    ["S442 #9: `int` unenforced again (number → int unproven, S439 behaviour)",
     "            if (vk == 0) return Verdict.Fits\n            return Verdict.Fails\n",
     "            if (vk == 0) return Verdict.Fits\n            if (vk == 1) return Verdict.Unproven\n            return Verdict.Fails\n"],
    ["S442 #8 Q2: `a || b` typed from its operands again (JS operand semantics, S439)",
     "            .Or :> known(Type.Bool)", "            .Or :> VType.Unknown"],
    ["M3 typer: a `T | not` value into a `T` position treated as provably wrong",
     "            if (r == Verdict.Fails) return Verdict.Fails\n            return Verdict.Unproven\n", "            return Verdict.Fails\n"],
    ["M3 typer: the Typing table not recorded (no type per expression node)",
     "        return rvt(r.vt, record(r.ts, e.nid, r.vt))\n", "        return rvt(r.vt, r.ts)\n"],
    // (S442: the two S439 REVERSE rows "a ternary test / an `if=` checked as `bool`" are retired —
    // S440 #4 = (c) RULED conditions checked; their replacements are the S442 rows below.)
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
     "            } else if (h.file == progFile && cells.indexOf(h.name) >= 0) {", "            } else if (false) {"],
    // ---- fix round 1 ----
    ["FR1-A: a local's reassignments not joined into its type (typed from the initializer only)",
     "                    ts1 = contribute(ts1, ls, r.vt)\n", ""],
    ["FR1-A: a local's annotation ignored (typed from its initializer)",
     "            return keepTEnv(tWithLocal(env, sym, known(annot)), ts2)", "            return keepTEnv(tWithLocal(env, sym, r.vt), ts2)"],
    ["FR1-B: a whole-struct literal's fields not checked",
     "        return checkLitFields(env, value, checkValue(env, v, target, value.span, what, ts))", "        return checkValue(env, v, target, value.span, what, ts)"],
    ["FR1-C: a parse-recovery node typed as the `not` literal",
     ".Recovered :> rvt(VType.Unknown, ts)", ".Recovered :> rvt(VType.Absent, ts)"],
    ["FR1-C: a write into a field whose declaration failed to parse still checked",
     "        if (!f.trusted) return ts\n", ""],
    ["FR1-C: arity checked against a signature that did not parse",
     "                if (!paramsTrusted(f.errs, af.params)) arity = -1\n", ""],
    ["FR1-D: every declaration in the link set claims `@name` (not only the visible ones)",
     "                if (d.file == file || importsName(files, file, name)) return true", "                return true"],
    ["FR1-G1: `<each in=not>` accepted",
     "        if (isAbsentVT(v)) {\n            return report(", "        if (false) {\n            return report("],
    ["FR1-F1: a duplicate type name in one file accepted",
     "                if (first.file == ti.file) {\n                    out = out.concat([mkDiag(ti.file, ti.span, \"E-BOOTSTRAP-REDECLARE\"",
     "                if (false) {\n                    out = out.concat([mkDiag(ti.file, ti.span, \"E-BOOTSTRAP-REDECLARE\""],
    ["FR2-1: a program cell visible from every file (§7.6.1 'in the same file' dropped)",
     "        if (d.file != env.file) return not\n", ""],
    ["FR2-1: `@x` reaches a declaration the file neither declares nor imports",
     "        if (d.file == env.file || importsName(env.g.files, env.file, name)) return d\n        return not", "        return d"],
    ["FR2-2: a row / renders handle may shadow a visible cell (PA interim: refuse)",
     "            } else if (h.file == progFile && cells.indexOf(h.name) >= 0) {", "            } else if (h.owner == progNid && cells.indexOf(h.name) >= 0) {"],
    ["FR2-3: `key=` resolved in the row env (sees the row's own handles)",
     "                st = resolveValue(kenv, a.value, not, st)", "                st = resolveValue(renv, a.value, not, st)"],
    ["FR2-4: an annotated local's literal initializer not checked (§7.5.1 position 1)",
     "            let ts2: TypeState = checkInit(env, annot, literalKind(init), init.span, \"`\" + name + \"`\", r.ts)", "            let ts2: TypeState = r.ts"],
    ["FR2-4: a write to an annotated local not checked",
     "                    ts1 = checkLitFields(env, value, checkValue(env, r.vt, la, value.span, placeLabel(target), ts1))", "                    ts1 = ts1"],
    ["FR2-5: a field's trust judged by an error ANYWHERE in its declaration (coarse Rule C)",
     "            out = out.concat([{ nid: f.nid, span: f.span, annotated: f.annotated, trusted: typeTrusted(errs, f.typeSpan),",
     "            out = out.concat([{ nid: f.nid, span: f.span, annotated: f.annotated, trusted: !hasErrIn(errs, f.span),"],
    ["FR2-5: an opener type's span stops before its unreadable continuation (`int|not` trusted as `int`)",
     "        if (end > m.pos) ty = { nid: ty.nid, span: mkSpan(start, end), k: ty.k }\n", "", "parse.scrml"],
    ["FR2-7: the fixpoint bound fixed at 6 passes (a chain of 6 locals goes Unknown)",
     "            if (pass == 0) bound = 3 * next.length + 2", "            if (pass == 0) bound = 6"],
    ["FR2-8: compound assignment recovered as a typed `x = v`",
     "            return mkE(rhs2.tp, start, AExprK.Recovered)", "            return mkE(rhs2.tp, start, AExprK.Assign(lhs.e, rhs2.e))", "parse.scrml"],
    ["R3-H1: a field write through an annotated local checked against the WHOLE annotation",
     "                if (la is some && bareLocal) {", "                if (la is some) {"],
    ["R3-H1: a field write through an unannotated local joined into the local's type",
     "                } else if (la is not && bareLocal) {", "                } else if (la is not) {"],
    ["FR1-F2: duplicate parameter names accepted",
     "                out = out.concat([mkDiag(file, ps[j].span, \"E-BOOTSTRAP-REDECLARE\"", "                if (false) out = out.concat([mkDiag(file, ps[j].span, \"E-BOOTSTRAP-REDECLARE\""],
    // ---- s442: the S440-ruled checks (docs/changes/s442-bootstrap-typer-rules/) ----
    ["S442 #3: `S | not` over a NON-sequence admitted (only the outer `| not` looked at)",
     "        if (inner is some) s = inner", "        if (inner is some) return ts"],
    ["S442 dup keys: a repeated key in a plain / nested struct literal accepted",
     "            if (!ps[j].spread && keyBefore(ps, j)) st = dupOverride(env, st, ps[j])", "            if (false) st = dupOverride(env, st, ps[j])"],
    ["S442 #7: conditions never checked (truthiness back)",
     "            .Known(t: t) :> condKnown(env, c, t, what, ts)", "            .Known(t: t) :> ts"],
    ["S442 #7 Q1 REVERSE: a `T | not` condition refused (presence test lost)",
     "        if (maybeInner(t) is some) return markPresence(ts, c.nid)\n", ""],
    ["S442 #7 Q1: a presence test not lowered (`if=@o.n` over `0` is JS-falsy again)",
     "        if (presenceTest(c.t, e.nid)) return Expr.Prim(PrimOp.IsSome, [x])\n", "", "lower.scrml"],
    ["S442 #8: arithmetic / relational operands never checked",
     "            .Known(t: t) :> numKnown(env, x, t, what, ts)", "            .Known(t: t) :> ts"],
    ["S442 #8: `string + number` accepted (the `+` pair rule off)",
     "        if (kindOf(x) == 2 && kindOf(y) == 2) return ts\n", "        return ts\n"],
    ["S442 #8 Q2: `!` / `&&` / `||` operands never checked",
     "            .Known(t: t) :> boolKnown(env, x, t, what, ts)", "            .Known(t: t) :> ts"],
    ["S442 #8 Q3 REVERSE: narrowing ignored (a narrowed `T | not` read stays `T | not`)",
     "        if (key != \"\" && env.narrowed.indexOf(key) >= 0) return known(inner)\n", ""],
    ["S442 #8 Q3 REVERSE: no narrowing after an early `return`",
     "        if (aExits && !bExits) return withNarrowed(env, b.narrowed)\n", ""],
    ["S442 #8 Q3 REVERSE: the right operand of `&&` not narrowed by the left",
     "        if (isAnd) renv = tNarrow(env, condNarrowing(env, l).yes)\n", ""],
    ["S442 #8 Q3: a write of a narrowed place does not un-narrow it",
     "        const out: TEnv = tUnnarrow(tCallUnnarrow(env, e), key)\n", "        const out: TEnv = tCallUnnarrow(env, e)\n"],
    ["S442 r2 F1a: a call never drops a narrowing (callee write sets ignored)",
     "                    if (k.indexOf(\"@\") == 0) out = tUnnarrow(out, k)\n", ""],
    ["S442 r2 F1a: write sets not closed over calls (a callee's callee ignored)",
     "                            if (keys.indexOf(c) < 0) {\n                                keys = keys.concat([c])\n                                changed = true\n                            }\n",
     ""],
    ["S442 r2 F1b: an `if` leaves the THEN path's narrowing (no join)",
     "        return withNarrowed(env, both)\n", "        return withNarrowed(env, a.narrowed)\n"],
    ["S442 r2 F1b: a bare local write never un-narrows the local",
     "            if (s is some) return \"#\" + s.id\n", ""],
    ["S442 r2 F3: a write of a present value does not narrow",
     "        if (key != \"\" && writesPresent(e, ts)) return keepTEnv(tNarrow(out, [key]), ts)\n", ""],
    ["S442 r2 F3 REVERSE: a write of a `T | not` value narrows too",
     "        return maybeInner(x) is not\n    }", "        return true\n    }"],
    // (s442 r2: the joined-local carve-out and its two rows are retired — see progress.md r2 follow-through)
    ["S442 r2 follow-through: a `T | not` operand never reported (Q3 off)",
     "        return report(ts, env, x.span, \"E-OPERAND-NOT-NARROWED\"", "        return ts\n        return report(ts, env, x.span, \"E-OPERAND-NOT-NARROWED\""],
    ["S442 #8 REVERSE: Rule C off for operators (checked across a parse error)",
     "        if (hasErrIn(env.errs, e.span)) return ts\n        return match op {", "        return match op {"],
    ["S442 #9: `/` on two ints accepted (E-INT-DIVISION off)",
     "            if (kindOf(unMaybe(x)) == 0 && kindOf(unMaybe(y)) == 0) {", "            if (false) {"],
    ["S442 #9: the `int` initializer rule off (§7.5.1 not widened to `int`)",
     "        if (tk == 0) {\n            if (lk == 4) return 1\n            return 0\n        }\n", "        if (tk == 0) {\n            return -1\n        }\n"],
    ["S442 r2 F4: a hex literal classified by its digits (`0xE` typed `number`)",
     "        if (isRadixLiteral(raw)) return Type.Int\n", ""],
    // ---- s442 fix round r1 (review F1 / F2 / F3) ----
    ["S442 r1 F1: `a && b` typed from its operands again (the `&&` arm of Q2)",
     "            .And :> known(Type.Bool)", "            .And :> VType.Unknown"],
    ["S442 r1 F2 REVERSE: Rule C off for conditions (judged across a parse error)",
     "        if (hasErrIn(env.errs, c.span)) return ts          // Rule C: not judged across a parse error\n", ""],
    ["S442 r1 F3: E-INT-DIVISION reported on top of the operand reports (the single-report guard off)",
     "        const ts: TypeState = checkNumPair(env, e, l, r, a, b, \"`/`\", ts0)\n        if (ts.diags.length > ts0.diags.length) return ts\n",
     "        const ts: TypeState = checkNumPair(env, e, l, r, a, b, \"`/`\", ts0)\n"],
    ["S442 #7: a conditional handle typed `T` (its `| not` lost — `if=@color` refused)",
     "            if (h.sym.id == s.id && h.conditional) return Type.Maybe(Type.Named(d))", "            if (false) return Type.Maybe(Type.Named(d))"],
    ["S442 #4 (ruling #5 (ii)): a handle named like a cell accepted in a ROW (only the program scope refused)",
     "            } else if (h.file == progFile && cells.indexOf(h.name) >= 0) {", "            } else if (h.owner == progNid && h.file == progFile && cells.indexOf(h.name) >= 0) {"],
  ]),
  // ---- M3 item 2: the tables split by fact family, indexed by NodeId ----
  { id: "M3 tables: the index build skips each table's first fact", file: `${SH}/analyze.scrml`,
    from: "        while (i >= 0) {\n            // backwards: a node's first entry is written last, and stays",
    to: "        while (i > 0) {\n            // backwards: a node's first entry is written last, and stays",
    tests: [T2("tables.test.js")] },
  { id: "M3 tables: the index's empty slot is 0, not -1 (every node without a fact answers the first fact)", file: `${SH}/analyze.scrml`,
    from: "        if (n <= 0) return []\n        let out: int[] = [-1]", to: "        if (n <= 0) return []\n        let out: int[] = [0]",
    tests: [T2("tables.test.js")] },
  { id: "M3 tables: a node's fact answered by the wrong family (a `given` recorded as a name)", file: `${SH}/analyze.scrml`,
    from: "        st = addBind(rs.st, s.nid, BindFact.BGiven(rs.s, inst))",
    to: "        st = addName(rs.st, s.nid, NameFact.NLocal(rs.s))",
    tests: [T2("tables.test.js")] },
  { id: "M3 tables: exprType's index points one entry off", file: `${SH}/analyze.scrml`,
    from: "            if (exprs[i].nid >= 0) at[exprs[i].nid] = i\n", to: "            if (exprs[i].nid >= 0) at[exprs[i].nid] = i + 1\n",
    tests: [T2("tables.test.js")] },
  { id: "M3 tables: every expression typed twice (a duplicate typing entry per node)", file: `${SH}/analyze.scrml`,
    from: "        return rvt(r.vt, record(r.ts, e.nid, r.vt))\n", to: "        return rvt(r.vt, record(record(r.ts, e.nid, r.vt), e.nid, r.vt))\n",
    tests: [T2("tables.test.js")] },
  { id: "M3 tables: a row value `@.` recorded twice in the names family", file: `${SH}/analyze.scrml`,
    from: "        return plain(row.ty, addName(st, e.nid, NameFact.NLocal(row.bind)))",
    to: "        return plain(row.ty, addName(addName(st, e.nid, NameFact.NLocal(row.bind)), e.nid, NameFact.NLocal(row.bind)))",
    tests: [T2("tables.test.js")] },
  // ---- s442: the §66.19 six-programs front end — its DIAGNOSTICS (codes-only; the runtime constructs are
  // certified by the bite matrix's front section, slice-m3/bench/bite-matrix.js --front) ----
  { id: "s442: `single` inside a multi-instance declaration accepted (E-COMPONENT-ENGINE-SCOPE never fires)", file: `${SH}/analyze.scrml`,
    from: "            if (hasFlag(c.mods, \"single\")) {", to: "            if (false) {", tests: [T4("engine.test.js")] },
  { id: "s442 r1 O55: a plain `<x/>` of a `single` program cell rendered as HTML (E-DECL-SINGLE-INSTANTIATED dropped)", file: `${SH}/analyze.scrml`,
    from: "        if (sd is some) return singleInstantiated(env, e, st)", to: "", tests: [T4("engine.test.js")] },
  { id: "s442 r1 O55/F2: a plain use of a `single` USER declaration makes a second instance", file: `${SH}/analyze.scrml`,
    from: "            if (d.info.single) return singleInstantiated(env, e, st)", to: "", tests: [T4("engine.test.js"), T4("review-r1.test.js")] },
  { id: "s442 r1 F1: a sequence shape on a LOCAL taken as a cell write (the statement is deleted)", file: `${SH}/analyze.scrml`,
    from: "        if (shape > 0 && !rootIsLocal(env, target)) return", to: "        if (shape > 0) return", tests: [T4("review-r1.test.js")] },
  { id: "s442 r1 F1: an edit call on a LOCAL taken as a cell edit (the statement is deleted)", file: `${SH}/analyze.scrml`,
    from: "            if (rootIsLocal(env, m.obj)) return localEditRefused(env, e, m.method, args, st)", to: "", tests: [T4("review-r1.test.js")] },
  { id: "s442 r1 F3: `>=` ends a `:`-shorthand body (the tail leaks as text)", file: `${SH}/lex.scrml`,
    from: "        if (c0 == 62) return peekCode(c, 1) != 61", to: "        if (c0 == 62) return true", tests: [T4("review-r1.test.js")] },
  { id: "s442 r1 F3: a bare `>` comparison in a shorthand accepted (its tail rendered as page text)", file: `${SH}/parse.scrml`,
    from: "            m = comparisonTail(m, start)\n", to: "", tests: [T4("review-r1.test.js")] },
  { id: "s442 r1 F4: a state-child body parsed as FREE text (quotes rendered, prose accepted)", file: `${SH}/parse.scrml`,
    from: "            const kids: RNodes = parseCodeBody(m, o.name)", to: "            const kids: RNodes = parseKids(m, o.name)", tests: [T4("review-r1.test.js")] },
  { id: "s442 r1 F5: a multi-element append shape interleaves evaluation and writes", file: `${SH}/lower.scrml`,
    from: "        const edit: Stmt = Stmt.Commit(writes)",
    to: "        if (!prepend) {\n            let direct: Stmt[] = []\n            for (const v of values) { direct = direct.concat([Stmt.Write(w.cap, target, w.edit, v, w.check)]) }\n            return direct\n        }\n        const edit: Stmt = Stmt.Commit(writes)", tests: [T4("review-r1.test.js")] },
  { id: "s442 r1 F6: a shape's elements evaluated RIGHT to left", file: `${SH}/lower.scrml`,
    from: "            lets = lets.concat([Stmt.Let(tmps[k], v)])", to: "            lets = [Stmt.Let(tmps[k], v)].concat(lets)", tests: [T4("review-r1.test.js")] },
  { id: "s442 r1 nit: a closer right after a shorthand body accepted", file: `${SH}/parse.scrml`,
    from: "        if (n == 0) return mp", to: "        return mp", tests: [T4("review-r1.test.js")] },
  { id: "s442 r1 nit: a duplicate state-child accepted", file: `${SH}/analyze.scrml`,
    from: "            if (origin >= 0 && seen.indexOf(origin) >= 0) {", to: "            if (false) {", tests: [T4("review-r1.test.js")] },
  { id: "s442 r1 nit: a sequence shape over a non-sequence not a type error", file: `${SH}/analyze.scrml`,
    from: "            if (seqElem(pty) is not) {", to: "            if (false) {", tests: [T4("review-r1.test.js")] },
  { id: "s442 r1 nit: `<*f/>` of another declaration's field called a predefined element", file: `${SH}/analyze.scrml`,
    from: "            if (owner != \"\") {", to: "            if (false) {", tests: [T4("review-r1.test.js")] },
  { id: "s442 r1 G1: `<*x/>` inlines markup that constructs instances", file: `${SH}/analyze.scrml`,
    from: "        if (!constructsNothing(env.g, nodes)) {", to: "        if (false) {", tests: [T4("review-r1.test.js")] },
  { id: "s442 r1 G1: `<*x/>` of a declaration inlined inside another declaration's renders", file: `${SH}/analyze.scrml`,
    from: "        if (!inProgramCtx(env)) {", to: "        if (false) {", tests: [T4("review-r1.test.js")] },
  { id: "s442 r1 G1: `<*x/>` of a declaration with no renders accepted (O51)", file: `${SH}/analyze.scrml`,
    from: "        if (nodes.length == 0) {", to: "        if (false) {", tests: [T4("review-r1.test.js")] },
  { id: "s442 r1 G1: an attribute on `<*f/>` of a field accepted", file: `${SH}/analyze.scrml`,
    from: "        if (e.attrs.length > 0) {\n            return addDiag(st, env.file, e.span, \"E-DECL-STAR-REF-ATTR-WRITE\"",
    to: "        if (false) {\n            return addDiag(st, env.file, e.span, \"E-DECL-STAR-REF-ATTR-WRITE\"", tests: [T4("review-r1.test.js")] },
  { id: "s442 r1 G2: an own value AND attributes accepted (O19 decided silently)", file: `${SH}/analyze.scrml`,
    from: "                } else if (hasOwnValue(d.own) && d.attrs.length > 0) {", to: "                } else if (false) {", tests: [T4("review-r1.test.js")] },
  { id: "s442 r1 G3: `<*x/>` of a declaration with a default-less attribute accepted (O33 → a runtime throw)", file: `${SH}/analyze.scrml`,
    from: "            if (isAttributeRole(f.role) && !hasOwnValue(f.init)) {", to: "            if (false) {", tests: [T4("review-r1.test.js")] },
  { id: "s442: validator flags accepted silently (the O25 refusal dropped)", file: `${SH}/parse.scrml`,
    from: "            if (isValidatorWord(a.name)) {", to: "            if (false) {", tests: [T4("form.test.js")] },
  { id: "s442: an ungranted recognized sequence shape accepted as a grant", file: `${SH}/analyze.scrml`,
    from: "        const isGranted: boolean = f.grants.replace || hasEditKind(f.grants.edits, edit)\n        if (!isGranted || cap is not) {",
    to: "        const isGranted: boolean = true\n        if (!isGranted || cap is not) {", tests: [T4("audit.test.js")] },
  { id: "s442: `.shift()` classified at the END (granted by `end`)", file: `${SH}/analyze.scrml`,
    from: "        let edit: EditKind = EditKind.Prepend\n        let what: string = \"a removal at the front\"",
    to: "        let edit: EditKind = EditKind.Append\n        let what: string = \"a removal at the front\"", tests: [T4("audit.test.js")] },
  { id: "s442: an element-field write judged by the TAPE's grants instead of the field's (dpa-052 Q3)", file: `${SH}/analyze.scrml`,
    from: "        const fieldGranted: boolean = target.grants.replace || target.grants.edits.length > 0",
    to: "        const fieldGranted: boolean = f.grants.replace || f.grants.edits.length > 0", tests: [T4("audit.test.js")] },
  { id: "s442: a lambda parsed as its body alone (the `.filter(…)` shape never recognized)", file: `${SH}/parse.scrml`,
    from: "        return mkE(body.tp, start, AExprK.Lambda(params, body.e))", to: "        return body", tests: [T4("parse.test.js"), T4("audit.test.js")] },
  { id: "s442: the typer skips state-child bodies (Typing coverage)", file: `${SH}/analyze.scrml`,
    from: "                for (const sc of stateChildOf(c)) { ts = typeNodes(env, sc.body, ts) }",
    to: "                for (const sc of stateChildOf(c)) { ts = ts }", tests: [T4("typing.test.js")] },
  { id: "s442: the typer skips a child field's own renders (Typing coverage)", file: `${SH}/analyze.scrml`,
    from: "            if (r is some) ts = typeElem(env, r, ts)\n        }\n        return ts\n    }",
    to: "            if (false) ts = typeElem(env, r, ts)\n        }\n        return ts\n    }", tests: [T4("typing.test.js")] },
  { id: "s442: a spread-append's elements not checked against the element type", file: `${SH}/analyze.scrml`,
    from: "            ts = checkWrite(env, ed.w, exprType0(ts, x.nid), x, \"an element of this sequence\", ts)",
    to: "            ts = ts", tests: [T4("typing.test.js"), T4("audit.test.js")] },
  { id: "s442: `<theme>` parsed as markup (its CSS refusal dropped — the tokens vanish silently)", file: `${SH}/parse.scrml`,
    from: "    fn isThemeOpener(o: Opener) -> boolean { return !o.star && o.name == \"theme\" }",
    to: "    fn isThemeOpener(o: Opener) -> boolean { return false }", tests: [T4("theme.test.js")] },
  { id: "s442: a named shared instance read as a field-less declaration (its refusal dropped)", file: `${SH}/analyze.scrml`,
    from: "                if (n != \"\" && declNames.indexOf(n) >= 0) {", to: "                if (false) {", tests: [T4("theme.test.js")] },
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

// The gate's own proof: one mutation that cannot run, one that cannot bite.
const PROOF = process.env.MUTATIONS_PROOF ?? "";
const PROOFS = {
  absent: [{ id: "PROOF absent site", file: `${SH}/analyze.scrml`, from: "this text is not in analyze.scrml §§§", to: "", tests: [T2("typer.test.js")] }],
  harmless: [{ id: "PROOF harmless edit (a comment)", file: `${SH}/analyze.scrml`,
    from: "// self-host-v2 / analyze.scrml", to: "// self-host-v2 / analyze.scrml (harmless)", tests: [T2("typer-gap.test.js")] }],
};
const SET = PROOF === "" ? MUTATIONS : PROOFS[PROOF];
if (!SET) throw new Error(`unknown MUTATIONS_PROOF=${PROOF}`);

const t0 = performance.now();
const results = [];
let bad = 0;
try {
  for (const m of SET) {
    const path = join(MIRROR, m.file);
    const orig = readFileSync(path, "utf8");
    const n = orig.split(m.from).length - 1;
    if (n !== 1) { results.push(`| ${m.id} | mutation site found ${n}× — NOT RUN |`); bad = bad + 1; continue; }
    try {
      writeFileSync(path, orig.replace(m.from, m.to));
      const r = run(m.tests, MIRROR);
      const red = r.code !== 0 && r.fails > 0;
      if (!red) bad = bad + 1;
      results.push(`| ${m.id} | ${red ? "RED" : "GREEN (does not bite!)"} (${r.fails} failing) |`);
    } finally {
      writeFileSync(path, orig);
    }
  }
  console.log("| mutation | result |\n|---|---|\n" + results.join("\n"));
  if (PROOF === "") {
    const clean = run([`./${SH}/slice-m1/`, `./${SH}/slice-m2/`, `./${SH}/slice-m4/`], MIRROR);
    console.log(`unmutated slice suite (on the mirror): exit ${clean.code}, ${clean.fails} failing`);
    if (clean.code !== 0) bad = bad + 1;
  }
} finally {
  rmSync(MIRROR, { recursive: true, force: true });
}
console.log(`${SET.length} mutation(s), ${bad} problem(s), wall ${((performance.now() - t0) / 1000).toFixed(1)} s`);
if (bad > 0) process.exitCode = 1;
