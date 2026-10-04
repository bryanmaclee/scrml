// effects-shadow.test.js — s452-effect-summary (dpa-066, RATIFIED S452 item 3),
// migration step M0: THE SHADOW DIFFERENTIAL.
//
// analyze.scrml computes ONE effect summary per callable (effects.scrml closes
// it over the call graph). Before any rule reads it, each per-rule walker it
// replaces must give the SAME answer — the same placement, and the same first
// chain (callable labels down to the same site) — over every slice program
// and every conformance-counter case. `effectsShadow(files, entry)` returns
// one line per disagreement; this test requires none, except the documented
// G7 hole (DD G7: "yields a value" was not transitive), where the summary is
// deliberately right and the walker wrong.

import { describe, test, expect } from "bun:test";
import { loadM2 } from "../slice-m2/harness.js";
import { PROGRAMS as M2_PROGRAMS, readSlice } from "../slice-m2/lowered.js";
import { PROGRAMS as M4_PROGRAMS, programFiles } from "./harness.js";
import { loadCases } from "../../../conformance/run.ts";
import { twinOf, DEFAULT_CASES_DIR } from "../../../scripts/bootstrap-conformance.ts";

const { mods } = loadM2();

function parse(files) {
  let next = 0;
  return files.map((f) => {
    const r = mods.parse.parseFile(f.path, f.src, next);
    next = r.nextId;
    return r.ast;
  });
}

function shadow(files) {
  return mods.analyze.effectsShadow(parse(files), files[files.length - 1].path);
}

// The slice programs: M2's (with its fixtures) and M4's. (Every program the
// slice TESTS build — the negative variants, the inline sources — is
// shadowed too, by the SCRML_BOOT_DIAG_LOG hook: slice-m1/harness.js.)
function slicePrograms() {
  const out = [];
  for (const [name, fs] of Object.entries(M2_PROGRAMS)) {
    out.push({ label: `m2:${name}`, files: fs.map((f) => ({ path: f.path, src: readSlice(f.rel) })) });
  }
  for (const name of Object.keys(M4_PROGRAMS)) out.push({ label: `m4:${name}`, files: programFiles(name) });
  return out;
}

// Every conformance-counter case: its source as written, and its §66 twin
// when the counter grades one (the counter's own input set).
function counterInputs() {
  const out = [];
  for (const c of loadCases(DEFAULT_CASES_DIR)) {
    const aux = (a) => Object.keys(a).sort().map((p) => ({ path: p, src: a[p] }));
    out.push({ label: c.relDir, files: [...aux(c.auxFiles), { path: "case.scrml", src: c.source }] });
    let tw = null;
    try {
      tw = twinOf(c);
    } catch {
      tw = null;
    }
    if (tw && tw.candidate && tw.twinned) out.push({ label: `${c.relDir} (twin)`, files: [...aux(tw.auxFiles), { path: "case.scrml", src: tw.source }] });
  }
  return out;
}

function disagreements(inputs) {
  const bad = [];
  let ran = 0;
  for (const p of inputs) {
    let lines;
    try {
      lines = shadow(p.files);
    } catch (e) {
      lines = [`threw: ${String(e?.message ?? e).split("\n")[0]}`];
    }
    ran++;
    for (const l of lines) bad.push(`${p.label}: ${l}`);
  }
  return { bad, ran };
}

describe("dpa-066 M0 — every walker equals the summary's query", () => {
  test("over every slice program", () => {
    const inputs = slicePrograms();
    const { bad, ran } = disagreements(inputs);
    expect(ran).toBe(9);
    expect(bad).toEqual([]);
  });

  test("over every conformance-counter case (as written and as its §66 twin)", () => {
    const inputs = counterInputs();
    const { bad, ran } = disagreements(inputs);
    expect(ran).toBeGreaterThan(1200);
    expect(bad).toEqual([]);
  }, 300000);
});

// G7 (dpa-066 Phase 2, measured): "yields a value" is not transitive in the
// walker — `return nothing()` launders a call that yields nothing. The summary
// closes it; until M3 wires it, the shadow shows exactly that disagreement.
describe("dpa-066 G7 — the one known disagreement", () => {
  const prog = (wrapDecl) => [{
    path: "app.scrml",
    src: [
      "<program>",
      "    let <n:int=0/>",
      "    let <log:string=\"init\"/>",
      "    ${",
      "        type LoadError:enum = { Missing }",
      "        function nothing() { @n = 1 }",
      `        ${wrapDecl}`,
      "        function load(k: string)! LoadError {",
      "            if (k == \"x\") fail LoadError.Missing",
      "            return k",
      "        }",
      "        function go() {",
      "            const r = load(\"x\") !{ _ :> g() }",
      "            @log = r",
      "        }",
      "    }",
      "    <button onclick=go()>go</button>",
      "</program>",
    ].join("\n"),
  }];

  test("`function g() { return nothing() }` — the walker says it yields, the summary says it does not", () => {
    expect(shadow(prog("function g() { return nothing() }"))).toEqual([
      "W9 yields g(): walker {true} summary {false}",
    ]);
  });

  test("`function g() -> string { return nothing() }` — the same through a declared type", () => {
    expect(shadow(prog("function g() -> string { return nothing() }"))).toEqual([
      "W9 yields g(): walker {true} summary {false}",
    ]);
  });
});

// Found by the M0 run over slice-m4/effect.test.js: the clock follows CALLS
// only (as the walker did) — a function handed on as a value (refused in the
// bootstrap) does not make the holder read the clock.
describe("dpa-066 M0 — the clock dimension's edges", () => {
  test("a function VALUE of a clock reader is not a clock read", () => {
    const src = [
      "<program>",
      "    let <query:string=\"\"/>",
      "    function ping() {",
      "        const t = Date" + ".now()",
      "    }",
      "    function viaLocal() {",
      "        const g = ping",
      "        g()",
      "    }",
      "    function direct() { ping() }",
      "    <effect deps=[@query]>${ viaLocal() }</>",
      "</program>",
    ].join("\n");
    expect(shadow([{ path: "t.scrml", src }])).toEqual([]);
  });
});
