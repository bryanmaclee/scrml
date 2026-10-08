// native-blockstub-verbatim-body.test.js — native-parser-swap parity-closer.
//
// change-id: native-blockstub-verbatim-body-2026-06-07
//
// THE BUG (S170 Wave 2 ROOT-1 + Bucket-1 SUB-SHAPE-B): through the native
// parser, a BLOCK-bodied match arm and a BLOCK-bodied
// lambda callback SILENTLY DROPPED their statement body. The native bridge
// emitted the literal placeholder `"{}"` for any BlockStub match-arm body
// (translate-expr.js reconstructArmBody) and `{ kind:"block", stmts:[] }`
// for any BlockStub lambda body (translateLambdaBody) — the statements were
// thrown away. The Mario `eatPowerUp` `.Mushroom(n) :> { @coins=...; ... }`
// click fired but performed NO transition; a `.filter(n => { ... })` callback
// body vanished. It compiled CLEAN — the S139/S163 silent-miscompile trap.
//
// THE FIX: parse-expr.js stamps the verbatim balanced `{...}` source onto the
// BlockStub at parse time (parseBlockStub) and the full lambda source onto the
// Arrow/Function node (finishArrow / parseFunctionExpr), where ctx.source + the
// token span share a coordinate origin. The bridge then re-feeds the verbatim
// to the live re-parse path: reconstructArmBody returns the `{...}` so
// emit-control-flow.ts parseMatchArm -> rewriteBlockBody emits the statements;
// translateArrow/translateFunctionExpr emit an EscapeHatchExpr whose raw is the
// whole lambda, so emit-expr.ts emitEscapeHatch -> rewriteExprArrowBody emits
// the callback verbatim. A render body (`{ lift <markup> }`) is GUARDED out
// (it belongs to match-block routing — a separate native gap).
//
// S449 RE-POINT: this file used to compile under the retired full-pipeline
// `--parser=scrml-native` flag and compare the emitted JS with the default
// pipeline's. parseBlockStub / reconstructArmBody / translateArrow run in
// production inside `nativeParseFile` (component / `^{}` / `<match>` re-parse),
// so the fix is asserted on the native tree (Bug-73 lesson kept: assert the
// individual STATEMENTS survive, not merely that the arms / lambdas exist):
//   1. each `:>`-block match arm's raw body carries BOTH of its statements
//   2. the block-bodied `.filter` callback's escape-hatch raw is the whole lambda
// and the same two shapes compile through the default pipeline with every
// statement present.

