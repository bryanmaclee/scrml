/**
 * g-match-lowering-arm-drop (S234) — `match` dropped arms in three shapes.
 *
 * The self-host-v2 lexer dogfood surfaced a family of arm-drop bugs (F2/F3/F6 in
 * compiler/self-host-v2/progress.md). These are LIVE-compiler bugs affecting all
 * scrml `match` users, not just self-host. All three shapes are spec-sanctioned:
 *   - F2 — number-literal arms (`61 :> "eq"`)           — SPEC §18.16.1
 *   - F3 — a literal in a multi-scrutinee product slot   — SPEC §18.19 × §18.16
 *          (`(.LParen, 0) :> …`) SILENTLY dropped — soundness
 *   - F6 — `|`-alternation over string literals           — SPEC §18.16 + §18
 *          (`"const" | "let" :>`) and payload-discard variants
 *          (`.Ident(_) | .Num(_) :>`)
 *
 * Roots fixed:
 *   - ast-builder.js matchPositionIsPatternShaped — NUMBER / bool / `-N` product slots (F3)
 *   - ast-builder.js collectExpr S27 boundary — NUMBER / bool / `-N` / string-alt arm starts (F2/F6)
 *   - emit-control-flow.ts parseMatchArm / armCondition / splitMultiArmString — literal + alt lowering
 *   - emit-control-flow.ts emitMultiScrutineeMatch — fail-CLOSED (E-CG-003) on any unrecognized arm
 */

import { describe, test, expect } from "bun:test";
import { compileScrml } from "../../src/api.js";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";

const testDir = dirname(new URL(import.meta.url).pathname);
let tmpCounter = 0;

