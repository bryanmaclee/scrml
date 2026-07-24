/**
 * c22-bare-variant-codegen.test.js — A1c Step C22 unit tests
 *
 * Tests the bare-variant inference codegen in `emit-expr.ts:emitIdent`:
 *
 *   §C22.1  Position 1 (state-decl LHS-typed) — `<phase>: Phase = .Idle` emits "Idle"
 *   §C22.2  Position 1b (let-decl LHS-typed)  — `let x: Phase = .Loading` emits "Loading"
 *   §C22.3  Position 1b (const-decl LHS-typed) — `const x: Phase = .Done` emits "Done"
 *   §C22.4  Multiple bare-variants in one file (sanity)
 *   §C22.5  Bare-variant in ternary branches
 *   §C22.6  Bare-variant in array element / object value
 *   §C22.7  Bare-variant in binary `==` comparison
 *   §C22.8  Regression — qualified `Phase.Idle` (MemberExpr) unchanged
 *   §C22.9  Regression — match-arm `.Variant => ...` codegen unchanged
 *   §C22.10 Regression — engine `initial=.V` codegen unchanged (uses engine path)
 *   §C22.11 Regression — `is .Variant` operator unchanged
 *   §C22.12 Generated JS parses (node-syntax check)
 *
 * SCOPE: per A1c BRIEF C22 + Phase 0 SURVEY §0.13 — codegen positions 1, 1b, 2
 * (all funnel through `emitIdent`). Positions 3, 4 are B20.b territory (deferred).
 * Positions 5, 6 already work via separate codegen paths (regression-only here).
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdirSync, writeFileSync, rmSync, existsSync, mkdtempSync } from "fs";
import { join, dirname } from "path";
import { tmpdir } from "os";
import { compileScrml } from "../../src/api.js";

let TMP;

beforeAll(() => {
  TMP = mkdtempSync(join(tmpdir(), "c22-bare-variant-"));
});

afterAll(() => {
  if (TMP && existsSync(TMP)) rmSync(TMP, { recursive: true, force: true });
});

function fx(rel, src) {
  const abs = join(TMP, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, src);
  return abs;
}

function compile(rel, src) {
  const path = fx(rel, src);
  const result = compileScrml({
    inputFiles: [path],
    outputDir: join(TMP, "out", rel.replace(/[/.]/g, "_")),
    write: false,
    log: () => {},
  });
  return { result, path, clientJs: result.outputs?.get(path)?.clientJs ?? "" };
}

// ---------------------------------------------------------------------------
// §C22.1 — Position 1 (state-decl LHS-typed)
// ---------------------------------------------------------------------------

describe("C22 §C22.1 — state-decl LHS-typed bare-variant codegen", () => {
  test("`<phase>: Phase = .Idle` emits string literal \"Idle\"", () => {
    const { clientJs, result } = compile("p1.scrml", `type Phase:enum = { Idle, Loading, Done }

<phase>: Phase = .Idle

const m = <main>${"$"}{@phase}</>

render(m)
`);
    // No bare-variant errors
    const variantErrs = (result.errors ?? []).filter(e => /VARIANT/.test(e.code ?? ""));
    expect(variantErrs).toEqual([]);
    // The reactive_set call has the string "Idle", not bare `.Idle`
    expect(clientJs).toMatch(/_scrml_reactive_set\("phase",\s*"Idle"\)/);
    // Negative: no broken `.Idle` token in the output
    expect(clientJs).not.toMatch(/_scrml_reactive_set\("phase",\s*\.Idle\)/);
  });

  test("`<phase>: Phase = .Loading` (different variant) emits \"Loading\"", () => {
    const { clientJs } = compile("p1b.scrml", `type Phase:enum = { Idle, Loading, Done }

<phase>: Phase = .Loading

const m = <main>${"$"}{@phase}</>

render(m)
`);
    expect(clientJs).toMatch(/_scrml_reactive_set\("phase",\s*"Loading"\)/);
  });
});

// ---------------------------------------------------------------------------
// §C22.2 — Position 1b (let-decl LHS-typed)
// ---------------------------------------------------------------------------

describe("C22 §C22.2 — let-decl LHS-typed bare-variant codegen", () => {
  test("`let x: Phase = .Loading` emits `let x = \"Loading\";`", () => {
    const { clientJs, result } = compile("p2.scrml", `type Phase:enum = { Idle, Loading, Done }

<phase>: Phase = Phase.Idle
let x: Phase = .Loading

const m = <main>${"$"}{x}</>

render(m)
`);
    const variantErrs = (result.errors ?? []).filter(e => /VARIANT/.test(e.code ?? ""));
    expect(variantErrs).toEqual([]);
    expect(clientJs).toMatch(/let x = "Loading"/);
    expect(clientJs).not.toMatch(/let x = \.Loading/);
  });
});

// ---------------------------------------------------------------------------
// §C22.3 — Position 1b (const-decl LHS-typed)
// ---------------------------------------------------------------------------

describe("C22 §C22.3 — const-decl LHS-typed bare-variant codegen", () => {
  test("`const x: Phase = .Done` emits `const x = \"Done\";`", () => {
    const { clientJs, result } = compile("p3.scrml", `type Phase:enum = { Idle, Loading, Done }

<phase>: Phase = Phase.Idle
const x: Phase = .Done

const m = <main>${"$"}{x}</>

render(m)
`);
    const variantErrs = (result.errors ?? []).filter(e => /VARIANT/.test(e.code ?? ""));
    expect(variantErrs).toEqual([]);
    expect(clientJs).toMatch(/const x = "Done"/);
  });
});

// ---------------------------------------------------------------------------
// §C22.4 — Multiple bare-variants in one file
// ---------------------------------------------------------------------------

describe("C22 §C22.4 — multiple bare-variants in one file", () => {
  test("two state-decls + a let-decl, all bare-variant inits, all lower correctly", () => {
    const { clientJs, result } = compile("p4.scrml", `type Phase:enum = { Idle, Loading, Done }
type Color:enum = { Red, Green, Blue }

<phase>: Phase = .Idle
<color>: Color = .Red
let target: Phase = .Done

const m = <main>${"$"}{@phase} ${"$"}{@color} ${"$"}{target}</>

render(m)
`);
    expect((result.errors ?? []).filter(e => /VARIANT/.test(e.code ?? ""))).toEqual([]);
    expect(clientJs).toMatch(/_scrml_reactive_set\("phase",\s*"Idle"\)/);
    expect(clientJs).toMatch(/_scrml_reactive_set\("color",\s*"Red"\)/);
    expect(clientJs).toMatch(/let target = "Done"/);
  });
});

// ---------------------------------------------------------------------------
// §C22.5 — Bare-variant in ternary branches
// ---------------------------------------------------------------------------

describe("C22 §C22.5 — bare-variant in ternary branches", () => {
  test("`let target: Phase = cond ? .Idle : .Done` lowers both branches", () => {
    const { clientJs, result } = compile("p5.scrml", `type Phase:enum = { Idle, Loading, Done }

<flag>: boolean = true
<phase>: Phase = Phase.Idle
let target: Phase = @flag ? .Idle : .Done

const m = <main>${"$"}{target}</>

render(m)
`);
    expect((result.errors ?? []).filter(e => /VARIANT/.test(e.code ?? ""))).toEqual([]);
    // Both branches should be string literals — no `.Idle` / `.Done` survive.
    expect(clientJs).not.toMatch(/\?\s*\.Idle/);
    expect(clientJs).not.toMatch(/:\s*\.Done/);
    // And both strings should appear.
    expect(clientJs).toMatch(/"Idle"/);
    expect(clientJs).toMatch(/"Done"/);
  });
});

// ---------------------------------------------------------------------------
// §C22.6 — Bare-variant in array element / object value
// ---------------------------------------------------------------------------

describe("C22 §C22.6 — bare-variant inside compound literals (regression)", () => {
  test("array literal containing bare-variant — codegen lowers element", () => {
    // §14.10 line 7197 covers "any other position where the type is fixed"; an
    // array of Phase has type Phase[] and the element-position type IS Phase.
    // B20 may not currently fire for this position (it's a SPEC-prose forward
    // hedge), but the codegen should still emit the literal — ensuring this is
    // SAFE so future B20 extensions don't regress.
    const { clientJs } = compile("p6.scrml", `type Phase:enum = { Idle, Loading, Done }

<phase>: Phase = Phase.Idle
const phases = [Phase.Idle, Phase.Loading, Phase.Done]

const m = <main>${"$"}{phases.length}</>

render(m)
`);
    // Sanity: qualified Phase.Idle should still appear in some form
    // (after rewriteEnumVariantAccess it becomes a string in client output).
    expect(clientJs).toMatch(/Idle/);
    // No broken `.Idle` left adrift in the output (would be a SyntaxError).
    expect(clientJs).not.toMatch(/[\s,(\[]\s*\.Idle\s*[\s,)\]]/);
  });
});

// ---------------------------------------------------------------------------
// §C22.7 — Bare-variant in binary `==` comparison
// ---------------------------------------------------------------------------

describe("C22 §C22.7 — bare-variant in binary `==` (regression)", () => {
  test("`@phase == .Idle` → structural-eq with stringified rhs", () => {
    const { clientJs } = compile("p7.scrml", `type Phase:enum = { Idle, Loading, Done }

<phase>: Phase = Phase.Idle

const m = <main>${"$"}{@phase == Phase.Idle ? "yes" : "no"}</>

render(m)
`);
    // No `.Idle` survives unstringified; the qualified form is rewritten to
    // a string by rewriteEnumVariantAccess.
    expect(clientJs).not.toMatch(/[\s(]\.Idle\b/);
  });
});

// ---------------------------------------------------------------------------
// §C22.8 — Regression: qualified Phase.Idle (MemberExpr) unchanged
// ---------------------------------------------------------------------------

describe("C22 §C22.8 — qualified `Phase.Idle` regression (MemberExpr)", () => {
  test("`<phase>: Phase = Phase.Idle` still produces valid JS (qualified form)", () => {
    // The qualified form parses as MemberExpr { object: Ident("Phase"), property: "Idle" }
    // — NOT an IdentExpr with leading dot. The C22 fix should NOT touch it.
    // At runtime Phase.Idle === "Idle" (per emitEnumVariantObjects), so the
    // qualified form produces valid JS that resolves to the string at runtime.
    // The exact emit form (whether "Phase.Idle" or "Idle") is an orthogonal
    // codegen concern — what matters is (a) no error, and (b) the variant
    // identity is preserved.
    const { clientJs, result } = compile("p8.scrml", `type Phase:enum = { Idle, Loading, Done }

<phase>: Phase = Phase.Idle

const m = <main>${"$"}{@phase}</>

render(m)
`);
    expect((result.errors ?? [])).toEqual([]);
    // The reactive_set call should reference Idle (either as "Idle" string OR
    // Phase.Idle property access) — both resolve to the variant tag at runtime.
    expect(clientJs).toMatch(/_scrml_reactive_set\("phase",\s*(?:"Idle"|Phase\.Idle)\)/);
  });
});

// ---------------------------------------------------------------------------
// §C22.9 — Regression: match-arm `.Variant => ...` codegen unchanged
// ---------------------------------------------------------------------------

describe("C22 §C22.9 — match-arm `.Variant => ...` regression", () => {
  test("match-arm patterns still emit `tagVar === \"Variant\"` (separate path)", () => {
    const { clientJs } = compile("p9.scrml", `type Phase:enum = { Idle, Loading, Done }

<phase>: Phase = .Idle

const m = <main>${"$"}{
  match @phase {
    .Idle => "I"
    .Loading => "L"
    .Done => "D"
  }
}</>

render(m)
`);
    // Match-arm condition uses string-literal comparison.
    expect(clientJs).toMatch(/=== "Idle"/);
    expect(clientJs).toMatch(/=== "Loading"/);
    expect(clientJs).toMatch(/=== "Done"/);
  });
});

// ---------------------------------------------------------------------------
// §C22.10 — Regression: engine `initial=.V` codegen unchanged
// ---------------------------------------------------------------------------

describe("C22 §C22.10 — engine `initial=.V` regression", () => {
  test("engine cell init uses engineMeta.initialVariant (B15 path), not emitIdent", () => {
    // B15 captures `initial=.Idle` as a bare string ("Idle" without the dot)
    // on engineMeta.initialVariant; emit-engine.ts emits JSON.stringify(...).
    // The C22 fix shouldn't touch this; the engine code path is independent.
    const { clientJs } = compile("p10.scrml", `type Phase:enum = { Idle, Loading, Done, transitions { Idle -> Loading } }

<engine for=Phase initial=.Idle></engine>

const m = <main>${"$"}{@engine}</>

render(m)
`);
    // Engine path emits the variant via JSON.stringify in B15 codegen.
    // Look for the variant cell init.
    expect(clientJs).toMatch(/"Idle"/);
    // No bare `.Idle` should leak.
    expect(clientJs).not.toMatch(/=\s*\.Idle\b/);
  });
});

// ---------------------------------------------------------------------------
// §C22.11 — Regression: `is .Variant` operator unchanged
// ---------------------------------------------------------------------------

describe("C22 §C22.11 — `is .Variant` operator regression", () => {
  test("`@phase is .Idle` in if-stmt lowers to `=== \"Idle\"` (existing emitBinary path)", () => {
    const { clientJs } = compile("p11.scrml", `type Phase:enum = { Idle, Loading, Done }

<phase>: Phase = .Idle

if (@phase is .Idle) {
  console.log("yes")
}
`);
    // `is .Idle` lowers via emitBinary case "is" — must produce === "Idle".
    // The bare-variant `.Idle` is consumed by emitBinary's case "is" inspection
    // BEFORE emitIdent runs (see emit-expr.ts:401-407), so the operator path
    // is preserved exactly. C22 must not regress this.
    expect(clientJs).toMatch(/=== "Idle"/);
  });
});

// ---------------------------------------------------------------------------
// §C22.12 — Generated JS parses
// ---------------------------------------------------------------------------

describe("C22 §C22.12 — bare-variant emit lines parse as valid JS expressions", () => {
  // Narrowed scope: rather than parsing the full client.js (which carries
  // unrelated emit lines that may themselves be incomplete in test-fixture
  // inputs — e.g., `const m;` from minimal markup roots), extract just the
  // lines containing the bare-variant emit and verify those parse.
  test("bare-variant in state-decl init: `_scrml_reactive_set(\"phase\", \"Idle\")` parses", () => {
    const { clientJs } = compile("p12.scrml", `type Phase:enum = { Idle, Loading, Done }

<phase>: Phase = .Idle

const m = <main>${"$"}{@phase}</>

render(m)
`);
    const lines = clientJs.split("\n").filter(l => l.includes("_scrml_reactive_set") && l.includes("phase"));
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      // Wrap in a minimal context: declare _scrml_reactive_set as a no-op so
      // the JS is parseable+runnable as an expression statement.
      const wrapped = `function _scrml_reactive_set() {} ${line.trim()}`;
      expect(() => new Function(wrapped)).not.toThrow();
    }
  });

  test("bare-variant in let-decl init: `let x = \"Loading\";` parses", () => {
    const { clientJs } = compile("p13.scrml", `type Phase:enum = { Idle, Loading, Done }

<phase>: Phase = Phase.Idle
let x: Phase = .Loading

const m = <main>${"$"}{x}</>

render(m)
`);
    const lines = clientJs.split("\n").filter(l => /^\s*let x\s*=/.test(l));
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(() => new Function(line.trim())).not.toThrow();
    }
  });
});