import { describe, test, expect } from "bun:test";
import { resolve } from "path";
import { writeFileSync, readFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { compileScrml } from "../../src/api.js";
import { tmpdir } from "os";
import { nativeAst, findNodes, errorsOf } from "../helpers/native-ast.js";

function compileDefault(source, suffix) {
  const uniq = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const name = `${suffix}-${uniq}`;
  const tmpDir = resolve(tmpdir(), `scrml-blockstub-${name}`);
  const tmpInput = resolve(tmpDir, `${name}.scrml`);
  const outDir = resolve(tmpDir, "out");
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(tmpInput, source);
  try {
    const result = compileScrml({ inputFiles: [tmpInput], write: true, outputDir: outDir });
    const clientPath = resolve(outDir, `${name}.client.js`);
    return {
      errors: result.errors ?? [],
      clientJs: existsSync(clientPath) ? readFileSync(clientPath, "utf8") : "",
    };
  } finally {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
}

function fnBody(result, name) {
  const fn = findNodes(result.ast, (n) => n.kind === "function-decl" && n.name === name)[0];
  return fn ? fn.body : null;
}

// A multi-statement `:>`-block match arm inside a function body — the exact
// Mario `eatPowerUp` shape. The .Mushroom arm has TWO statements (coins write
// + score write); both MUST appear in the emit (the Bug-73 statement-survival
// assertion — a "both arms emitted" check alone would not catch the empty-`{}`
// regression).
const MATCH_BLOCK_ARM = [
  "${",
  "  type PowerUp:enum = {",
  "    Mushroom(coins: number)",
  "    Flower(coins: number)",
  "  }",
  "  <coins>: number = 0",
  "  <score>: number = 0",
  "  function eatPowerUp(powerUp: PowerUp) {",
  "    match powerUp {",
  "      .Mushroom(n) :> {",
  "        @coins = @coins + n",
  "        @score = @score + 100",
  "      }",
  "      .Flower(n) :> {",
  "        @coins = @coins + n",
  "        @score = @score + 300",
  "      }",
  "    }",
  "  }",
  "}",
  "<program>",
  "  <button onclick=eatPowerUp(PowerUp::Mushroom(1))>M</button>",
  "</program>",
].join("\n");

// A block-bodied `.filter` callback (the method-chain SUB-SHAPE-B). The arrow
// body is `{ ... }` with an explicit return statement — it MUST survive.
const LAMBDA_BLOCK_BODY = [
  "${",
  "  <items> = [1, 2, 3, 4]",
  "  function bigOnes() {",
  "    return @items.filter((n) => {",
  "      let doubled = n * 2",
  "      return doubled > 4",
  "    })",
  "  }",
  "}",
  "<program>",
  "  <button onclick=bigOnes()>go</button>",
  "</program>",
].join("\n");

describe("native BlockStub verbatim-body recovery (S170 Wave 2) — native tree", () => {
  test("multi-statement :>-block match arm — BOTH arm-body statements survive in each raw arm (not {})", () => {
    const nat = nativeAst(MATCH_BLOCK_ARM);
    expect(errorsOf(nat)).toEqual([]);
    const match = findNodes(fnBody(nat, "eatPowerUp"), (n) => n.kind === "match-expr")[0];
    expect(match).toBeDefined();
    expect(match.rawArms).toHaveLength(2);
    const [mushroom, flower] = match.rawArms;
    expect(mushroom).toMatch(/^\.Mushroom\(n\)/);
    expect(mushroom).toContain("@coins = @coins + n");
    expect(mushroom).toContain("@score = @score + 100");
    expect(flower).toMatch(/^\.Flower\(n\)/);
    expect(flower).toContain("@coins = @coins + n");
    expect(flower).toContain("@score = @score + 300");
    for (const arm of match.rawArms) expect(arm).not.toMatch(/=>\s*\{\s*\}\s*$/);
  });

  test("block-bodied .filter callback — the escape-hatch raw is the whole lambda (body not empty)", () => {
    const nat = nativeAst(LAMBDA_BLOCK_BODY);
    expect(errorsOf(nat)).toEqual([]);
    const hatch = findNodes(fnBody(nat, "bigOnes"), (n) => n.kind === "escape-hatch" && n.nativeKind === "ArrowFunctionExpression")[0];
    expect(hatch).toBeDefined();
    expect(hatch.raw).toMatch(/^\(n\) => \{/);
    expect(hatch.raw).toContain("let doubled = n * 2");
    expect(hatch.raw).toContain("return doubled > 4");
  });
});

describe("block-bodied match arm + lambda callback — default pipeline emit", () => {
  test("both arms dispatch, bind n, and emit BOTH statements", () => {
    const def = compileDefault(MATCH_BLOCK_ARM, "match-arm");
    expect(def.errors).toEqual([]);
    expect(def.clientJs).toMatch(/=== "Mushroom"/);
    expect(def.clientJs).toMatch(/=== "Flower"/);
    expect(def.clientJs).toMatch(/const n = /);
    expect(def.clientJs).toMatch(/_scrml_cs_reactive_set\("coins"/);
    expect(def.clientJs).toMatch(/_scrml_cs_reactive_set\("score"/);
    expect(def.clientJs).toContain("100");
    expect(def.clientJs).toContain("300");
    expect(def.clientJs).not.toMatch(/=== "Mushroom"\)\s*\{\s*\}/);
  });

  test("the .filter callback body statement survives", () => {
    const def = compileDefault(LAMBDA_BLOCK_BODY, "lambda");
    expect(def.errors).toEqual([]);
    expect(def.clientJs).toMatch(/\.filter\(/);
    expect(def.clientJs).toMatch(/return doubled > 4/);
  });
});
