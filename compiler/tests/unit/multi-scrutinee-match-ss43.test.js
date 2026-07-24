/**
 * §18.19 Multi-Scrutinee Match (Q-MATCH) — W2 build (ss43, S224).
 *
 * `match (e1, …, eN) { (p1, …, pN) :> body }` dispatches on the JOINT case of N
 * scrutinees. The parens are GRAMMAR delimiters, not a tuple value (no-tuple,
 * §59.7 / §14.11). This suite is the adversarial acceptance battery from the
 * dispatch brief: product exhaustiveness (E-TYPE-020 / E-TYPE-006 naming the
 * uncovered cell), arm arity (E-MATCH-SCRUTINEE-ARITY), nested-pattern
 * exclusion (E-SYNTAX-012, §18.11), `partial` opt-out, enum-subset narrowing,
 * N-ary, per-position + whole-product wildcards, the codegen desugar (nested
 * single-scrutinee dispatch with payload bindings live across the arm body),
 * the expression-position path, and ZERO single-scrutinee regression.
 */

import { describe, test, expect } from "bun:test";
import { fileURLToPath } from "node:url";
import { compileScrml } from "../../src/api.js";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";

const testDir = dirname(fileURLToPath(new URL(import.meta.url)));
let tmpCounter = 0;

function compileSource(scrmlSource, testName) {
  const tag = testName ?? `ms-${++tmpCounter}`;
  const tmpDir = resolve(testDir, `_tmp_ms43_${tag}`);
  const tmpInput = resolve(tmpDir, `${tag}.scrml`);
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(tmpInput, scrmlSource);
  try {
    const result = compileScrml({ inputFiles: [tmpInput], write: false, outputDir: resolve(tmpDir, "out") });
    let clientJs = null;
    for (const [fp, output] of result.outputs) {
      if (fp.includes(tag)) clientJs = output.clientJs ?? null;
    }
    return { errors: result.errors ?? [], warnings: result.warnings ?? [], clientJs };
  } finally {
    if (existsSync(tmpInput)) rmSync(tmpInput);
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true });
  }
}

// Cross-stream code lookup — W-/I- diagnostics partition into `warnings`, the
// rest into `errors`; a robust check scans both (memory: diagnostic-stream-partition).
const allDiag = (r) => [...(r.errors ?? []), ...(r.warnings ?? [])];
const hasCode = (r, code) => allDiag(r).some((d) => d.code === code);
const findCode = (r, code) => allDiag(r).find((d) => d.code === code);

// ---------------------------------------------------------------------------
// Exhaustiveness — product totality
// ---------------------------------------------------------------------------