function compileSource(scrmlSource, testName) {
  const tag = testName ?? `mad-${++tmpCounter}`;
  const tmpDir = resolve(testDir, `_tmp_mad_${tag}`);
  const tmpInput = resolve(tmpDir, `${tag}.scrml`);
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(tmpInput, scrmlSource);
  try {
    const result = compileScrml({ inputFiles: [tmpInput], write: false, outputDir: resolve(tmpDir, "out"), validateEmit: true });
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

// A hard error is anything on the error stream carrying a code (W-/I- partition
// into warnings). E-CODEGEN-INVALID-LOGIC is the generic "emitted unparseable JS"
// backstop that every one of these shapes previously tripped.
const hardErrors = (r) => (r.errors ?? []).filter((e) => e && e.code !== undefined);
const hasCode = (r, code) => [...(r.errors ?? []), ...(r.warnings ?? [])].some((d) => d.code === code);

// ---------------------------------------------------------------------------
// F2 — number-literal arms (SPEC §18.16.1)
// ---------------------------------------------------------------------------

describe("F2 — number-literal match arms lower correctly", () => {
  test("int-literal arms emit `=== <int>` per arm (no invalid JS)", () => {
    const r = compileSource(`<program>
fn classify(n: int) -> string {
  return match n {
    61 :> "eq"
    40 :> "lp"
    _  :> "other"
  }
}
<p>{ classify(61) }</p>
</program>`, "f2int");
    expect(hardErrors(r)).toEqual([]);
    expect(r.clientJs).toContain("=== 61");
    expect(r.clientJs).toContain("=== 40");
    // both non-wildcard arms survive — neither dropped into a bare `else`.
    expect(r.clientJs).not.toContain("else return \"other\";\n    else");
  });

  test("negative + decimal int arms lower (newline-separated, §18.2)", () => {
    const r = compileSource(`<program>
fn score(n: int) -> int {
  return match n {
    0    :> 100
    -1   :> 42
    7    :> n
    _    :> 0
  }
}
<p>{ score(0) }</p>
</program>`, "f2neg");
    expect(hardErrors(r)).toEqual([]);
    expect(r.clientJs).toContain("=== 0");
    expect(r.clientJs).toContain("=== -1");
    expect(r.clientJs).toContain("=== 7");
  });

  test("boolean-literal arms lower (§18.16)", () => {
    const r = compileSource(`<program>
fn label(b: bool) -> string {
  return match b {
    true  :> "yes"
    false :> "no"
  }
}
<p>{ label(true) }</p>
</program>`, "f2bool");
    expect(hardErrors(r)).toEqual([]);
    expect(r.clientJs).toContain("=== true");
    expect(r.clientJs).toContain("=== false");
  });
});

// ---------------------------------------------------------------------------
// F3 — product-match literal-in-tuple-slot (SILENT soundness drop) — PRIORITY
// ---------------------------------------------------------------------------

describe("F3 — multi-scrutinee product-literal-slot arm EMITS (not dropped)", () => {
  test("`(.LParen, 0)` arm emits its variant + literal checks", () => {
    const r = compileSource(`<program>
type Kind:enum = { LParen, Num, Other }
fn pick(a: Kind, b: int) -> string {
  return match (a, b) {
    (.LParen, 0) :> "lp0"
    (.Num, _)    :> "num"
    (_, _)       :> "other"
  }
}
<p>{ pick(.LParen, 0) }</p>
</program>`, "f3lit");
    expect(hardErrors(r)).toEqual([]);
    // The previously-DROPPED arm must be present: BOTH the `.LParen` tag check
    // AND the `=== 0` literal-slot check.
    expect(r.clientJs).toContain(`=== "LParen"`);
    expect(r.clientJs).toContain("=== 0");
    // Its result string must reach the output (arm not silently skipped).
    expect(r.clientJs).toContain(`"lp0"`);
  });

  test("string literal in a product slot still works (must-not-break)", () => {
    const r = compileSource(`<program>
type Kind:enum = { Op, Word }
fn pick(k: Kind, s: string) -> string {
  return match (k, s) {
    (.Op, "plus") :> "op-plus"
    (_, _)        :> "other"
  }
}
<p>{ pick(.Op, "plus") }</p>
</program>`, "f3str");
    expect(hardErrors(r)).toEqual([]);
    expect(r.clientJs).toContain(`=== "plus"`);
    expect(r.clientJs).toContain(`"op-plus"`);
  });
});

// ---------------------------------------------------------------------------
// F6 — `|`-alternation arms (string literals + payload-discard variants)
// ---------------------------------------------------------------------------

describe("F6 — `|`-alternation arms lower to an OR-chain", () => {
  test("string-literal alternation `\"const\" | \"let\"` emits `=== ... || === ...`", () => {
    const r = compileSource(`<program>
fn isKw(s: string) -> bool {
  return match s {
    "const" | "let" :> true
    _               :> false
  }
}
<p>{ isKw("let") }</p>
</program>`, "f6str");
    expect(hardErrors(r)).toEqual([]);
    expect(r.clientJs).toContain(`=== "const"`);
    expect(r.clientJs).toContain(`=== "let"`);
    expect(r.clientJs).toContain("||");
  });

  test("string-alt MIXED with single-string arms (adversarial)", () => {
    const r = compileSource(`<program>
fn kw(s: string) -> int {
  return match s {
    "if"                    :> 1
    "const" | "let" | "var" :> 2
    "while"                 :> 3
    _                       :> 0
  }
}
<p>{ kw("var") }</p>
</program>`, "f6mix");
    expect(hardErrors(r)).toEqual([]);
    // the single arm before the alt keeps its own result (not over-collected).
    expect(r.clientJs).toContain(`=== "if"`);
    expect(r.clientJs).toContain(`=== "var"`);
    expect(r.clientJs).toContain(`=== "while"`);
  });

  test("payload-DISCARD variant alternation `.Ident(_) | .Num(_)` emits tag OR-chain", () => {
    const r = compileSource(`<program>
type Tok:enum = { Ident, Num, Other }
fn regexOk(t: Tok) -> bool {
  return match t {
    .Ident(_) | .Num(_) :> false
    _                   :> true
  }
}
<p>{ regexOk(.Other) }</p>
</program>`, "f6pay");
    expect(hardErrors(r)).toEqual([]);
    expect(r.clientJs).toContain(`=== "Ident"`);
    expect(r.clientJs).toContain(`=== "Num"`);
    expect(r.clientJs).toContain("||");
  });
});

// ---------------------------------------------------------------------------
// MUST-NOT-BREAK regression guard (currently-working shapes)
// ---------------------------------------------------------------------------

describe("must-not-break — currently-working match shapes", () => {
  test("string-literal single arms", () => {
    const r = compileSource(`<program>
fn kw(s: string) -> int {
  return match s {
    "if"   :> 1
    "else" :> 2
    _      :> 0
  }
}
<p>{ kw("if") }</p>
</program>`, "mnbstr");
    expect(hardErrors(r)).toEqual([]);
    expect(r.clientJs).toContain(`=== "if"`);
    expect(r.clientJs).toContain(`=== "else"`);
  });

  test("enum×enum product-match", () => {
    const r = compileSource(`<program>
type Mode:enum = { A, B }
type Ev:enum = { X, Y }
fn combo(m: Mode, e: Ev) -> string {
  return match (m, e) {
    (.A, .X) :> "ax"
    (.B, _)  :> "b"
    (_, _)   :> "other"
  }
}
<p>{ combo(.A, .X) }</p>
</program>`, "mnbprod");
    expect(hardErrors(r)).toEqual([]);
    expect(r.clientJs).toContain(`=== "A"`);
    expect(r.clientJs).toContain(`=== "X"`);
  });

  test("nullary-enum `|`-alternation", () => {
    const r = compileSource(`<program>
type Color:enum = { Red, Green, Blue }
fn warm(c: Color) -> bool {
  return match c {
    .Red | .Green :> true
    .Blue         :> false
  }
}
<p>{ warm(.Red) }</p>
</program>`, "mnbalt");
    expect(hardErrors(r)).toEqual([]);
    expect(r.clientJs).toContain(`=== "Red"`);
    expect(r.clientJs).toContain(`=== "Green"`);
    expect(r.clientJs).toContain("||");
  });

  test("payload-binding variant arm still binds (single, non-alternation)", () => {
    const r = compileSource(`<program>
type Shape:enum = { Circle(r: int), Point }
fn area(s: Shape) -> int {
  return match s {
    .Circle(r) :> r
    .Point     :> 0
  }
}
<p>{ area(.Point) }</p>
</program>`, "mnbbind");
    expect(hardErrors(r)).toEqual([]);
    expect(r.clientJs).toContain(`.data.r`);
  });
});
