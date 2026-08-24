/**
 * S372 trace probe — DECISION SITE confirmation.
 *
 * component-expander.ts:1153 `reparseSynthesizedFile` routes the component-def
 * body re-parse through `nativeParseFile` (compiler/native-parser/parse-file.js)
 * unless `sourceNeedsLiveFallback` (`:1079`) trips. This probe runs BOTH parsers
 * on the same synthesized body and diffs the logic-node exprNode.
 *
 * No compiler source is modified — both parsers are public exports.
 *
 * Run from the worktree root:
 *   bun docs/changes/render-snippet-slot-trace-2026-08-24/probe-native.mjs
 */
import { splitBlocks } from "../../../compiler/src/block-splitter.js";
import { buildAST } from "../../../compiler/src/ast-builder.js";
import { nativeParseFile } from "../../../compiler/native-parser/parse-file.js";

const D = "$";

function collectLogic(node, out, path = "ast") {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) return node.forEach((n, i) => collectLogic(n, out, `${path}[${i}]`));
  if (node.kind === "logic") out.push({ path, node });
  for (const [k, v] of Object.entries(node)) {
    if (k === "parent") continue;
    if (v && typeof v === "object") collectLogic(v, out, `${path}.${k}`);
  }
}

function describe(ast) {
  const out = [];
  collectLogic(ast, out);
  if (out.length === 0) return ["    (no logic nodes)"];
  const lines = [];
  for (const { path, node } of out) {
    if (!Array.isArray(node.body) || node.body.length === 0) {
      lines.push(`    ${path}  body=[] EMPTY`);
      continue;
    }
    for (const b of node.body) {
      if (!b) continue;
      const en = b.exprNode;
      lines.push(
        `    ${path}  kind=${b.kind} expr=${JSON.stringify(b.expr ?? null)} ` +
          `exprNode=${en ? en.kind : "ABSENT"}` +
          (en && en.raw !== undefined ? ` raw=${JSON.stringify(en.raw)}` : "") +
          (en && en.kind === "call" ? ` callee=${JSON.stringify(en.callee && en.callee.name)}` : "") +
          (en && en.kind === "ident" ? ` name=${JSON.stringify(en.name)}` : ""),
      );
    }
  }
  return lines;
}

const BODIES = {
  "render body()": [
    "<div class=\"card\" props={ body: snippet }>",
    "<div class=\"card__body\">" + D + "{render body()}</div>",
    "</>",
  ].join("\n"),
  "render control(label)": [
    "<div class=\"row\" props={ label: string, control: snippet }>",
    "<span class=\"c\">" + D + "{render control(label)}</span>",
    "</>",
  ].join("\n"),
  "CONTROL ${children}": [
    "<div class=\"card\">",
    "<div class=\"card__body\">" + D + "{children}</div>",
    "</>",
  ].join("\n"),
  "CONTROL ${someFn()}": [
    "<div class=\"card\">",
    "<div class=\"card__body\">" + D + "{someFn()}</div>",
    "</>",
  ].join("\n"),
  "CONTROL ${label}": [
    "<div class=\"card\" props={ label: string }>",
    "<div class=\"card__body\">" + D + "{label}</div>",
    "</>",
  ].join("\n"),
};

for (const [label, src] of Object.entries(BODIES)) {
  console.log("=".repeat(78));
  console.log(label);
  console.log("=".repeat(78));

  console.log("  LIVE  (splitBlocks + buildAST):");
  const bs = splitBlocks("/tmp/probe.scrml#C", src);
  const live = buildAST(bs);
  for (const l of describe(live.ast)) console.log(l);

  console.log("  NATIVE (nativeParseFile) — the DEFAULT path for a component body:");
  const nat = nativeParseFile("/tmp/probe.scrml#C", src);
  for (const l of describe(nat.ast)) console.log(l);
  const diags = (nat.errors ?? []).map((e) => `${e.code}/${e.severity ?? "error"}`).join(",");
  console.log(`    native diagnostics: ${diags || "(none)"}`);
  console.log("");
}
