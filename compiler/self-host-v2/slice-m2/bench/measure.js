// measure.js — slice-M2 measurements (reported in slice-m2/progress.md):
//   (a) lines of scrml per front-end phase (total / code = non-blank, non-comment);
//   (b) Core size — lowered vs the hand-built oracle (they are equal: the proof);
//   (c) compile time per phase for both programs (median of warm runs).
// usage: bun compiler/self-host-v2/slice-m2/bench/measure.js

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadM2 } from "../harness.js";
import { compileProgram } from "../lowered.js";
import { coreSize } from "../compare.js";

const SH = join(import.meta.dir, "..", "..");

function lines(file, fromMarker) {
  let src = readFileSync(join(SH, file), "utf8");
  if (fromMarker) src = src.slice(src.indexOf(fromMarker));
  const all = src.split("\n");
  const code = all.filter((l) => l.trim() !== "" && !l.trim().startsWith("//"));
  // "match arm lines" — the price of total matches with no default arm (dpa-051 §3.4)
  const arms = all.filter((l) => /^\s*\.[A-Z][A-Za-z]*(\([^)]*\))?\s*:>/.test(l));
  return { total: all.length, code: code.length, arms: arms.length };
}

const phases = [
  ["lex (lexFrom region lexing, added in M2)", "lex.scrml", "// REGION lexing"],
  ["ast (FileAst types)", "ast.scrml"],
  ["parse", "parse.scrml"],
  ["analyze", "analyze.scrml"],
  ["lower", "lower.scrml"],
];
console.log("| phase | lines | code lines | match-arm lines |\n|---|---|---|---|");
for (const [name, f, marker] of phases) {
  const n = lines(f, marker);
  console.log(`| ${name} | ${n.total} | ${n.code} | ${n.arms} |`);
}

const { mods } = loadM2();
const oracle = { counter: mods["counter.core"].counterCore(), dropdown: mods["dropdown.core"].dropdownCore() };
console.log("\n| program | AST nodes | Core nodes (lowered) | Core nodes (oracle) | parse ms | analyze ms | lower ms | total ms |\n|---|---|---|---|---|---|---|---|");
const median = (xs) => xs.slice().sort((a, b) => a - b)[Math.floor(xs.length / 2)];
for (const name of ["counter", "dropdown"]) {
  compileProgram(mods, name); // warm
  const runs = [];
  let r = null;
  for (let i = 0; i < 15; i++) { r = compileProgram(mods, name); runs.push(r.ms); }
  const m = (k) => median(runs.map((x) => x[k])).toFixed(2);
  const counts = mods.measure.countNodes(r.core).reduce((n, k) => n + k.count, 0);
  const oc = mods.measure.countNodes(oracle[name]).reduce((n, k) => n + k.count, 0);
  console.log(`| ${name} | ${r.nodes} | ${counts} (${coreSize(r.core)} objects) | ${oc} (${coreSize(oracle[name])} objects) | ${m("parse")} | ${m("analyze")} | ${m("lower")} | ${m("total")} |`);
}
