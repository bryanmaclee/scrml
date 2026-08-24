/**
 * S372 trace probe — CLOSE the execution path on the decision site.
 *
 *   compiler/native-parser/translate-expr.js:296-297
 *       case ExprKind.Render:
 *           return makeEscapeHatch("Render", "", nativeExpr.span);
 *
 * Asserts:
 *   1. the native parser DOES parse `render name(args)` into a Render node
 *      that carries `name` + `args`  (parse-expr.js:2683 makeRender);
 *   2. the A2 bridge discards both into an escape-hatch stamped
 *      nativeKind:"Render", raw:"" — with ZERO diagnostics;
 *   3. the same body through the LIVE parser keeps the expression;
 *   4. the flagship example's own component body reproduces (1)+(2);
 *   5. emit-expr's escape-hatch fallback lowers raw:"" to nothing.
 *
 * No compiler source is modified.
 *
 * Run from the worktree root:
 *   bun docs/changes/render-snippet-slot-trace-2026-08-24/probe-decision-site.mjs
 */
import { nativeParseFile } from "../../../compiler/native-parser/parse-file.js";
import { parseExpression } from "../../../compiler/native-parser/parse-expr.js";
import { splitBlocks } from "../../../compiler/src/block-splitter.js";
import { buildAST } from "../../../compiler/src/ast-builder.js";

const D = "$";

function firstLogicBareExpr(ast) {
  let found = null;
  (function walk(n) {
    if (found || !n || typeof n !== "object") return;
    if (Array.isArray(n)) return n.forEach(walk);
    if (n.kind === "logic" && Array.isArray(n.body)) {
      const b = n.body.find((x) => x && x.kind === "bare-expr");
      if (b) { found = b; return; }
    }
    for (const [k, v] of Object.entries(n)) {
      if (k === "parent") continue;
      if (v && typeof v === "object") walk(v);
    }
  })(ast);
  return found;
}

const BODY = [
  "<div class=\"card\" props={ header: snippet, body: snippet }>",
  "<div class=\"card__header\">" + D + "{render header()}</div>",
  "</>",
].join("\n");

console.log("=".repeat(78));
console.log("1/2  NATIVE parse of a component body containing ${render header()}");
console.log("=".repeat(78));
const nat = nativeParseFile("/tmp/probe.scrml#Card", BODY);
const nb = firstLogicBareExpr(nat.ast);
console.log(`  bare-expr.expr      = ${JSON.stringify(nb && nb.expr)}`);
console.log(`  exprNode            = ${JSON.stringify(nb && nb.exprNode)}`);
console.log(`  native diagnostics  = ${(nat.errors ?? []).map((e) => `${e.code}/${e.severity ?? "error"}`).join(",") || "(NONE — silent)"}`);
const isTheSite =
  nb && nb.exprNode && nb.exprNode.kind === "escape-hatch" &&
  nb.exprNode.nativeKind === "Render" && nb.exprNode.raw === "";
console.log(`  >>> escape-hatch nativeKind==="Render" && raw==="" : ${isTheSite ? "YES — DECISION SITE CONFIRMED" : "NO"}`);

console.log("");
console.log("=".repeat(78));
console.log("3    LIVE parse of the SAME body (the path CE does NOT take)");
console.log("=".repeat(78));
const live = buildAST(splitBlocks("/tmp/probe.scrml#Card", BODY));
const lb = firstLogicBareExpr(live.ast);
console.log(`  bare-expr.expr      = ${JSON.stringify(lb && lb.expr)}`);
console.log(`  exprNode.kind       = ${lb && lb.exprNode && lb.exprNode.kind}`);
console.log(`  exprNode.callee     = ${JSON.stringify(lb && lb.exprNode && lb.exprNode.callee && lb.exprNode.callee.name)}`);

console.log("");
console.log("=".repeat(78));
console.log("1    the native Render node BEFORE the bridge — does it carry name+args?");
console.log("=".repeat(78));
for (const s of ["render header()", "render control(label)"]) {
  try {
    const r = parseExpression(s, "/tmp/probe.scrml");
    const e = r && (r.expr ?? r.node ?? r);
    console.log(`  ${JSON.stringify(s).padEnd(26)} -> ${JSON.stringify(e && { kind: e.kind, name: e.name, args: (e.args ?? []).length })}`);
  } catch (err) {
    console.log(`  ${JSON.stringify(s).padEnd(26)} -> parseExpression signature differs: ${err.message.slice(0, 90)}`);
  }
}

console.log("");
console.log("=".repeat(78));
console.log("4    the FLAGSHIP component body (examples/12-snippets-slots.scrml Card)");
console.log("=".repeat(78));
const FLAG = [
  "<div class=\"card\" props={",
  "  header:   snippet,",
  "  body:     snippet,",
  "  actions?: snippet,",
  "}>",
  D + "{children}",
  "<div class=\"card__header\">",
  "  " + D + "{render header()}",
  "</div>",
  "<div class=\"card__body\">",
  "  " + D + "{render body()}",
  "</div>",
  "<div class=\"card__actions\" if=(actions is some)>",
  "  " + D + "{render actions()}",
  "</div>",
  "</>",
].join("\n");
const fnat = nativeParseFile("/tmp/probe.scrml#Card", FLAG);
const hits = [];
(function walk(n) {
  if (!n || typeof n !== "object") return;
  if (Array.isArray(n)) return n.forEach(walk);
  if (n.kind === "logic" && Array.isArray(n.body)) {
    for (const b of n.body) if (b && b.kind === "bare-expr") hits.push(b);
  }
  for (const [k, v] of Object.entries(n)) {
    if (k === "parent") continue;
    if (v && typeof v === "object") walk(v);
  }
})(fnat.ast);
for (const h of hits) {
  const en = h.exprNode ?? {};
  console.log(`  expr=${JSON.stringify(h.expr)} exprNode.kind=${en.kind} nativeKind=${en.nativeKind ?? "-"} raw=${JSON.stringify(en.raw ?? null)} name=${JSON.stringify(en.name ?? null)}`);
}
console.log(`  native diagnostics = ${(fnat.errors ?? []).map((e) => `${e.code}/${e.severity ?? "error"}`).join(",") || "(NONE — silent)"}`);
