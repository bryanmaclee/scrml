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
// usage: bun compiler/self-host-v2/slice-m3/bench/bite-matrix.js [--report <path.md>]

import { cpSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { judgeDeaths } from "./bite-lib.js";

const ROOT = join(import.meta.dir, "..", "..", "..", "..");
const SH = "compiler/self-host-v2";
const PRINT = `${SH}/print.scrml`;
const RT = `${SH}/slice-m1/runtime/runtime.js`;
const INGEST = `${SH}/ingest.scrml`;

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

function grade(sub, only, outJson) {
  const args = ["scripts/hybrid.ts", "--swap", `CG=${sub}`, "--footprint", "--json", outJson];
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

const reportPath = (() => { const i = process.argv.indexOf("--report"); return i === -1 ? null : process.argv[i + 1]; })();

const MIRROR = join(ROOT, ".tmp", `bite-matrix-${process.pid}`);
rmSync(MIRROR, { recursive: true, force: true });
mkdirSync(join(MIRROR, "compiler"), { recursive: true });
cpSync(join(ROOT, SH), join(MIRROR, SH), { recursive: true });
for (const rel of ["compiler/src", "compiler/native-parser", "compiler/SPEC.md", "bunfig.toml", "package.json"]) {
  symlinkSync(join(ROOT, rel), join(MIRROR, rel));
}
const SUB = join(MIRROR, SH, "slice-m3", "substitute.js");
const OUT = join(MIRROR, "grade.json");

let bad = false;
let mirrorOk = true; // its own flag: a hollow site must not read as "the mirror did not reproduce"
const rows = [];
const kills = new Map(); // construct → Set(killed runtime passes)
const t0 = performance.now();
try {
  // The clean grade on the SOURCE, then the unmutated mirror must reproduce it exactly.
  const clean = grade(join(ROOT, SH, "slice-m3", "substitute.js"), null, OUT);
  if (!clean.ran) { console.error(`the clean grade did not run: ${clean.why}`); process.exit(2); }
  const passes = clean.counts.runtimePass;
  const exercised = [...new Set(clean.cases.filter((c) => passes.includes(c.relDir)).flatMap((c) => c.constructs))].sort();
  const mirrorClean = grade(SUB, passes, OUT);
  if (!mirrorClean.ran || mirrorClean.counts.runtimePass.join() !== passes.join()) {
    console.error(`the unmutated mirror does not reproduce the clean grade (${mirrorClean.ran ? mirrorClean.counts.runtimePass.length : mirrorClean.why} vs ${passes.length} runtime passes)`);
    mirrorOk = false;
    bad = true;
  }
  for (const m of MUTATIONS) {
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
      const r = grade(SUB, passes, OUT);
      if (!r.ran) {
        rows.push(`| ${m.c} | ${m.id} | GRADE DID NOT RUN — not a bite | ${r.why.replace(/\|/g, "\\|")} |`);
        bad = true;
        continue;
      }
      // A KILL is a case still GRADED whose conformance run FAILED; a reclassified / crashed /
      // missing case is reported, but is NOT a bite (bite-lib.js).
      const { killed, lost } = judgeDeaths(passes, r.report);
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
    kills.has(c) ? `\`${c}\` — its corruption(s) kill no runtime pass` : `\`${c}\` — no corruption defined (structural: no emission of its own to corrupt)`);
  const L = [];
  L.push("# Bite matrix — footprint-grade construct certification", "");
  L.push(`Clean grade: **${passes.length} runtime passes** (codes-only passes excluded — front-end codes). Mirror reproduced it: ${mirrorOk ? "yes" : "NO"}.`, "");
  L.push("| construct | corruption | runtime passes killed (still graded, run FAILED) | which |", "|---|---|---|---|", ...rows, "");
  L.push(`## CERTIFIED (${certified.length}) — a corruption kills ≥1 runtime pass`, "", certified.map((c) => "`" + c + "`").join(" · ") || "(none)", "");
  L.push(`## UNCERTIFIED (${uncertified.length}) — exercised by a passing runtime case, but no evidence it is implemented`, "");
  for (const u of uncertified) L.push(`- ${u}`);
  L.push("", `(${((performance.now() - t0) / 1000).toFixed(1)}s)`);
  const text = L.join("\n") + "\n";
  console.log(text);
  if (reportPath) writeFileSync(reportPath, text);
} finally {
  rmSync(MIRROR, { recursive: true, force: true });
}
process.exit(bad ? 1 : 0);
