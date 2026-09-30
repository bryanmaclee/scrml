// bite-matrix.js — CERTIFIES the footprint grade's "implemented construct set" (s439-bootstrap-m3-ingest
// review item 1). A graded runtime pass is evidence FOR a construct only if corrupting that construct
// makes the pass die. So, per construct, this applies a named corruption to a COPY of the bootstrap
// (printer / runtime / ingest shim), re-grades the clean run's RUNTIME passes through the unchanged
// footprint grader (`scripts/hybrid.ts --footprint --only …`), and records which passes die.
//
//   CERTIFIED   — at least one corruption mapped to the construct kills at least one runtime pass.
//   UNCERTIFIED — exercised by a passing runtime case, but no corruption of it kills any pass
//                 (or none is defined) — the reason is listed.
// Codes-only passes never count (their codes come from impl#1's front end).
//
// The mutations run on a MIRROR under the worktree's gitignored .tmp/ (the source is never edited, so a
// kill mid-run cannot leave it mutated), the same device as slice-m1/bench/mutations.js.
//
// EXIT CODES: 0 = every mutation site found exactly once and the clean mirror reproduces the clean grade;
//             1 = a mutation site was not found exactly once, or the clean mirror run differs (a hollow
//                 gate must not pass silently);
//             2 = a grade run itself failed to run.
//
// TWO PHASES (s440-bootstrap-css-theme-t3): `cg` — the CG substitute, killing RUNTIME passes (above);
// `css` — the CSS-seam substitute (css-substitute.js), killing CSS passes: graded cases whose css oracle
// (computed style in Chromium, SPEC-derived; css-oracle.js) held. A css construct is certified only if
// one of its corruptions (the stylesheet emitter css.scrml, or the stylesheet shim css-ingest.scrml)
// makes a css pass fail its oracle while the case stays graded (bite-lib.js `judgeCssDeaths`).
//
// FRONT-END PHASE (s442, bite-front.js): the §66 constructs the front end (lex / parse / analyze /
// lower) gained for the §66.19 worked programs, certified against the slice-M4 BEHAVIOUR tests (each
// program compiled from its verbatim SPEC source and run). A kill there is a behaviour test that fails
// while the mutated program still compiles clean.
//
// usage: bun compiler/self-host-v2/slice-m3/bench/bite-matrix.js [--report <path.md>] [--cg-only | --css-only | --front]

import { cpSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { judgeCssDeaths, judgeDeaths } from "./bite-lib.js";
import { judgeFrontRun, isFrontKill } from "./bite-front.js";

const ROOT = join(import.meta.dir, "..", "..", "..", "..");
const SH = "compiler/self-host-v2";
const PRINT = `${SH}/print.scrml`;
const RT = `${SH}/slice-m1/runtime/runtime.js`;
const INGEST = `${SH}/ingest.scrml`;
const PARSE = `${SH}/parse.scrml`;
const ANALYZE = `${SH}/analyze.scrml`;
const LOWER = `${SH}/lower.scrml`;

// Each mutation corrupts ONE construct. `from` must occur exactly once in `file`.
const MUTATIONS = [
  // ---- printer / runtime (the bootstrap's emission of each Core construct) ----
  { c: "View.Dyn", id: "Dyn hole prints a constant", file: PRINT,
    from: 'rtCall(ctx, "text", [scopeVar(), node, jthunk(exprJs(ctx, e))])', to: 'rtCall(ctx, "text", [scopeVar(), node, jthunk(jstr("CORRUPT"))])' },
  { c: "View.Cond", id: "Cond test is constant false", file: PRINT,
    from: '{ key: "test", value: jthunk(exprJs(ctx, arm.test)) }', to: '{ key: "test", value: jthunk(JsExpr.JBool(false)) }' },
  { c: "View.Cond", id: "Cond test is constant true", file: PRINT,
    from: '{ key: "test", value: jthunk(exprJs(ctx, arm.test)) }', to: '{ key: "test", value: jthunk(JsExpr.JBool(true)) }' },
  { c: "View.Text", id: "static text is emptied", file: PRINT,
    from: "fn textBuilt(t: string) -> Built { return { nodes: [HNode.HText(t)], holes: [] } }",
    to: 'fn textBuilt(t: string) -> Built { return { nodes: [HNode.HText("")], holes: [] } }' },
  { c: "View.El", id: "an element renders none of its static children", file: PRINT,
    from: "const node: HNode = HNode.HElem(tag, staticAttrs(attrs), inner.nodes)", to: "const node: HNode = HNode.HElem(tag, staticAttrs(attrs), [])" },
  { c: "Attr.Static", id: "static attributes dropped", file: PRINT,
    from: ".Static(name: n, value: v) :> [{ name: n, value: v }]", to: ".Static(name: n, value: v) :> []" },
  { c: "Attr.On", id: "event listeners never attached", file: PRINT,
    from: '.On(event: ev, body: body) :> [sexpr(rtCall(ctx, "on", [scopeVar(), node, jstr(ev), JsExpr.JArrow([], blockJs(ctx, body))]))]',
    to: ".On(event: ev, body: body) :> []" },
  { c: "Stmt.Write", id: "a write is a no-op", file: PRINT,
    from: "return sexpr(editJs(ctx, target, owner, edit, v, check))", to: "return sexpr(JsExpr.JNull)" },
  { c: "EditKind.Replace", id: "a Replace edit reads instead of setting", file: PRINT,
    from: '.Replace :> jmcall(target, "set", [v])', to: '.Replace :> jmcall(target, "peek", [])' },
  { c: "Field.Derived", id: "a derived field is seeded once (no recompute)", file: PRINT,
    from: 'if (f.wcap is some) return rtCall(ctx, "seeded", [init])', to: 'return rtCall(ctx, "seeded", [init])' },
  { c: "Field.Let", id: "a `let` field is built read-only (derived)", file: PRINT,
    from: 'if (f.wcap is some) return rtCall(ctx, "seeded", [init])', to: 'if (false) return rtCall(ctx, "seeded", [init])' },
  { c: "Expr.Read", id: "a field read yields the whole-instance snapshot", file: PRINT,
    from: 'if (path.length == 0) return rtCall(ctx, "snapshot", [instJs(ctx, i)])', to: 'return rtCall(ctx, "snapshot", [instJs(ctx, i)])' },
  { c: "Place.Cell", id: "a cell place reads field 0", file: PRINT,
    from: "const sig: JsExpr = fieldCell(instJs(ctx, i), d, path[0].idx)", to: "const sig: JsExpr = fieldCell(instJs(ctx, i), d, 0)" },
  { c: "InstRef.Lexical", id: "the lexical instance is unbound", file: PRINT,
    from: "if (k < ctx.lexical.length) return ctx.lexical[k]", to: "if (false) return ctx.lexical[k]" },
  // (Round-1 finding: corrupting sharedJs's getter FALLBACK bit nothing — in a function the shared
  // instance is always the prologue local, so the fallback is unreached. The construct's emission
  // point is instJs's `.Shared` arm.)
  { c: "InstRef.Shared", id: "a `.Shared` reference is unbound", file: PRINT,
    from: ".Shared(decl: d) :> sharedJs(ctx, d)", to: '.Shared(decl: d) :> jid("undefined")' },
  { c: "Expr.Local", id: "a local read yields null", file: PRINT,
    from: ".Local(sym: s) :> localRead(ctx, s)", to: ".Local(sym: s) :> JsExpr.JNull" },
  { c: "Expr.Call", id: "a call is never made", file: PRINT,
    from: ".Call(callee: f, args: args) :> jcall(jid(symName(ctx, f)), exprsJs(ctx, args))", to: ".Call(callee: f, args: args) :> JsExpr.JNull" },
  { c: "Expr.Lit.Int", id: "an int literal is off by one", file: PRINT, from: ".Int(v: v) :> jnum(v)", to: ".Int(v: v) :> jnum(v + 1)" },
  { c: "Expr.Lit.Str", id: "a string literal gains a suffix", file: PRINT, from: ".Str(v: v) :> jstr(v)", to: '.Str(v: v) :> jstr(v + "!")' },
  { c: "Expr.Lit.Bool", id: "a bool literal is negated", file: PRINT, from: ".Bool(v: v) :> JsExpr.JBool(v)", to: ".Bool(v: v) :> JsExpr.JBool(!v)" },
  { c: "Expr.Prim.Add", id: "Add prints as minus", file: PRINT, from: ".Add :> bin(JsOp.Plus, a)", to: ".Add :> bin(JsOp.Minus, a)" },
  { c: "Expr.Prim.Concat", id: "Concat keeps only its left operand", file: PRINT, from: ".Concat :> bin(JsOp.Plus, a)", to: ".Concat :> a[0]" },
  { c: "Expr.Prim.Mul", id: "Mul prints as plus", file: PRINT, from: ".Mul :> bin(JsOp.Times, a)", to: ".Mul :> bin(JsOp.Plus, a)" },
  { c: "Expr.Prim.Gt", id: "Gt prints as less-than", file: PRINT, from: ".Gt :> bin(JsOp.Gt, a)", to: ".Gt :> bin(JsOp.Lt, a)" },
  { c: "Expr.Prim.Not", id: "Not is the identity", file: PRINT, from: ".Not :> JsExpr.JUn(JsUnOp.Not, a[0])", to: ".Not :> a[0]" },
  { c: "Stmt.If", id: "if takes the else branch", file: PRINT,
    from: "[JsStmt.SIf(exprJs(ctx, c), blockJs(ctx, t), elseJs(ctx, e))]", to: "[JsStmt.SIf(JsExpr.JUn(JsUnOp.Not, exprJs(ctx, c)), blockJs(ctx, t), elseJs(ctx, e))]" },
  { c: "Stmt.Let", id: "a local binding is initialized to null", file: PRINT,
    from: "        return JsStmt.SConst(symName(ctx, sym), exprJs(ctx, init))", to: "        return JsStmt.SConst(symName(ctx, sym), JsExpr.JNull)" },
  { c: "Stmt.Return", id: "return yields null", file: PRINT,
    from: ".Return(e: e) :> [JsStmt.SReturn(exprJs(ctx, e))]", to: ".Return(e: e) :> [JsStmt.SReturn(JsExpr.JNull)]" },
  { c: "Stmt.Eval", id: "an expression statement is dropped", file: PRINT, from: ".Eval(e: e) :> [sexpr(exprJs(ctx, e))]", to: ".Eval(e: e) :> []" },
  { c: "Block", id: "a block's statements are dropped", file: PRINT,
    from: "for (const s of b.stmts) { out = out.concat(stmtJs(ctx, s, assigned)) }", to: "for (const s of []) { out = out.concat(stmtJs(ctx, s, assigned)) }" },
  { c: "Fn", id: "a function's body is dropped (prologue kept)", file: PRINT,
    from: "return JsStmt.SFunc(symName(ctx, f.sym), params, prologue.concat(blockJs(fctx, f.body)))", to: "return JsStmt.SFunc(symName(ctx, f.sym), params, prologue)" },
  { c: "Decl", id: "the declaration descriptor names no fields", file: PRINT,
    from: 'rtCall(ctx, "declare", [jstr(h), JsExpr.JArray(fieldNamesJs(d))])', to: 'rtCall(ctx, "declare", [jstr(h), JsExpr.JArray([])])' },
  { c: "Program", id: "the program boots into a detached element, not the page", file: PRINT,
    from: 'rtCall(ctx, "mount", [jmember(jid("document"), "body")]), JsExpr.JNull,',
    to: 'rtCall(ctx, "mount", [jcall(jmember(jid("document"), "createElement"), [jstr("div")])]), JsExpr.JNull,' },
  { c: "Attr.On", id: "runtime: a listener's handler never runs", file: RT,
    from: "const h = (e) => batch(() => handler(e));", to: "const h = (e) => {};" },
  { c: "View.Cond", id: "runtime: cond never renders an arm", file: RT,
    from: "        arms[idx].render(armScope, anchor);\n", to: "" },
  // ---- the ingest shim (its mapping of each legacy form) ----
  { c: "View.Cond", id: "shim: `if=` on an element dropped", file: INGEST,
    from: "if (test is not) return viewsOf([el], why)", to: "return viewsOf([el], why)" },
  { c: "Stmt.If", id: "shim: the else branch dropped", file: INGEST,
    from: "return stmtsOf(cx, [Stmt.If(c.e, block(t.stmts), block(e.stmts))], why.concat(e.why))",
    to: "return stmtsOf(cx, [Stmt.If(c.e, block(t.stmts), not)], why.concat(e.why))" },
  { c: "Expr.Prim.Gt", id: "shim: `>` mapped to Lt", file: INGEST,
    from: '">" :> prim2E(PrimOp.Gt, l, r, Type.Bool, why)', to: '">" :> prim2E(PrimOp.Lt, l, r, Type.Bool, why)' },
  { c: "Field.Derived", id: "shim: a derived `const` classified Seeded (mode only)", file: INGEST,
    from: "if (readsCell(init)) return FieldMode.Derived", to: "if (readsCell(init)) return FieldMode.Seeded" },
  { c: "View.Text", id: "shim: markup text dropped", file: INGEST,
    from: "return viewsOf([View.Text(v)], [])", to: "return viewsOf([], [])" },
];

// ---- the FRONT-END section (s442): construct → corruption → the slice-m4 behaviour tests it must kill ----
// `tests` are slice-m4 test files; only their `behaviour` tests run (`-t behaviour`).
const FRONT_MUTATIONS = [
  // §66.19.6 — an engine as a `single` declaration
  { c: "Parse.ShorthandBody", id: "a `:`-shorthand body's expression is dropped (an empty text)", file: PARSE,
    // (site moved with dpa-045 follow-up 3: parseShorthand now hands its expression to displayNodes)
    from: "        return displayNodes(m, e, start, tp)",
    to: '        return { nodes: [{ nid: m.nid, span: mkSpan(start, m.pos), k: ANodeK.Text("") }], mp: mBump(m) }', tests: ["engine.test.js"] },
  { c: "Analyze.StateBodies", id: "state-child bodies are never resolved (no facts for their expressions)", file: ANALYZE,
    from: "st = resolveNodes(renv, stateBodies(ds), st)", to: "st = resolveNodes(renv, [], st)", tests: ["engine.test.js"] },
  { c: "Analyze.StateView", id: "every state-view arm is keyed to the enum's first variant", file: ANALYZE,
    from: "arms = arms.concat([{ variant: v, body: c.body }])", to: "arms = arms.concat([{ variant: 0, body: c.body }])", tests: ["engine.test.js"] },
  { c: "Lower.StateView", id: "a state-view arm tests the NEXT variant", file: LOWER,
    from: "Expr.Lit(Literal.Variant(v.enumSym, a.variant))", to: "Expr.Lit(Literal.Variant(v.enumSym, a.variant + 1))", tests: ["engine.test.js"] },
  { c: "Analyze.NestedDecl", id: "a declaration inside `<program>` is not stubbed as a user declaration (its uses read as HTML)", file: ANALYZE,
    from: "                if (isNestedUserDecl(d)) {\n                    const n: RDeclStubs", to: "                if (false) {\n                    const n: RDeclStubs", tests: ["engine.test.js"] },
  { c: "Lower.NestedDeclSyntax", id: "a nested declaration's renders is never lowered", file: LOWER,
    from: ".concat(nestedSyntaxes(file, p.items))", to: "", tests: ["engine.test.js"] },
  // §66.19.5 — an append-only audit log (s444: the VERBATIM program, run)
  { c: "Analyze.SeqShape", id: "a recognized append shape records no element to write", file: ANALYZE,
    from: "                elems = elems.concat([x])\n", to: "                elems = elems\n", tests: ["audit.test.js"] },
  { c: "Analyze.SeqShape", id: "`[...@x, e]` classified as the front shape (a prepend)", file: ANALYZE,
    from: "                    if (samePlaceSyntax(target, first)) return 1", to: "                    if (samePlaceSyntax(target, first)) return 2", tests: ["audit.test.js"] },
  { c: "Lower.SeqEdits", id: "a one-element append shape's write is dropped", file: LOWER,
    from: "        if (values.length == 1) return pre.concat([Stmt.Write(w.cap, target, w.edit, values[0], w.check)])", to: "        if (values.length == 1) return pre", tests: ["audit.test.js"] },
  { c: "Lower.SeqEdits", id: "a prepend shape writes its elements in source order (the log would read b, a)", file: LOWER,
    from: "        const prepend: boolean = w.edit == EditKind.Prepend", to: "        const prepend: boolean = false", tests: ["audit.test.js"] },
  { c: "Parse.ArraySpread", id: "a spread element keeps only its operand's position (`[...@x, e]` read as `[e, ...@x]`)", file: PARSE,
    from: "                out = out.concat([sp.e])", to: "                out = [sp.e].concat(out)", tests: ["audit.test.js"] },
  // s444: the host call and the bind the verbatim §66.19.5 uses
  { c: "Analyze.Host", id: "`Date.now()` records no host fact (lowered as a missing value)", file: ANALYZE,
    from: "            .HostOk :> plain(Type.Num, addValue(st, e.nid, ValueFact.VHost(HostCall.DateNow)))", to: "            .HostOk :> plain(Type.Num, st)", tests: ["audit.test.js"] },
  { c: "Analyze.Bind", id: "a bind records no attribute fact (the element is not bound)", file: ANALYZE,
    from: "        return addAttr(m.st, a.nid, AttrKind.ABind(kind, w, p.decl.sym, p.idx, m.s, vattrs))", to: "        return m.st", tests: ["audit.test.js", "form.test.js"] },
  { c: "Lower.Bind", id: "lower drops the bind", file: LOWER,
    from: ":> [bindAttr(c, bk, w, d, x, sk)].concat(validatorAttrs(vs))", to: ":> [].concat(validatorAttrs(vs))", tests: ["audit.test.js", "form.test.js"] },
  // §66.19.2 — a validated form (s444: the verbatim program minus its validators — Phase B)
  { c: "Analyze.Star", id: "`<*x/>` of a declaration names no Star (the shared form is never rendered)", file: ANALYZE,
    from: "        return addElem(st, e.nid, ElemFact.MStar(d.info.sym, InstRef.Shared(d.info.sym)))", to: "        return st", tests: ["form.test.js"] },
  { c: "Lower.Star", id: "lower drops a Star", file: LOWER,
    from: "            .MStar(decl: d, inst: i) :> [View.Star(d, instOf(c, i))]", to: "            .MStar(decl: d, inst: i) :> []", tests: ["form.test.js"] },
  { c: "Analyze.O54Own", id: "`@f` inside f's own renders names the NEXT field (email binds password)", file: ANALYZE,
    from: "        return fieldIndex(d.info, name)\n    }", to: "        return fieldIndex(d.info, name) + 1\n    }", tests: ["form.test.js"] },
  { c: "Analyze.ChildRenders", id: "`<*f/>` of a child field with renders inlines nothing", file: ANALYZE,
    from: "MInline({ nodes: own, subst: not })", to: "MInline({ nodes: [], subst: not })", tests: ["form.test.js"] },
  { c: "Analyze.ChildRenders", id: "a child field's renders is never resolved", file: ANALYZE,
    from: "st = resolveNodes(withOwn(renv, fd.name), rendersOf(fd), st)", to: "st = resolveNodes(withOwn(renv, fd.name), [], st)", tests: ["form.test.js"] },
];

function runFront(tests) {
  const args = ["test", ...tests.map((t) => `./${SH}/slice-m4/${t}`), "-t", "behaviour"];
  const r = spawnSync("bun", args, { cwd: MIRROR, encoding: "utf8", timeout: 600000, maxBuffer: 64 * 1024 * 1024 });
  return judgeFrontRun((r.stdout ?? "") + (r.stderr ?? ""));
}

function frontSection(L) {
  const frows = [];
  const fkills = new Map();
  const files = [...new Set(FRONT_MUTATIONS.flatMap((m) => m.tests))];
  const clean = runFront(files);
  const cleanOk = clean.ran && !clean.rejected && clean.fail === 0 && clean.pass > 0;
  if (!cleanOk) bad = true;
  for (const m of FRONT_MUTATIONS) {
    const path = join(MIRROR, m.file);
    const orig = readFileSync(path, "utf8");
    const n = orig.split(m.from).length - 1;
    if (n !== 1) {
      frows.push(`| ${m.c} | ${m.id} | site found ${n}× — NOT RUN (hollow) | — |`);
      bad = true;
      continue;
    }
    try {
      writeFileSync(path, orig.replace(m.from, m.to));
      const j = runFront(m.tests);
      if (!fkills.has(m.c)) fkills.set(m.c, 0);
      if (isFrontKill(j)) fkills.set(m.c, fkills.get(m.c) + j.fail);
      const verdict = isFrontKill(j) ? `${j.fail} of ${j.pass + j.fail} killed` : `**none — NOT a bite** (${j.why || "every behaviour test passed"})`;
      frows.push(`| ${m.c} | ${m.id} | ${verdict} | ${m.tests.join(", ")} |`);
    } finally {
      writeFileSync(path, orig);
    }
  }
  const constructs = [...new Set(FRONT_MUTATIONS.map((m) => m.c))];
  const certified = constructs.filter((c) => (fkills.get(c) ?? 0) > 0);
  const uncertified = constructs.filter((c) => !certified.includes(c));
  L.push("# Bite matrix — front-end (§66) constructs, graded by the slice-M4 behaviour tests", "");
  L.push(`Clean mirror behaviour run: ${clean.pass} pass / ${clean.fail} fail${cleanOk ? "" : " — **NOT CLEAN** (" + (clean.why || "failures") + ")"}.`, "");
  L.push("| construct | corruption | behaviour tests killed (program still compiles clean) | tests |", "|---|---|---|---|", ...frows, "");
  L.push(`## FRONT CERTIFIED (${certified.length})`, "", certified.map((c) => "`" + c + "`").join(" · ") || "(none)", "");
  L.push(`## FRONT UNCERTIFIED (${uncertified.length})`, "", uncertified.map((c) => "`" + c + "`").join(" · ") || "(none)", "");
}

// ---- s440: the STYLESHEET pass (CSS sub-seam). A css pass is a graded case whose css ORACLE (computed
// style in Chromium, SPEC-derived) held; a corruption certifies its construct only if a css pass dies. ----
const CSSF = `${SH}/css.scrml`;
const CSSI = `${SH}/css-ingest.scrml`;
const CSS_MUTATIONS = [
  { c: "Css.Scope", id: "the `@scope` wrapper dropped (component rules land unscoped)", file: CSSF,
    from: '.Scope(component: c, body: b) :> blockLines("@scope ([data-scrml=\\"" + c + "\\"]) to ([data-scrml])", b, indent)',
    to: ".Scope(component: c, body: b) :> bodyLines(b, indent)" },
  { c: "Css.Scope", id: "the donut limit `to ([data-scrml])` dropped", file: CSSF,
    from: '+ "\\"]) to ([data-scrml])", b, indent)', to: '+ "\\"])", b, indent)' },
  { c: "Scope.Flat", id: "`:where()` dropped (natural specificity)", file: CSSF,
    from: '.Flat(sel: c) :> ":where(" + complexText(c) + ")"', to: ".Flat(sel: c) :> complexText(c)" },
  { c: "Scope.Flat", id: "`:is()` instead of `:where()` (§65.2.5 never-:is)", file: CSSF,
    from: '.Flat(sel: c) :> ":where("', to: '.Flat(sel: c) :> ":is("' },
  { c: "Scope.Conditional", id: "conditional arms flattened too", file: CSSF,
    from: "if (armIsUnconditional(c)) return OutSel.Flat(c)", to: "return OutSel.Flat(c)" },
  { c: "Scope.Floor", id: "floor arms emitted AFTER the specific rules", file: CSSF,
    from: "return floor.concat(rest)", to: "return rest.concat(floor)" },
  { c: "Css.Reset", id: "the reset layer emptied", file: CSSF,
    from: 'if (u.reset) out = out.concat([CssStmt.Layer("reset", plainRules(resetRules()))])', to: 'if (u.reset) out = out.concat([CssStmt.Layer("reset", [])])' },
  { c: "Css.LayerOrder", id: "the layer order reversed (`global, reset`)", file: CSSF,
    from: 'CssStmt.LayerOrder(["reset", "global"])', to: 'CssStmt.LayerOrder(["global", "reset"])' },
  { c: "Css.Global", id: "program-global rules emitted unlayered", file: CSSF,
    from: 'out = out.concat([CssStmt.Layer("global", plainRules(u.global))])', to: "out = out.concat(plainRules(u.global))" },
  { c: "Css.Import", id: "`@import` emitted after the reset block (not hoisted)", file: CSSF,
    from: '        out = out.concat(importStmts(u))\n        if (u.reset) out = out.concat([CssStmt.Layer("reset", plainRules(resetRules()))])\n',
    to: '        if (u.reset) out = out.concat([CssStmt.Layer("reset", plainRules(resetRules()))])\n        out = out.concat(importStmts(u))\n' },
  { c: "Css.Charset", id: "`@charset` dropped", file: CSSF,
    from: "for (const c of u.charsets) { out = out.concat([CssStmt.Charset(c)]) }", to: "" },
  { c: "Css.Charset", id: "`@charset` emitted after the `@layer` statement (not byte 0)", file: CSSF,
    from: '        for (const c of u.charsets) { out = out.concat([CssStmt.Charset(c)]) }\n        const layered: boolean = u.reset || u.global.length > 0\n        if (layered) out = out.concat([CssStmt.LayerOrder(["reset", "global"])])\n',
    to: '        const layered: boolean = u.reset || u.global.length > 0\n        if (layered) out = out.concat([CssStmt.LayerOrder(["reset", "global"])])\n        for (const c of u.charsets) { out = out.concat([CssStmt.Charset(c)]) }\n' },
  // ---- review F4: each §65.3.4 reset bullet, on its own ----
  { c: "Reset.BoxSizing", id: "reset bullet 1: box-sizing rule emptied", file: CSSF,
    from: 'styleRule(boxArms, [decl("box-sizing", "border-box")])', to: "styleRule(boxArms, [])" },
  { c: "Reset.FlowMargin", id: "reset bullet 2: the flow-set margin rule matches nothing", file: CSSF,
    from: 'styleRule(tagArms(["body", "h1", "h2",', to: 'styleRule(tagArms(["x-none", "x-h1", "x-h2",' },
  { c: "Reset.Body", id: "reset bullet 5: body `min-height` dropped", file: CSSF,
    from: '[decl("min-height", "100vh"), decl("line-height", "1.5")]', to: '[decl("line-height", "1.5")]' },
  { c: "Reset.Body", id: "reset bullet 5: body `line-height` dropped", file: CSSF,
    from: '[decl("min-height", "100vh"), decl("line-height", "1.5")]', to: '[decl("min-height", "100vh")]' },
  { c: "Reset.Media", id: "reset bullet 3: the replaced-media rule matches nothing", file: CSSF,
    from: 'styleRule(tagArms(["img", "picture", "video", "canvas", "svg"]),', to: 'styleRule(tagArms(["x-none"]),' },
  { c: "Reset.FormFont", id: "reset bullet 4: form controls no longer inherit font", file: CSSF,
    from: '[decl("font", "inherit")]', to: "[]" },
  // ---- review F3: declaration order within a rule ----
  { c: "Decl.Order", id: "a rule's declarations printed in reverse order", file: CSSF,
    from: 'for (const d of ds) { body = body + " " + declText(d) }', to: 'for (const d of ds) { body = " " + declText(d) + body }' },
  { c: "Token.Constant", id: "a constant token's `:root` definition dropped", file: CSSF,
    from: ".Constant(value: v) :> [OutDecl.Custom(t.sym, v)]", to: ".Constant(value: v) :> []" },
  { c: "Token.OnVariant", id: "variant blocks key the wrong attribute", file: CSSF,
    from: '":root[data-scrml-theme-" + c', to: '":root[data-scrml-" + c' },
  { c: "Token.OnVariant", id: "variant arms dropped", file: CSSF,
    from: ".OnVariant(cell: c, arms: arms, otherwise: w) :> armGroups(gs, c, t.sym, arms)", to: ".OnVariant(cell: c, arms: arms, otherwise: w) :> gs" },
  { c: "Token.OnVariant.Otherwise", id: "the wildcard / base value dropped", file: CSSF,
    from: "if (w is some) return [OutDecl.Custom(s, w)]", to: "if (false) return [OutDecl.Custom(s, w)]" },
  // Review F1: kept to SHOW it is unobservable — a static value is overridden by the script's inline
  // `:root` write, so it can only differ before the first write (unruled). Token.ScriptWrites is not a
  // stylesheet construct (css.scrml footprint); this row is expected to bite nothing.
  { c: "Token.ScriptWrites", id: "an unrecognized token pinned by a static `:root` value (expected: no bite, F1)", file: CSSF,
    from: ".ScriptWrites(cell: c) :> []", to: '.ScriptWrites(cell: c) :> [OutDecl.Custom(t.sym, [CssPart.CssText("red")])]' },
  { c: "Value.TokenVar", id: "`@token` prints a wrong custom-property name", file: CSSF,
    from: '.TokenVar(token: s) :> "var(--"', to: '.TokenVar(token: s) :> "var(--x-"' },
  { c: "Value.CellVar", id: "`@cell` prints the token form", file: CSSF,
    from: '.CellVar(cell: s) :> "var(--scrml-"', to: '.CellVar(cell: s) :> "var(--"' },
  { c: "Value.Text", id: "literal value text emptied", file: CSSF,
    from: ".CssText(text: t) :> t", to: '.CssText(text: t) :> ""' },
  { c: "Sel.Universal", id: "`*` misprinted", file: CSSF, from: '.Universal :> "*"', to: '.Universal :> "*x"' },
  { c: "Sel.Tag", id: "a type selector misprinted", file: CSSF, from: ".TagSel(name: n) :> n\n", to: '.TagSel(name: n) :> n + "x"\n' },
  { c: "Sel.Class", id: "a class selector misprinted", file: CSSF, from: '.ClassSel(name: n) :> "." + n', to: '.ClassSel(name: n) :> "." + n + "x"' },
  { c: "Sel.Id", id: "an id selector printed as a class", file: CSSF, from: '.IdSel(name: n) :> "#" + n', to: '.IdSel(name: n) :> "." + n' },
  { c: "Sel.Attr", id: "an attribute test misprinted", file: CSSF, from: '.AttrSel(test: t) :> "[" + t + "]"', to: '.AttrSel(test: t) :> "[data-x-" + t + "]"' },
  { c: "Sel.PseudoClass", id: "a pseudo-class misprinted", file: CSSF, from: ".PseudoClass(name: n, arg: a) :> pseudoText(n, a)", to: '.PseudoClass(name: n, arg: a) :> ":x-" + n' },
  { c: "Sel.PseudoElement", id: "a pseudo-element misprinted", file: CSSF, from: '.PseudoElement(name: n) :> "::" + n', to: '.PseudoElement(name: n) :> "::x-" + n' },
  { c: "Comb.Descendant", id: "descendant prints as next-sibling", file: CSSF, from: '.Descendant :> " "', to: '.Descendant :> " + "' },
  { c: "Comb.Child", id: "child prints as descendant", file: CSSF, from: '.DirectChild :> " > "', to: '.DirectChild :> " "' },
  { c: "Comb.NextSibling", id: "next-sibling prints as later-sibling", file: CSSF, from: '.NextSibling :> " + "', to: '.NextSibling :> " ~ "' },
  { c: "Comb.LaterSibling", id: "later-sibling prints as next-sibling", file: CSSF, from: '.LaterSibling :> " ~ "', to: '.LaterSibling :> " + "' },
  // ---- the stylesheet shim (its mapping of each legacy form) ----
  { c: "Css.Scope", id: "shim: component rules attributed to the program", file: CSSI,
    from: "return { charsets: charsets, imports: imports, global: sh.global, scopes: addScopeRules(sh.scopes, b.at.scope, rs), why: why }",
    to: "return { charsets: charsets, imports: imports, global: sh.global.concat(rs), scopes: sh.scopes, why: why }" },
  { c: "Css.Reset", id: 'shim: `reset="none"` ignored', file: CSSI,
    from: 'if (s == "none") return { on: false, why: [] }', to: 'if (s == "none") return { on: true, why: [] }' },
  { c: "Token.OnVariant", id: "shim: legacy `.Variant` re-binds dropped", file: CSSI,
    from: "if (r.arms.length == 0) return { init: TokenInit.Constant(base.parts), why: base.why }", to: "if (true) return { init: TokenInit.Constant(base.parts), why: base.why }" },
  { c: "Value.TokenVar", id: "shim: `@token` resolved as a cell", file: CSSI,
    from: "parts = parts.concat([CssPart.TokenVar(tok)])", to: "parts = parts.concat([CssPart.CellVar(tok)])" },
  { c: "Css.Global", id: "shim: element-level `#{}` dropped (R4 undone)", file: CSSI,
    from: 'const global: boolean = b.at.level == "program" || b.at.level == "element"', to: 'const global: boolean = b.at.level == "program"' },
  { c: "Css.Import", id: "shim: a program-level `@import` dropped", file: CSSI,
    from: "imports = imports.concat([h.imp])", to: "imports = imports" },
];

function grade(stage, sub, only, outJson) {
  const args = ["scripts/hybrid.ts", "--swap", `${stage}=${sub}`, "--footprint", "--json", outJson];
  if (only) args.push("--only", only.join(","));
  rmSync(outJson, { force: true }); // never read a previous run's report
  const r = spawnSync("bun", args, { cwd: ROOT, encoding: "utf8", timeout: 900000, maxBuffer: 64 * 1024 * 1024 });
  try {
    const rep = JSON.parse(readFileSync(outJson, "utf8"));
    return { ran: true, exit: r.status, counts: rep.counts, cases: rep.cases, report: rep };
  } catch {
    // No report: the run itself failed (e.g. the mutated bootstrap does not compile). NOT a bite.
    const why = ((r.stderr ?? "") + (r.stdout ?? "")).split("\n").filter((l) => /hybrid:|error|Error/.test(l))[0] ?? `exit ${r.status}`;
    return { ran: false, exit: r.status, why: why.slice(0, 200) };
  }
}

const argv = process.argv.slice(2);
const reportPath = (() => { const i = argv.indexOf("--report"); return i === -1 ? null : argv[i + 1]; })();
const FRONT_ONLY = argv.includes("--front");
const phaseSel = FRONT_ONLY ? [] : argv.includes("--css-only") ? ["css"] : argv.includes("--cg-only") ? ["cg"] : ["cg", "css"];
const withFront = FRONT_ONLY || !(argv.includes("--css-only") || argv.includes("--cg-only"));

const PHASES = {
  cg: {
    title: "CG — the bootstrap printer / runtime / ingest shim (runtime passes)",
    stage: "CG", subFile: "substitute.js", mutations: MUTATIONS, unit: "runtime passes",
    note: "codes-only passes excluded — front-end codes",
    passesOf: (g) => g.counts.runtimePass,
    exercisedOf: (g, passes) => [...new Set(g.cases.filter((c) => passes.includes(c.relDir)).flatMap((c) => c.constructs))].sort(),
    judge: judgeDeaths,
    killWord: "still graded, run FAILED",
  },
  css: {
    title: "CSS — the bootstrap stylesheet pass (css passes: computed style in Chromium against SPEC-derived oracles)",
    stage: "CSS", subFile: "css-substitute.js", mutations: CSS_MUTATIONS, unit: "css passes",
    note: "conformance css halves + css-only sources + Core-level T3 oracles",
    passesOf: (g) => g.counts.cssPass,
    exercisedOf: (g) => g.report.css?.exercised ?? [],
    judge: judgeCssDeaths,
    killWord: "still graded, css oracle FAILED",
  },
};

const MIRROR = join(ROOT, ".tmp", `bite-matrix-${process.pid}`);
rmSync(MIRROR, { recursive: true, force: true });
mkdirSync(join(MIRROR, "compiler"), { recursive: true });
cpSync(join(ROOT, SH), join(MIRROR, SH), { recursive: true });
// `examples` — css-oracle sources compile real examples in place (`"from"`), resolved from the tree root.
for (const rel of ["compiler/src", "compiler/native-parser", "compiler/SPEC.md", "bunfig.toml", "package.json", "examples"]) {
  symlinkSync(join(ROOT, rel), join(MIRROR, rel));
}
const OUT = join(MIRROR, "grade.json");

let bad = false;
const t0 = performance.now();
const sections = [];
let totalUncertified = 0;
try {
  for (const name of phaseSel) {
    const P = PHASES[name];
    const SUB = join(MIRROR, SH, "slice-m3", P.subFile);
    let mirrorOk = true; // its own flag: a hollow site must not read as "the mirror did not reproduce"
    const rows = [];
    const kills = new Map(); // construct → Set(killed passes)
    // The clean grade on the SOURCE, then the unmutated mirror must reproduce it exactly.
    const clean = grade(P.stage, join(ROOT, SH, "slice-m3", P.subFile), null, OUT);
    if (!clean.ran) { console.error(`[${name}] the clean grade did not run: ${clean.why}`); process.exit(2); }
    const passes = P.passesOf(clean);
    const exercised = P.exercisedOf(clean, passes);
    const mirrorClean = grade(P.stage, SUB, passes, OUT);
    if (!mirrorClean.ran || P.passesOf(mirrorClean).join() !== passes.join()) {
      console.error(`[${name}] the unmutated mirror does not reproduce the clean grade (${mirrorClean.ran ? P.passesOf(mirrorClean).length : mirrorClean.why} vs ${passes.length} ${P.unit})`);
      mirrorOk = false;
      bad = true;
    }
    for (const m of P.mutations) {
      const path = join(MIRROR, m.file);
      const orig = readFileSync(path, "utf8");
      const n = orig.split(m.from).length - 1;
      if (n !== 1) {
        rows.push(`| ${m.c} | ${m.id} | site found ${n}× — NOT RUN (hollow) | — |`);
        bad = true;
        continue;
      }
      try {
        writeFileSync(path, orig.replace(m.from, m.to));
        const r = grade(P.stage, SUB, passes, OUT);
        if (!r.ran) {
          rows.push(`| ${m.c} | ${m.id} | GRADE DID NOT RUN — not a bite | ${r.why.replace(/\|/g, "\\|")} |`);
          bad = true;
          continue;
        }
        // A KILL is a case still GRADED whose run FAILED; a reclassified / crashed / missing case is
        // reported, but is NOT a bite (bite-lib.js).
        const { killed, lost } = P.judge(passes, r.report);
        if (!kills.has(m.c)) kills.set(m.c, new Set());
        for (const d of killed) kills.get(m.c).add(d);
        const lostNote = lost.length ? ` · NOT a bite: ${lost.map((x) => "`" + x.relDir + "` (" + x.why + ")").join(", ")}` : "";
        rows.push(`| ${m.c} | ${m.id} | ${killed.length} of ${passes.length} | ${killed.length ? killed.map((d) => "`" + d + "`").join(", ") : "**none — does not bite**"}${lostNote} |`);
      } finally {
        writeFileSync(path, orig);
      }
    }
    const certified = exercised.filter((c) => (kills.get(c)?.size ?? 0) > 0);
    const uncertified = exercised.filter((c) => !certified.includes(c)).map((c) =>
      kills.has(c) ? `\`${c}\` — its corruption(s) kill no ${P.unit.replace(/s$/, "")}` : `\`${c}\` — no corruption defined (structural: no emission of its own to corrupt)`);
    totalUncertified += uncertified.length;
    const L = [];
    L.push(`## ${P.title}`, "");
    L.push(`Clean grade: **${passes.length} ${P.unit}** (${P.note}). Mirror reproduced it: ${mirrorOk ? "yes" : "NO"}.`, "");
    L.push(`| construct | corruption | ${P.unit} killed (${P.killWord}) | which |`, "|---|---|---|---|", ...rows, "");
    L.push(`### CERTIFIED (${certified.length}) — a corruption kills ≥1 of the ${P.unit}`, "", certified.map((c) => "`" + c + "`").join(" · ") || "(none)", "");
    L.push(`### UNCERTIFIED (${uncertified.length}) — exercised by a pass, but no evidence it is implemented`, "");
    for (const u of uncertified) L.push(`- ${u}`);
    sections.push(L.join("\n"));
  }
  if (withFront) {
    const F = [];
    frontSection(F);
    sections.push(F.join("\n"));
  }
  const text = ["# Bite matrix — footprint-grade construct certification", "", ...sections, "", `(${((performance.now() - t0) / 1000).toFixed(1)}s)`].join("\n") + "\n";
  console.log(text);
  if (reportPath) writeFileSync(reportPath, text);
} finally {
  rmSync(MIRROR, { recursive: true, force: true });
}
process.exit(bad ? 1 : 0);
