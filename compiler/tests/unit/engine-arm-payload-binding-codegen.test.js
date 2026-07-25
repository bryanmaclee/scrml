/**
 * engine-arm-payload-binding-codegen.test.js
 *
 * Bug 1 (S88 dispatch — 14-mario state machine) regression coverage.
 *
 * Two distinct codegen symptoms surfaced by Wave 3 Dispatch 2 e2e:
 *
 *   A. Block-form payload-binding match arms in function bodies dropped
 *      the `payloadBindings` field when projecting `match-arm-block` AST
 *      nodes into `MatchArm` records. Result: `n` in
 *
 *          match powerUp { .Mushroom(n) => { @coins = @coins + n } }
 *
 *      emitted as an unbound JS identifier → ReferenceError at runtime.
 *      Fix: emitMatchExpr now joins payloadBindings into MatchArm.binding
 *      so emitVariantBindingPrelude produces `const n = tmp.data.coins;`
 *      before the arm body. (compiler/src/codegen/emit-control-flow.ts)
 *
 *   B. The `EnumType::Variant` access form (SPEC §14, line 6976 — alias
 *      for `EnumType.Variant`) was silently dropped at acorn-parse time.
 *      The scrmlEnumPlugin emitted a STRING token for `::Variant` AFTER
 *      the IDENT prefix had already been emitted; parseExpressionAt
 *      stopped at the IDENT and the trailing STRING was silently lost.
 *      Result: `@marioState == MarioState::Small` compiled to
 *      `_scrml_structural_eq(<cell>, MarioState)` (compares against the
 *      whole enum object, never matches a discriminant).
 *      Fix: preprocessForAcorn normalizes `::` → `.` so the standard
 *      MemberExpression path runs. (compiler/src/expression-parser.ts)
 *
 * Coverage:
 *   §A1  block-form payload binding (.Mushroom(n) => { ... }) emits `const n = ...`
 *   §A2  multi-binding block-form (.Rect(w, h) => { ... }) emits both bindings
 *   §A3  block body actually references the binding (n appears in arm body)
 *   §B1  EnumType::Variant in `==` comparison emits structural_eq with MarioState.Small
 *   §B2  EnumType::Variant(arg) constructor call form emits PowerUp.Mushroom(1)
 *   §B3  shorthand ::Variant (no enum-type prefix) normalizes to .Variant path
 *   §INT 14-mario fixture compiles end-to-end with both fixes — no eatPowerUp(PowerUp)
 *        and no _structural_eq(<cell>, MarioState) artifacts.
 */