describe("§18.19 — product exhaustiveness", () => {
  test("full cross-product with NO wildcard is exhaustive (no E-TYPE-020)", () => {
    const r = compileSource(`<program>
type Mode:enum = { InCode, InTemplate }
type Ev:enum = { Quote, Tick }
let m:Mode = .InCode
let e:Ev = .Quote
const r = match (m, e) {
  (.InCode, .Quote)     :> "a"
  (.InCode, .Tick)      :> "b"
  (.InTemplate, .Quote) :> "c"
  (.InTemplate, .Tick)  :> "d"
}
<p>{ r }</p>
</program>`, "exhaustive");
    expect(hasCode(r, "E-TYPE-020")).toBe(false);
    expect(hasCode(r, "E-TYPE-006")).toBe(false);
  });

  test("a missing (state × event) cell fires E-TYPE-020 naming the cell", () => {
    const r = compileSource(`<program>
type Mode:enum = { InCode, InTemplate }
type Ev:enum = { Quote, Tick }
let m:Mode = .InCode
let e:Ev = .Quote
const r = match (m, e) {
  (.InCode, .Quote)     :> "a"
  (.InCode, .Tick)      :> "b"
  (.InTemplate, .Quote) :> "c"
}
<p>{ r }</p>
</program>`, "missing-cell");
    expect(hasCode(r, "E-TYPE-020")).toBe(true);
    expect(findCode(r, "E-TYPE-020").message).toContain("(.InTemplate × .Tick)");
  });

  test("a union scrutinee position fires E-TYPE-006 when non-exhaustive", () => {
    const r = compileSource(`<program>
type Mode:enum = { InCode, InTemplate }
type Ev:enum = { Quote, Tick }
let m: Mode | not = .InCode
let e: Ev = .Quote
const r = match (m, e) {
  (.InCode, .Quote)     :> "a"
  (.InCode, .Tick)      :> "b"
  (.InTemplate, .Quote) :> "c"
  (.InTemplate, .Tick)  :> "d"
}
<p>{ r }</p>
</program>`, "union-pos");
    expect(hasCode(r, "E-TYPE-006")).toBe(true);
  });

  test("`partial match (…)` opts out of the product check", () => {
    const r = compileSource(`<program>
type Mode:enum = { InCode, InTemplate }
type Ev:enum = { Quote, Tick }
let m:Mode = .InCode
let e:Ev = .Quote
const r = partial match (m, e) {
  (.InCode, .Quote) :> "a"
}
<p>{ r }</p>
</program>`, "partial");
    expect(hasCode(r, "E-TYPE-020")).toBe(false);
    expect(hasCode(r, "E-TYPE-006")).toBe(false);
  });

  test("an enum-subset (oneOf) position narrows that position's variant set", () => {
    const r = compileSource(`<program>
type Mode:enum = { InCode, InTemplate, InString }
type Ev:enum = { Quote, Tick }
let m: Mode oneOf([.InCode, .InTemplate]) = .InCode
let e: Ev = .Quote
const r = match (m, e) {
  (.InCode, .Quote)     :> "a"
  (.InCode, .Tick)      :> "b"
  (.InTemplate, .Quote) :> "c"
  (.InTemplate, .Tick)  :> "d"
}
<p>{ r }</p>
</program>`, "subset");
    // .InString is excluded by the subset, so the 2×2 product is exhaustive.
    expect(hasCode(r, "E-TYPE-020")).toBe(false);
  });

  test("per-position `_` and a whole-product `| _` both count toward coverage", () => {
    const r = compileSource(`<program>
type Mode:enum = { InCode, InTemplate }
type Ev:enum = { Quote, Tick, Eof }
let m:Mode = .InCode
let e:Ev = .Quote
const r = match (m, e) {
  (.InCode, .Quote) :> "a"
  (_, .Eof)         :> "eof"
  | _               :> "x"
}
<p>{ r }</p>
</program>`, "wildcards");
    expect(hasCode(r, "E-TYPE-020")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Arm arity + nested-pattern exclusion
// ---------------------------------------------------------------------------

describe("§18.19 — arm arity + breadth-not-depth", () => {
  test("too FEW patterns under a 2-scrutinee head fires E-MATCH-SCRUTINEE-ARITY", () => {
    const r = compileSource(`<program>
type Mode:enum = { InCode, InTemplate }
type Ev:enum = { Quote, Tick }
let m:Mode = .InCode
let e:Ev = .Quote
const r = match (m, e) {
  (.InCode)             :> "a"
  (.InCode, .Tick)      :> "b"
  (.InTemplate, .Quote) :> "c"
  (.InTemplate, .Tick)  :> "d"
  | _                   :> "x"
}
<p>{ r }</p>
</program>`, "arity-few");
    expect(hasCode(r, "E-MATCH-SCRUTINEE-ARITY")).toBe(true);
  });

  test("too MANY patterns under a 2-scrutinee head fires E-MATCH-SCRUTINEE-ARITY", () => {
    const r = compileSource(`<program>
type Mode:enum = { InCode, InTemplate }
type Ev:enum = { Quote, Tick }
let m:Mode = .InCode
let e:Ev = .Quote
const r = match (m, e) {
  (.InCode, .Quote, .Quote) :> "a"
  | _                       :> "x"
}
<p>{ r }</p>
</program>`, "arity-many");
    expect(hasCode(r, "E-MATCH-SCRUTINEE-ARITY")).toBe(true);
  });

  test("a nested pattern in a position stays E-SYNTAX-012 (§18.11 preserved)", () => {
    const r = compileSource(`<program>
type Inner:enum = { B }
type Mode:enum = { A }
type Ev:enum = { C }
let m:Mode = .A
let e:Ev = .C
const r = match (m, e) {
  (.A(.B(x)), .C) :> "y"
  | _             :> "z"
}
<p>{ r }</p>
</program>`, "nested");
    expect(hasCode(r, "E-SYNTAX-012")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Codegen desugar + runtime
// ---------------------------------------------------------------------------

describe("§18.19 — codegen desugar (nested single-scrutinee dispatch)", () => {
  test("desugars to per-scrutinee temps + conjunction conditions; payload binds live in body", () => {
    const r = compileSource(`<program>
type Mode:enum = { InCode, InTemplate }
type Ev:enum = { Quote(q: string), Tick, Eof }
let m:Mode = .InCode
let e:Ev = Ev.Quote("hi")
const out = match (m, e) {
  (.InCode, .Quote(q))     :> q
  (.InCode, .Tick)         :> "tmpl"
  (.InTemplate, .Quote(s)) :> s
  (.InTemplate, .Tick)     :> "tb"
  (_, .Eof)                :> "eof"
}
<p>{ out }</p>
</program>`, "desugar");
    expect(r.clientJs).toBeTruthy();
    // Each scrutinee evaluated once into a temp + tag-normalized.
    expect(r.clientJs).toMatch(/const _scrml_scrut_\d+ = m;/);
    expect(r.clientJs).toMatch(/const _scrml_scrut_\d+ = e;/);
    // Conjunction condition over the per-scrutinee tags.
    expect(r.clientJs).toMatch(/=== "InCode" && \S+ === "Quote"/);
    // Payload binding from position 2 destructured into the arm body.
    expect(r.clientJs).toMatch(/const q = _scrml_scrut_\d+\.data\.q;/);
    // Per-position `_` arm tests only the non-wildcard position.
    expect(r.clientJs).toMatch(/=== "Eof"\) \{ return "eof"; \}/);
    // No tuple accessor leaks.
    expect(r.clientJs).not.toMatch(/\.0\b/);
    expect(r.clientJs).not.toMatch(/\bundefined\b/);
  });

  test("the §18.19 `step` worked example runs correctly (payload + wildcard)", () => {
    const r = compileSource(`<program>
type Mode:enum = { InCode, InTemplate }
type Ev:enum = { Quote(q: string), Tick, Eof }
let m:Mode = .InCode
let e:Ev = Ev.Quote("hi")
const out = match (m, e) {
  (.InCode, .Quote(q))     :> q
  (.InCode, .Tick)         :> "tmpl"
  (.InTemplate, .Quote(s)) :> s
  (.InTemplate, .Tick)     :> "tb"
  (_, .Eof)                :> "eof"
}
<p>{ out }</p>
</program>`, "runtime");
    // Extract the desugared IIFE and run it with concrete tagged inputs.
    const mm = r.clientJs.match(/= (\(function\(\) \{[\s\S]*?\}\)\(\));/);
    expect(mm).toBeTruthy();
    const iife = mm[1];
    const run = new Function("m", "e", `return ${iife}`);
    const Q = (q) => ({ variant: "Quote", data: { q } });
    expect(run("InCode", Q("hi"))).toBe("hi");          // payload bound
    expect(run("InCode", "Tick")).toBe("tmpl");
    expect(run("InTemplate", Q("yo"))).toBe("yo");
    expect(run("InTemplate", "Tick")).toBe("tb");
    expect(run("InCode", "Eof")).toBe("eof");           // (_, .Eof)
    expect(run("InTemplate", "Eof")).toBe("eof");
  });

  test("N = 3 works (`match (a, b, c)`)", () => {
    const r = compileSource(`<program>
type A:enum = { A1, A2 }
type B:enum = { B1, B2 }
type C:enum = { C1, C2 }
let a:A = .A1
let b:B = .B1
let c:C = .C1
const r = match (a, b, c) {
  (.A1, .B1, .C1) :> "x"
  (_, _, .C2)     :> "z"
  | _             :> "d"
}
<p>{ r }</p>
</program>`, "n3");
    expect(hasCode(r, "E-TYPE-020")).toBe(false);
    expect(hasCode(r, "E-MATCH-SCRUTINEE-ARITY")).toBe(false);
    expect(r.clientJs).toMatch(/=== "A1" && \S+ === "B1" && \S+ === "C1"/);
  });
});

// ---------------------------------------------------------------------------
// Expression-position + regression
// ---------------------------------------------------------------------------

describe("§18.19 — expression-position + no-regression", () => {
  test("a multi-scrutinee match nested in a call argument lowers correctly", () => {
    const r = compileSource(`<program>
type Mode:enum = { InCode, InTemplate }
type Ev:enum = { Quote, Tick }
let m:Mode = .InCode
let e:Ev = .Quote
function id(s: string): string { return s }
const r = id(match (m, e) {
  (.InCode, .Quote)     :> "a"
  (.InCode, .Tick)      :> "b"
  (.InTemplate, .Quote) :> "c"
  (.InTemplate, .Tick)  :> "d"
})
<p>{ r }</p>
</program>`, "expr-pos");
    expect(r.clientJs).toMatch(/=== "InCode" && \S+ === "Quote"/);
    // The pre-fix silent stub must be gone.
    expect(r.clientJs).not.toMatch(/no lowerable arms/);
    expect(r.clientJs).not.toMatch(/\bundefined\b/);
  });

  test("`match (e)` with NO depth-1 comma stays single-scrutinee (zero regression)", () => {
    const r = compileSource(`<program>
type Mode:enum = { InCode, InTemplate }
let m:Mode = .InCode
const r = match (m) {
  .InCode     :> "a"
  .InTemplate :> "b"
}
<p>{ r }</p>
</program>`, "single-paren");
    expect(hasCode(r, "E-TYPE-020")).toBe(false);
    expect(hasCode(r, "E-MATCH-SCRUTINEE-ARITY")).toBe(false);
    // Single-scrutinee emits the classic single-temp dispatch, not the
    // multi-scrutinee per-position temps.
    expect(r.clientJs).toMatch(/const _scrml_match_\d+ = m;/);
    expect(r.clientJs).not.toMatch(/_scrml_scrut_/);
  });
});
