/**
 * S372 trace probe — run CE directly on a captured TAB result and dump the
 * post-CE node that survived at the `${render body()}` site, then re-run the
 * EXACT `_injectChildrenWalk` renderMatch predicate against it.
 *
 * No compiler source is modified: buildAST is captured through the sanctioned
 * `selfHostModules.buildAST` seam (api.js:1259) and `runCE` is a public export.
 *
 * Run from the worktree root:
 *   bun docs/changes/render-snippet-slot-trace-2026-08-24/probe-ce.mjs
 */
import { resolve } from "path";
import { writeFileSync, mkdirSync } from "fs";
import { compileScrml } from "../../../compiler/src/api.js";
import { buildAST } from "../../../compiler/src/ast-builder.js";
import { runCE } from "../../../compiler/src/component-expander.ts";

const ROOT =
  "/tmp/claude-1000/-home-bryan-maclee-scrmlMaster-scrml/c20a4934-e469-4e73-bdcc-bc7e84917205/scratchpad/s372-ce";
const D = "$";

const CASES = {
  b1_slot: [
    "<program>",
    "",
    "  const Card = <div class=\"card\" props={ body: snippet }>",
    "    <div class=\"card__body\">" + D + "{render body()}</div>",
    "  </>",
    "",
    "  <div class=\"app\">",
    "    <Card>",
    "      <em slot=\"body\">SLOTTED-EM</em>",
    "    </Card>",
    "  </div>",
    "",
    "</program>",
    "",
  ].join("\n"),

  // Same component but declared INSIDE an explicit ${...} logic wrapper, so the
  // Bug-2 auto-lift synthesis (which drops BS BLOCK_REFs) is NOT on the path.
  b1_wrapped: [
    "<program>",
    "",
    "${",
    "  const Card = <div class=\"card\" props={ body: snippet }>",
    "    <div class=\"card__body\">" + D + "{render body()}</div>",
    "  </>",
    "}",
    "",
    "  <div class=\"app\">",
    "    <Card>",
    "      <em slot=\"body\">SLOTTED-EM</em>",
    "    </Card>",
    "  </div>",
    "",
    "</program>",
    "",
  ].join("\n"),

  children_control: [
    "<program>",
    "",
    "  const Card = <div class=\"card\">",
    "    <div class=\"card__body\">" + D + "{children}</div>",
    "  </>",
    "",
    "  <div class=\"app\">",
    "    <Card><em>UNSLOTTED-EM</em></Card>",
    "  </div>",
    "",
    "</program>",
    "",
  ].join("\n"),
};

function capture(name, source) {
  const dir = resolve(ROOT, name);
  mkdirSync(dir, { recursive: true });
  const input = resolve(dir, `${name}.scrml`);
  writeFileSync(input, source);
  let tab = null;
  compileScrml({
    inputFiles: [input],
    write: true,
    outputDir: resolve(dir, "out"),
    selfHostModules: { buildAST: (bs) => (tab = buildAST(bs, null)) },
  });
  return tab;
}

/** Verbatim copy of the renderMatch predicate at component-expander.ts:3066-3089. */
function renderMatchOf(logicChild) {
  let renderMatch = null;
  let renderParamMatch = null;
  const notes = [];
  if (!Array.isArray(logicChild.body)) return { renderMatch, renderParamMatch, notes: ["body not an array"] };
  for (const n of logicChild.body) {
    if (renderMatch || renderParamMatch) break;
    if (!n) continue;
    if (n.kind !== "bare-expr") { notes.push(`body node kind=${n.kind} (not bare-expr)`); continue; }
    if (!n.exprNode) { notes.push("bare-expr has NO exprNode"); continue; }
    const en = n.exprNode;
    if (en.kind !== "call") { notes.push(`exprNode.kind=${en.kind} (not call) raw=${JSON.stringify(en.raw ?? en.name ?? "")}`); continue; }
    const callee = en.callee;
    if (!callee || callee.kind !== "ident") { notes.push(`callee.kind=${callee && callee.kind}`); continue; }
    const m = String(callee.name).match(/^__scrml_render_([A-Za-z_$][A-Za-z0-9_$]*)__$/);
    if (!m) { notes.push(`callee.name=${callee.name} (no __scrml_render_X__ match)`); continue; }
    if ((en.args ?? []).length === 0) renderMatch = m[1];
    else renderParamMatch = { name: m[1] };
  }
  return { renderMatch, renderParamMatch, notes };
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

for (const [name, source] of Object.entries(CASES)) {
  console.log("=".repeat(78));
  console.log(name);
  console.log("=".repeat(78));
  const tab = capture(name, source);
  if (!tab) { console.log("  TAB capture FAILED"); continue; }

  const ce = runCE({ files: [tab], exportRegistry: new Map(), fileASTMap: new Map(), importGraph: new Map() });
  console.log(`  CE errors: ${(ce.errors ?? []).map((e) => e.code).join(",") || "(none)"}`);

  const out = [];
  collectLogic(ce.files?.[0]?.ast, out);
  console.log(`  post-CE logic nodes: ${out.length}`);
  for (const { path, node } of out) {
    const bodyKinds = (node.body ?? []).map((b) => b && b.kind).join("|");
    console.log(`\n  --- ${path}   body kinds: [${bodyKinds}]`);
    for (const b of node.body ?? []) {
      if (!b) continue;
      const en = b.exprNode;
      console.log(
        `      bare?=${b.kind === "bare-expr"} expr=${JSON.stringify(b.expr ?? null)} ` +
          `exprNode.kind=${en ? en.kind : "ABSENT"}` +
          (en && en.kind === "call" ? ` callee=${JSON.stringify(en.callee)}` : "") +
          (en && en.kind === "escape-hatch" ? ` raw=${JSON.stringify(en.raw)}` : "") +
          (en && en.kind === "ident" ? ` name=${JSON.stringify(en.name)}` : ""),
      );
    }
    const v = renderMatchOf(node);
    console.log(`      renderMatch=${v.renderMatch} renderParamMatch=${JSON.stringify(v.renderParamMatch)} notes=${JSON.stringify(v.notes)}`);
  }
  console.log("");
}
