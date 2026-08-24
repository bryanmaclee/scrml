/**
 * S372 trace probe — where does the `${render name()}` expression become an
 * EMPTY escape-hatch? Runs BS + TAB directly on several sources, including the
 * exact `raw` string CE re-parses in parseComponentBody.
 *
 * No compiler source is modified — splitBlocks and buildAST are public exports.
 *
 * Run from the worktree root:
 *   bun docs/changes/render-snippet-slot-trace-2026-08-24/probe-tab.mjs
 */
import { splitBlocks } from "../../../compiler/src/block-splitter.js";
import { buildAST } from "../../../compiler/src/ast-builder.js";
import { parseExprToNode } from "../../../compiler/src/expression-parser.ts";

const D = "$";

function tab(label, source) {
  console.log("-".repeat(78));
  console.log(label);
  const bs = splitBlocks("/tmp/probe.scrml", source);
  console.log(`  BS errors: ${(bs.errors ?? []).map((e) => e.code ?? e.message).join(",") || "(none)"}`);
  const t = buildAST(bs, null);
  console.log(`  TAB errors: ${(t.errors ?? []).map((e) => e.code ?? e.message).join(",") || "(none)"}`);
  const out = [];
  collectLogic(t.ast, out);
  for (const { path, node } of out) {
    for (const b of node.body ?? []) {
      if (!b) continue;
      const en = b.exprNode;
      console.log(
        `  ${path}  kind=${b.kind} expr=${JSON.stringify(b.expr ?? null)} ` +
          `exprNode=${en ? en.kind : "ABSENT"}` +
          (en && en.raw !== undefined ? ` raw=${JSON.stringify(en.raw)}` : "") +
          (en && en.kind === "call" ? ` callee=${JSON.stringify(en.callee && en.callee.name)}` : ""),
      );
    }
    if ((node.body ?? []).length === 0) console.log(`  ${path}  body=[] (EMPTY)`);
  }
  if (out.length === 0) console.log("  (no logic nodes)");
  return t;
}

function collectLogic(node, out, path = "ast") {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) return node.forEach((n, i) => collectLogic(n, out, `${path}[${i}]`));
  if (node.kind === "logic") out.push({ path, node });
  for (const [k, v] of Object.entries(node)) {
    if (k === "parent") continue;
    if (v && typeof v === "object") collectLogic(v, out, `${path}.${k}`);
  }
}

console.log("=".repeat(78));
console.log("STEP A — does parseExprToNode handle `render body()` at all?");
console.log("=".repeat(78));
for (const s of ["render body()", "render body ( )", "render control(label)", "body()"]) {
  const n = parseExprToNode(s, "/tmp/probe.scrml", 0);
  console.log(`  ${JSON.stringify(s).padEnd(26)} -> kind=${n && n.kind} ` +
    (n && n.kind === "call" ? `callee=${n.callee && n.callee.name}` : `raw=${JSON.stringify(n && n.raw)}`));
}

console.log("");
console.log("=".repeat(78));
console.log("STEP B — BS+TAB on ORDINARY markup (no component at all)");
console.log("=".repeat(78));
tab(
  "B-a  ${render body()} inside a plain <div> in <program> markup",
  ["<program>", "", "<div class=\"x\">" + D + "{render body()}</div>", "", "</program>", ""].join("\n"),
);
tab(
  "B-b  CONTROL: ${children} inside a plain <div>",
  ["<program>", "", "<div class=\"x\">" + D + "{children}</div>", "", "</program>", ""].join("\n"),
);
tab(
  "B-c  CONTROL: ${someFn()} inside a plain <div>",
  ["<program>", "", "<div class=\"x\">" + D + "{someFn()}</div>", "", "</program>", ""].join("\n"),
);

console.log("");
console.log("=".repeat(78));
console.log("STEP C — BS+TAB on the exact `raw` CE re-parses (parseComponentBody input)");
console.log("=".repeat(78));
// The raw captured from the TAB component-def node in probe-ast.mjs.
const RAW =
  "<div class=\"card\" props={ body: snippet }>\n" +
  "<div class=\"card__body\">" + D + "{render body()}</div>\n" +
  "</>";
tab("C-a  component-def raw, normalised closers", RAW);
