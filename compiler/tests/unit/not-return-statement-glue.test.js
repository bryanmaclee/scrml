/**
 * not-return-statement-glue.test.js — `return not` must not glue to the next statement
 *
 * Regression: 6nz inbound 2026-05-24 (6nz-s). Adopter MED bug — hard parse
 * failure that killed the whole bundle at load.
 *
 * The bug: `preprocessForAcorn`'s boolean-negation rewrite
 *   /(?<![A-Za-z0-9_$@.])not\s+(<operand>)/g  ->  "!$1"
 * greedily matched `not` followed by the next identifier-shaped token, INCLUDING
 * JS reserved keywords AND across a statement boundary (a newline). So a
 * standalone `not` in value-completion position glued to the following statement:
 *
 *   function f() { if (cond) return not
 *                  const pos = ctx.pos }
 *
 * emitted  `return !const pos = ctx.pos`  ->  SyntaxError: Unexpected token 'const'.
 *
 * The fix (expression-parser.ts:preprocessForAcorn, 6nz-s):
 *   (a) statement-boundary guard — `[ \t]+` (horizontal whitespace only), so the
 *       rewrite never bridges a newline / statement break;
 *   (b) keyword-exclusion lookahead — a JS reserved keyword is never a negation
 *       operand, so `not const` / `not return` is standalone absence.
 *   Standalone `not` then falls through to esTreeToExprNode as Identifier `not`
 *   -> LitExpr { litType: "not" }, emitted as the canonical §42 absence value `null`.
 *
 * Coverage:
 *   §1  `return not` + following `const` — compiles, no glue, valid JS, node-check clean
 *   §2  `return not` lowers to the canonical absence value (`return null`)
 *   §3  `@x = not` standalone (assignment value-completion) unaffected
 *   §4  real negation `not ready` / `not @x` still lowers to `!`
 *   §5  GITI-017 regex fence not regressed (`/not a jj repo/i` verbatim)
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { execFileSync } from "node:child_process";
import { compileScrml } from "../../src/api.js";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { foldChunkNamespacing } from "../helpers/chunk-scope.js";

const FIXTURE_DIR = join(import.meta.dir, "__fixtures__/not-return-glue");
const FIXTURE_OUTPUT = join(FIXTURE_DIR, "dist");

function fix(name, src) {
  const path = join(FIXTURE_DIR, name);
  writeFileSync(path, src);
  return path;
}

function compile(path) {
  return compileScrml({ inputFiles: [path], outputDir: FIXTURE_OUTPUT, write: false });
}

let glueFx, negFx, bangFx, regexFx;

beforeAll(() => {
  mkdirSync(FIXTURE_DIR, { recursive: true });

  // The adopter repro — `return not` immediately followed by a `const` decl on
  // the next line, inside an ARROW BLOCK BODY (EscapeHatchExpr raw text — the
  // codegen rewrite.ts site), the path that actually fired the adopter bundle
  // failure. Also exercises the plain function-body path (preprocess/statement
  // path) and a standalone `@x = not` value-completion assignment.
  glueFx = fix("glue.scrml", `<program>
<a> = 0
<items> = [1, 2, 3]
function probe() {
    if (@a > 0) return not
    const x = 1
    return x
}
function runMap() {
    @items = @items.map((n) => {
        if (n < 0) return not
        const doubled = n * 2
        return doubled
    })
}
function clearIt() {
    @a = not
}
<button onclick=\${ @a = probe() }>go</button>
<button onclick=\${ runMap() }>map</button>
<button onclick=\${ clearIt() }>clear</button>
<div>\${@a}</div>
</program>
`);

  // §42.10 ENFORCEMENT (S188): prefix-`not`-as-negation is forbidden — `not @ready`
  // MUST now fire E-TYPE-045. This fixture is the forbidden form (asserts reject).
  negFx = fix("neg.scrml", `<program>
<ready> = false
<flag> = true
function check() {
    if (not @ready) return 1
    if (not @flag) return 2
    return 0
}
<button onclick=\${ @ready = check() > 0 }>check</button>
<div>\${@ready}</div>
</program>
`);

  // Canonical boolean negation via `!` — MUST compile clean + emit `!`.
  bangFx = fix("bang.scrml", `<program>
<ready> = false
<flag> = true
function check() {
    if (!@ready) return 1
    if (!@flag) return 2
    return 0
}
<button onclick=\${ @ready = check() > 0 }>check</button>
<div>\${@ready}</div>
</program>
`);

  // GITI-017 regex fence — `/not a jj repo/i` interior must survive verbatim.
  regexFx = fix("regex.scrml", `<program>
<msg> = ""
function classify(input) {
    if (/not a jj repo/i.test(input)) return "nope"
    return "ok"
}
<button onclick=\${ @msg = classify("x") }>go</button>
<div>\${@msg}</div>
</program>
`);
});

afterAll(() => {
  rmSync(FIXTURE_DIR, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// §1-§2: `return not` + following `const` — the core glue bug
// ---------------------------------------------------------------------------

describe("§1 `return not` does not glue to the next statement", () => {
  test("compile succeeds with no errors", () => {
    const result = compile(glueFx);
    expect(result.errors).toEqual([]);
  });

  test("emitted client JS has no glued `return !const`", () => {
    const result = compile(glueFx);
    const js = foldChunkNamespacing(result.outputs.get(glueFx).clientJs);
    // The exact pre-fix corruption symptom.
    expect(js).not.toContain("return !const");
    expect(js).not.toMatch(/return\s*!\s*(const|let|var)\b/);
  });

  test("emitted client JS is syntactically valid (node --check clean)", () => {
    const result = compile(glueFx);
    const js = foldChunkNamespacing(result.outputs.get(glueFx).clientJs);
    const tmp = join(FIXTURE_OUTPUT, "_glue_check.js");
    mkdirSync(FIXTURE_OUTPUT, { recursive: true });
    writeFileSync(tmp, js);
    // execFileSync throws (non-zero exit) on a SyntaxError — the pre-fix bundle.
    expect(() => execFileSync("node", ["--check", tmp])).not.toThrow();
  });

  test("§2 standalone `return not` lowers to canonical absence value (`return null`)", () => {
    const result = compile(glueFx);
    const js = foldChunkNamespacing(result.outputs.get(glueFx).clientJs);
    // `not` in value-completion position is the §42 absence value -> `null`.
    expect(js).toContain("return null");
  });
});

// ---------------------------------------------------------------------------
// §3: standalone `@x = not` assignment value-completion unaffected
// ---------------------------------------------------------------------------

describe("§3 standalone `@x = not` assignment is not mis-lowered", () => {
  test("no glued `= !` followed by a keyword in the assignment body", () => {
    const result = compile(glueFx);
    const js = foldChunkNamespacing(result.outputs.get(glueFx).clientJs);
    expect(js).not.toMatch(/=\s*!\s*(const|let|var|return)\b/);
  });
});

// ---------------------------------------------------------------------------
// §4: real negation `not <operand>` still lowers to `!`
// ---------------------------------------------------------------------------

describe("§42.10 boolean negation — prefix `not` REJECTED, `!` is canonical", () => {
  // S188 g-not-negation-enforce: `not @ready` (prefix-as-negation) is forbidden
  // and MUST fire E-TYPE-045 in every expression position (here: if-condition).
  test("prefix `not @operand` fires E-TYPE-045 (forbidden)", () => {
    const result = compile(negFx);
    const codes = result.errors.map((e) => e.code);
    expect(codes).toContain("E-TYPE-045");
  });

  // The canonical `!` form is the supported boolean negation — compiles clean.
  test("canonical `!@operand` compiles clean (no E-TYPE-045)", () => {
    const result = compile(bangFx);
    expect(result.errors).toEqual([]);
  });

  test("`!@ready` / `!@flag` emit boolean negation (`!`), not absence", () => {
    const result = compile(bangFx);
    const js = foldChunkNamespacing(result.outputs.get(bangFx).clientJs);
    // The negation operator must appear against the reactive read. The exact
    // reactive accessor differs by codegen, so assert the `!`-against-read shape
    // and that we did NOT drop the operand into a standalone `null`.
    expect(js).toMatch(/!\s*(_scrml_reactive|@|ready|flag)/);
    expect(js).not.toContain("return !const");
  });

  test("emitted client JS is syntactically valid (node --check clean)", () => {
    const result = compile(bangFx);
    const js = foldChunkNamespacing(result.outputs.get(bangFx).clientJs);
    const tmp = join(FIXTURE_OUTPUT, "_bang_check.js");
    mkdirSync(FIXTURE_OUTPUT, { recursive: true });
    writeFileSync(tmp, js);
    expect(() => execFileSync("node", ["--check", tmp])).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// §5: GITI-017 regex fence not regressed
// ---------------------------------------------------------------------------

describe("§5 GITI-017 regex fence holds — `/not a jj repo/i` verbatim", () => {
  test("compile succeeds", () => {
    const result = compile(regexFx);
    expect(result.errors).toEqual([]);
  });

  test("regex literal interior preserved verbatim (not corrupted to `/!a .../`)", () => {
    const result = compile(regexFx);
    const js = foldChunkNamespacing(result.outputs.get(regexFx).clientJs);
    expect(js).toContain("/not a jj repo/i");
    expect(js).not.toContain("/!a jj repo/i");
  });
});
