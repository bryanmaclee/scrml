/**
 * S469 r7 — the seeded arm-list differential at the SERVER and ENGINE `derived=` positions
 * (adapted from the s469-impl1-arm-commas final reviewer's fuzz7). These positions lower a match
 * from TEXT (`rewriteMatchExpr`: a server function's `v = match …` / `String(match …)`, and an
 * engine's `derived=match`), which used its own private arm splitter / parser and silently dropped
 * literal, boolean and alternation arms (`"a" | "b" :>` lost `"a"`). It now reads arms with the one
 * canonical reader; this test holds it there.
 *
 * Contract per generated list, over newline / comma / one-line / mixed spellings:
 *   - a `|`-led arm is refused in every spelling;
 *   - every spelling that compiles emits the SAME output, and every match dispatch tests exactly the
 *     written heads, in order; no arm split lost text (the coverage audit).
 *   Unlike the client differential, a spelling-dependent REFUSAL is tolerated here (fail closed):
 *   server text lowering refuses some shapes in one spelling only (a call in an arm body read from
 *   text, the regex-after-`->` lexing gap) — a refusal is never a wrong dispatch.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { compileScrml } from "../../src/api.js";

const LISTS = 160;
const SEED = 4697;

let TMP;
beforeAll(() => { TMP = mkdtempSync(join(tmpdir(), "arm-list-srv-diff-s469-")); });
afterAll(() => { if (TMP) rmSync(TMP, { recursive: true, force: true }); });

let seed = SEED * 7919 + 13;
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const pick = (a) => a[Math.floor(rnd() * a.length)];
const shuffle = (a) => { const b = a.slice(); for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; };

const LITS = ["1", "2", "3", "4", "5", "-3", "-7", "42", `"a"`, `"b"`, `"a|b"`, `"x:>"`, `"c,d"`, `"q\\"r"`, `"/"`, `"e | f"`, `'s'`, `"||"`];
const BODIES = [`"s"`, `"a :> b"`, `"x, y"`, `"p | q"`, `"c\\"q"`, `/a,b/.source`, `/"/.source`, `/'/.source`, `/a|1/.source`, `/\\//.source`,
  "`t, ${@k}`", "`x :> ${f(1, 2)}`", `f(1, 2)`, `f("a,b", /c,d/)`, `true ? "a" : "b"`, `String(3 | 4)`, `String(1 || 2)`, `"a" + "b"`,
  `String((/a,b/).test("a"))`, `f(2, 3) + "|"`, `"'"`, `'"'`, `"1 :> 2"`, `"," + ","`, `String(-1 | 2)`, `f("x", "1 | 2 :> 3")`];
// With the deprecated `->` arrow a body never STARTS with a regex: impl#1's SOURCE lexer reads
// `-> /re/` as `-`, `>`, division (g-impl1-regex-after-binary-operator-lexed-as-division-s469, its
// own lane), which re-spells the regex and makes the result depend on the line layout.
const ARROW_DASH_BODIES = BODIES.filter((b) => !b.startsWith("/"));
const VHEADS = [[".Tri"], [".Dot"], [".Circle(r)"], [".Square(s)"], [".Tri", ".Dot"], [".Circle", ".Square"], [".Square", ".Tri"]];
const TAG = (h) => '"' + h.replace(/^\./, "").replace(/\(.*$/, "") + '"';

const POS = {
  sret: (ty, s, a) => `\${\n  server function pick(k: ${ty}) {\n    return match k {\n${a("      ")}\n    }\n  }\n  function go() { @n = pick(${s}) }\n}\n<button onclick=go()>go</>`,
  sconst: (ty, s, a) => `\${\n  server function pick(k: ${ty}) {\n    const v = match k {\n${a("      ")}\n    }\n    return v\n  }\n  function go() { @n = pick(${s}) }\n}\n<button onclick=go()>go</>`,
  scall: (ty, s, a) => `\${\n  server function pick(k: ${ty}) {\n    return String(match k {\n${a("      ")}\n    })\n  }\n  function go() { @n = pick(${s}) }\n}\n<button onclick=go()>go</>`,
  slet: (ty, s, a) => `\${\n  server function pick(k: ${ty}) {\n    let v = ""\n    v = match k {\n${a("      ")}\n    }\n    return v\n  }\n  function go() { @n = pick(${s}) }\n}\n<button onclick=go()>go</>`,
  engine: (ty, s, a) => `<engine for=Lamp derived=match ${s} {\n${a("  ")}\n}>\n  <A/>\n  <B/>\n</>\n<p>x</>`,
};
const PRE = `type Shape:enum = { Circle(r: number), Square(s: number), Tri, Dot }\n\${ type Lamp:enum = { A, B } }\n<k>: number | string = 1\n<sh>: Shape = .Tri\n<n> = ""\n\${\n  function f(a, b) { return "f" }\n}\n`;

// r6 — the COVERAGE invariant, observed: every arm split any compiler stage performs records
// whether its pieces account for every non-whitespace character of its input
// (emit-control-flow.ts `splitMultiArmString`). A clean compile must have lost none.
let AUDIT = [];
function compile(src) {
  AUDIT = [];
  globalThis.__scrmlArmSplitAudit = AUDIT;
  const dir = join(TMP, "w");
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const fp = join(dir, "app.scrml");
  writeFileSync(fp, src);
  let r;
  try { r = compileScrml({ inputFiles: [fp], outputDir: join(dir, "dist"), write: false, log: () => {} }); }
  catch (e) { return { codes: ["THROW:" + String(e).slice(0, 80)], out: "", js: "" }; }
  const outs = {};
  let js = "";
  if (r.outputs instanceof Map) for (const [k, v] of r.outputs) { outs[k] = v; js += ((v && v.clientJs) || "") + ((v && v.serverJs) || ""); }
  const lost = AUDIT.filter((x) => !x.covered).map((x) => x.text);
  globalThis.__scrmlArmSplitAudit = undefined;
  return { codes: (r.errors || []).map((e) => e.code), out: JSON.stringify(outs), js, lost };
}

// A literal as the dispatch compares it.
const norm = (x) => {
  x = x.replace(/^-\s+/, "-");
  try { return /^["']/.test(x) ? JSON.stringify((0, eval)(x)) : String((0, eval)(x)); } catch { return "?" + x; }
};
function dispatchTests(js) {
  const g = {};
  const re = /(_scrml_(?:match|tag)_\d+) === ("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|-?\s*[\d.]+)/g;
  let m;
  while ((m = re.exec(js))) (g[m[1]] ??= []).push(norm(m[2]));
  return Object.values(g).map((a) => a.filter((x) => x !== '"object"').join(" ")).filter((x) => x);
}

// Generate the lists up front (the seed fixes them).
const CASES = [];
for (let it = 0; it < LISTS; it++) {
  const fam = rnd() < 0.6 ? "lit" : "var";
  const arms = [];
  if (fam === "lit") {
    const pool = shuffle(LITS); const na = 1 + Math.floor(rnd() * 5); let p = 0;
    for (let i = 0; i < na; i++) { const nh = rnd() < 0.4 ? 1 + Math.floor(rnd() * 3) : 1; const hs = pool.slice(p, p + nh); p += nh; if (hs.length) arms.push({ heads: hs, body: pick(BODIES) }); }
  } else {
    const vs = shuffle(VHEADS); const used = new Set(); const na = 1 + Math.floor(rnd() * 3);
    for (const h of vs) { if (arms.length >= na) break; const tags = h.map(TAG); if (tags.some((t) => used.has(t))) continue; tags.forEach((t) => used.add(t)); arms.push({ heads: h, body: pick(BODIES) }); }
  }
  const elseKw = pick(["else", "_"]);
  const arrow = rnd() < 0.15 ? "->" : ":>";
  const bodyOf = (b) => (arrow === "->" && b.startsWith("/") ? pick(ARROW_DASH_BODIES) : b);
  // S469 r5 — sometimes one arm is written with the `!{}` handler's legacy leading `|`
  // (`| 1 :> …`, `| .Tri :> …`): §18.2's `match` has none, so that list must be refused in EVERY
  // spelling and position (g-impl1-legacy-pipe-literal-match-arms-s469 — it used to run the wrong arm).
  // r6 — a `|`-led FIRST arm before two or more literal arms is generated on purpose (the shape
  // whose prefix the raw splitter used to drop, letting the wrong password in).
  const pr = rnd();
  const pipeArm = arms.length > 0 && pr < 0.15 ? (arms.length >= 3 && pr < 0.08 ? 0 : Math.floor(rnd() * arms.length)) : -1;
  const lines = [...arms.map((a, i) => `${i === pipeArm ? "| " : ""}${a.heads.join(" | ")} ${arrow} ${bodyOf(a.body)}`), `${elseKw} ${arrow} ${bodyOf(pick(BODIES))}`];
  const expected = arms.flatMap((a) => a.heads.map((h) => (fam === "lit" ? norm(h) : TAG(h)))).join(" ");
  const trailing = rnd() < 0.5;
  const mixMask = lines.map(() => rnd() < 0.5);
  const pos = pick(Object.keys(POS));
  // an engine `derived=match` maps to a STATE: literal heads (subject @k), `.A` / `.B` bodies
  if (pos === "engine") {
    if (fam !== "lit") continue;
    for (let li = 0; li < lines.length; li++) lines[li] = lines[li].replace(/(:>|->) [\s\S]*$/, (_m, ar) => `${ar} ${li % 2 ? ".B" : ".A"}`);
  }
  CASES.push({ fam, lines, expected, trailing, mixMask, pos, legacyPipe: pipeArm >= 0, pipeFirstBeforeTwo: pipeArm === 0 && fam === "lit" && arms.length >= 3 });
}

describe(`seeded SERVER / ENGINE arm-list differential (seed ${SEED}, ${LISTS} lists × 4 spellings)`, () => {
  test("the generator covers every server position and the engine `derived=`", () => {
    for (const p of Object.keys(POS)) expect({ p, n: CASES.filter((c) => c.pos === p).length > 5 }).toEqual({ p, n: true });
  });
  for (const [idx, c] of CASES.entries()) {
    test(`#${idx} [${c.fam} ${c.pos}] ${JSON.stringify(c.lines).slice(0, 120)}`, () => {
      const sp = {
        newline: (ind) => c.lines.map((l) => ind + l).join("\n"),
        comma: (ind) => c.lines.map((l, i) => ind + l + (i < c.lines.length - 1 || c.trailing ? "," : "")).join("\n"),
        oneline: (ind) => ind + c.lines.join(", ") + (c.trailing ? "," : ""),
        mixed: (ind) => c.lines.map((l, i) => ind + l + ((i < c.lines.length - 1 && c.mixMask[i]) ? "," : "")).join("\n"),
      };
      const [ty, subj] = c.fam === "lit" ? ["number | string", "@k"] : ["Shape", "@sh"];
      const res = {};
      for (const [sn, sf] of Object.entries(sp)) res[sn] = compile(PRE + POS[c.pos](ty, subj, sf));
      const refused = Object.fromEntries(Object.entries(res).map(([k, r]) => [k, r.codes.length > 0]));
      if (c.legacyPipe) {
        // a `|`-led arm: refused in every spelling, never compiled. (Usually E-PARSE-001; a compile the
        // typer already fails — the filed false E-VALUE-FUNCTION-STORED — stops before the lowering's
        // E-PARSE-001, which is still a refusal.)
        for (const [sn, r] of Object.entries(res)) expect({ sn, refused: r.codes.length > 0 }).toEqual({ sn, refused: true });
        return;
      }
      // every spelling that compiles: no lost text, the same output, the exact dispatch
      const clean = Object.entries(res).filter(([, r]) => r.codes.length === 0);
      for (const [sn, r] of clean) expect({ sn, lost: r.lost }).toEqual({ sn, lost: [] });
      for (const [sn, r] of clean) expect({ sn, same: r.out === clean[0][1].out }).toEqual({ sn, same: true });
      for (const [sn, r] of clean) {
        const seqs = dispatchTests(r.js);
        expect({ sn, n: seqs.length > 0 }).toEqual({ sn, n: true });
        for (const q of seqs) expect({ sn, q }).toEqual({ sn, q: c.expected });
      }
    });
  }
});