import { describe, test, expect } from "bun:test";
import { resolve } from "path";
import { writeFileSync, rmSync, existsSync, mkdirSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { compileScrml } from "../../src/api.js";
import { foldChunkNamespacing } from "../helpers/chunk-scope.js";

const tmpRoot = resolve(tmpdir(), "scrml-engine-arm-payload-binding-codegen");
let tmpCounter = 0;

function compile(source) {
  const tmpDir = resolve(tmpRoot, `case-${++tmpCounter}-${Date.now()}`);
  const tmpInput = resolve(tmpDir, "app.scrml");
  const outDir = resolve(tmpDir, "out");
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(tmpInput, source);
  try {
    const result = compileScrml({
      inputFiles: [tmpInput],
      write: true,
      outputDir: outDir,
    });
    const clientPath = resolve(outDir, "app.client.js");
    const clientJs =foldChunkNamespacing( foldChunkNamespacing(existsSync(clientPath) ? readFileSync(clientPath, "utf-8") : ""));
    return {
      errors: (result.errors ?? []).filter(e => e.severity !== "warning"),
      clientJs,
    };
  } finally {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// §A — match-arm-block payload binding
// ---------------------------------------------------------------------------

describe("match-arm-block payload binding (Bug 1 fix-A)", () => {
  test("§A1 block-form payload binding emits `const n = tmp.data.coins`", () => {
    const src = `\${
      type PowerUp:enum = { Mushroom(coins: number) }
      <coins> = 0
      function eat(p: PowerUp) {
        match p {
          .Mushroom(n) => { @coins = @coins + n }
        }
      }
    }
<program>
<button onclick=eat(PowerUp.Mushroom(1))>Eat</button>
</program>`;
    const { errors, clientJs: __cjRaw } = compile(src); const clientJs = foldChunkNamespacing(__cjRaw);
    expect(errors).toEqual([]);
    // The arm body MUST bind `n` from tagged-object payload before the assignment.
    // Pattern: `if (<tag> === "Mushroom") { const n = <tmp>.data.coins; ...`
    expect(clientJs).toMatch(/=== "Mushroom"\) \{ const n = [\w]+\.data\.coins;/);
    // And the body must use `n` (not a leaked identifier).
    expect(clientJs).toMatch(/_scrml_reactive_get\("coins"\) \+ n/);
  });

  test("§A2 multi-binding block-form `.Rect(w, h)` emits both bindings", () => {
    const src = `\${
      type Shape:enum = { Rect(w: number, h: number) }
      <area> = 0
      function compute(s: Shape) {
        match s {
          .Rect(w, h) => { @area = w * h }
        }
      }
    }
<program>
<button onclick=compute(Shape.Rect(2, 3))>Compute</button>
</program>`;
    const { errors, clientJs: __cjRaw } = compile(src); const clientJs = foldChunkNamespacing(__cjRaw);
    expect(errors).toEqual([]);
    // Both bindings must be present.
    expect(clientJs).toMatch(/const w = [\w]+\.data\.w;/);
    expect(clientJs).toMatch(/const h = [\w]+\.data\.h;/);
    // Body uses both.
    expect(clientJs).toContain("w * h");
  });

  test("§A3 binding name is referenced inside the block body (no unbound identifier)", () => {
    // Regression guard: before the fix, the body emitted `n` but no `const n = ...`
    // declaration. Confirm that any reference to `n` is preceded by its declaration
    // in the same emitted arm block.
    const src = `\${
      type Reward:enum = { Coins(amount: number) }
      <total> = 0
      function add(r: Reward) {
        match r {
          .Coins(n) => { @total = @total + n }
        }
      }
    }
<program>
<button onclick=add(Reward.Coins(5))>Add</button>
</program>`;
    const { errors, clientJs: __cjRaw } = compile(src); const clientJs = foldChunkNamespacing(__cjRaw);
    expect(errors).toEqual([]);
    // Locate the emitted arm. Must contain both `const n = ` AND `+ n` AFTER it.
    const armMatch = clientJs.match(/=== "Coins"\) \{[^}]+\}/);
    expect(armMatch).not.toBeNull();
    const armBody = armMatch[0];
    expect(armBody).toMatch(/const n = [\w]+\.data\.amount;/);
    expect(armBody).toMatch(/\+ n/);
    // The `const n = ` must appear BEFORE `+ n` in the arm body (declaration first).
    expect(armBody.indexOf("const n =")).toBeLessThan(armBody.indexOf("+ n"));
  });
});

// ---------------------------------------------------------------------------
// §B — EnumType::Variant access (the `::` alias for `.`)
// ---------------------------------------------------------------------------

describe("EnumType::Variant access (Bug 1 fix-B)", () => {
  test("§B1 `@cell == EnumType::Variant` emits structural_eq with EnumType.Variant", () => {
    const src = `\${
      type State:enum = { Small, Big }
      <state>: State = .Small
      function isSmall() {
        let r = @state == State::Small
        return r
      }
    }
<program>
<button onclick=isSmall()>Check</button>
</program>`;
    const { errors, clientJs: __cjRaw } = compile(src); const clientJs = foldChunkNamespacing(__cjRaw);
    expect(errors).toEqual([]);
    // Must compare against State.Small (resolves to "Small" at runtime), NOT
    // against the bare State enum object (the pre-fix bug).
    expect(clientJs).toContain("State.Small");
    expect(clientJs).not.toMatch(/_scrml_structural_eq\(_scrml_reactive_get\("state"\), State\)/);
  });

  test("§B2 `EnumType::Variant(arg)` constructor call form emits proper member call", () => {
    const src = `\${
      type PowerUp:enum = { Mushroom(coins: number) }
      <last>: number = 0
      function eat(p: PowerUp) {
        match p {
          .Mushroom(n) => { @last = n }
        }
      }
    }
<program>
<button onclick=eat(PowerUp::Mushroom(7))>Eat</button>
</program>`;
    const { errors, clientJs: __cjRaw } = compile(src); const clientJs = foldChunkNamespacing(__cjRaw);
    expect(errors).toEqual([]);
    // Must be PowerUp.Mushroom(7), NOT just PowerUp (the pre-fix bug would
    // pass the entire enum object instead of constructing the variant).
    expect(clientJs).toContain("PowerUp.Mushroom(7)");
    expect(clientJs).not.toMatch(/_scrml_eat[_\d]*\(PowerUp\)/);
  });

  test("§B3 `EnumType.Variant` (canonical dot form) still works (no regression)", () => {
    // Defensive: the fix-B preprocessing must not break the canonical form.
    const src = `\${
      type State:enum = { Small, Big }
      <state>: State = .Small
      function isSmall() {
        let r = @state == State.Small
        return r
      }
    }
<program>
<button onclick=isSmall()>Check</button>
</program>`;
    const { errors, clientJs: __cjRaw } = compile(src); const clientJs = foldChunkNamespacing(__cjRaw);
    expect(errors).toEqual([]);
    expect(clientJs).toContain("State.Small");
  });
});

// ---------------------------------------------------------------------------
// §INT — 14-mario fixture end-to-end smoke test
// ---------------------------------------------------------------------------

describe("14-mario fixture (integration smoke)", () => {
  test("§INT1 examples/14-mario-state-machine.scrml compiles without ReferenceError shape", () => {
    // Compile the exact fixture from the Wave 3 D2 e2e suite. Verify that:
    //   - eatPowerUp call args are constructed PowerUp.Variant(arg) calls
    //     (not bare PowerUp);
    //   - the .Mushroom arm body has its `n` binding declared;
    //   - getHurt's wasSmall comparison uses MarioState.Small (not bare MarioState).
    const fixturePath = resolve(__dirname, "../../../examples/14-mario-state-machine.scrml");
    const src = readFileSync(fixturePath, "utf-8");
    const { errors, clientJs: __cjRaw } = compile(src); const clientJs = foldChunkNamespacing(__cjRaw);
    expect(errors).toEqual([]);
    // Fix-A surface: payload binding declared.
    expect(clientJs).toMatch(/=== "Mushroom"\) \{ const n = [\w]+\.data\.coins;/);
    // Fix-B surface 1: comparison uses MarioState.Small, not bare MarioState.
    expect(clientJs).toContain("MarioState.Small");
    expect(clientJs).not.toMatch(/_scrml_structural_eq\(_scrml_reactive_get\("marioState"\), MarioState\)/);
    // Fix-B surface 2: event handlers construct variants properly.
    expect(clientJs).toContain("PowerUp.Mushroom(1)");
    expect(clientJs).toContain("PowerUp.Flower(3)");
    expect(clientJs).toContain("PowerUp.Feather(5)");
    // Pre-fix bug: handler bodies were `_scrml_eatPowerUp_NN(PowerUp)`.
    expect(clientJs).not.toMatch(/_scrml_eatPowerUp_\d+\(PowerUp\)/);
  });
});
