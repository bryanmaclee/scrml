// native-blockstub-verbatim-body.test.js — native-parser-swap parity-closer.
//
// change-id: native-blockstub-verbatim-body-2026-06-07
//
// THE BUG (S170 Wave 2 ROOT-1 + Bucket-1 SUB-SHAPE-B): under
// `--parser=scrml-native`, a BLOCK-bodied match arm and a BLOCK-bodied
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
// VERIFIED HERE (Bug-73 lesson — assert the individual STATEMENTS survive in
// the emit, NOT merely that the arms / lambdas exist; a naive "both arms exist"
// emit-string test would FALSELY pass while the bodies were empty `{}`):
//   1. a multi-statement `:>`-block match arm emits BOTH of its statements
//   2. a block-bodied `.filter` callback emits its body statement
//   3. native == default for the same source (byte-parity on the function)

import { describe, test, expect } from "bun:test";
import { resolve } from "path";
import { writeFileSync, readFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { compileScrml } from "../../src/api.js";
import { normalizeChunkToken } from "../helpers/chunk-scope.js";

// compileWith — full-compile `source` under `parser` (null = default live
// BS+TAB; "scrml-native" = native pipeline). Returns errors + client.js.
function compileWith(source, parser, suffix) {
  const uniq = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const name = `${suffix}-${uniq}`;
  const tmpDir = resolve("/tmp", `scrml-blockstub-${name}`);
  const tmpInput = resolve(tmpDir, `${name}.scrml`);
  const outDir = resolve(tmpDir, "out");
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(tmpInput, source);
  try {
    const opts = { inputFiles: [tmpInput], write: true, outputDir: outDir };
    if (parser) opts.parser = parser;
    const result = compileScrml(opts);
    const clientPath = resolve(outDir, `${name}.client.js`);
    return {
      errors: result.errors ?? [],
      warnings: result.warnings ?? [],
      clientJs: existsSync(clientPath) ? readFileSync(clientPath, "utf8") : "",
    };
  } finally {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
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

describe("native BlockStub verbatim-body recovery (S170 Wave 2)", () => {
  test("multi-statement :>-block match arm — BOTH arm-body statements survive (not {})", () => {
    const nat = compileWith(MATCH_BLOCK_ARM, "scrml-native", "match-arm");
    expect(nat.errors).toEqual([]);
    // The .Mushroom arm has two writes: coins AND score. A dropped body would
    // emit `{}` and these would be ABSENT. Assert BOTH statements present.
    expect(nat.clientJs).toMatch(/_scrml_reactive_set\("coins"/);
    expect(nat.clientJs).toMatch(/_scrml_reactive_set\("score"/);
    // The score write proves the SECOND statement survived (a single-statement
    // recovery would emit coins but not score). Both the +100 and +300 literals
    // (the two distinct arms' score writes) must appear.
    expect(nat.clientJs).toContain("100");
    expect(nat.clientJs).toContain("300");
    // The +100 score write must NOT have collapsed to an empty `{}` arm.
    expect(nat.clientJs).not.toMatch(/=== "Mushroom"\)\s*\{\s*\}/);
  });

  test("match-arm bodies are emitted under native (arm dispatch + body present)", () => {
    const nat = compileWith(MATCH_BLOCK_ARM, "scrml-native", "match-arm-2");
    // Both arms must dispatch on their variant tag.
    expect(nat.clientJs).toMatch(/=== "Mushroom"/);
    expect(nat.clientJs).toMatch(/=== "Flower"/);
    // The payload binding `n` must be bound from the matched variant data.
    expect(nat.clientJs).toMatch(/const n = /);
  });

  test("block-bodied .filter callback — the callback BODY statement survives (not empty)", () => {
    const nat = compileWith(LAMBDA_BLOCK_BODY, "scrml-native", "lambda");
    expect(nat.errors).toEqual([]);
    // The arrow body has `let doubled = n * 2` + `return doubled > 4`. A dropped
    // body would emit `() => {}` (or no callback at all). Assert the inner
    // statement survived.
    expect(nat.clientJs).toMatch(/\.filter\(/);
    expect(nat.clientJs).toContain("doubled");
    expect(nat.clientJs).toMatch(/return doubled > 4/);
  });

  test("match-arm-block emit is statement-identical native == default (modulo terminators)", () => {
    const nat = compileWith(MATCH_BLOCK_ARM, "scrml-native", "match-parity-n");
    const def = compileWith(MATCH_BLOCK_ARM, null, "match-parity-d");
    // Normalize: (a) the per-compile counter suffixes (_scrml_match_NN /
    // _scrml_tag_NN / function-name suffixes) + runtime hash — these differ
    // because native allocates node ids in a different order, NOT a semantic
    // drift; (b) statement-TERMINATOR cosmetics — the verbatim re-parse path
    // and the default both emit semantically-identical arm bodies but differ on
    // doubled `;;` and a trailing `;` before `}` / after `})()`, all JS-valid
    // no-ops. Collapse `;;`->`;`, strip whitespace, and drop a `;` immediately
    // before `}`. The statement-survival assertions above are the load-bearing
    // checks; this guards STRUCTURE while tolerating the terminator cosmetics.
    const norm = (js) =>
      js
        .replace(/_scrml_\w+_\d+/g, "_scrml_X")
        .replace(/scrml-runtime\.\w+\.js/g, "scrml-runtime.X.js")
        .replace(/;+/g, ";")
        .replace(/\s+/g, " ")
        .replace(/;\s*}/g, " }")
        .replace(/}\)\(\);/g, "})()")
        .trim();
    expect(norm(normalizeChunkToken(nat.clientJs))).toBe(norm(normalizeChunkToken(def.clientJs)));
  });

  test("lambda-callback emit is structurally-identical native == default (modulo escape-hatch param spacing)", () => {
    // The block-bodied arrow lowers through the escape-hatch string-rewrite
    // path on BOTH front-ends (live: expression-parser.ts esTreeToExprNode;
    // native: translateArrow -> EscapeHatchExpr). The native verbatim raw is
    // byte-exact (`(n) => {...}`), but the rewrite pipeline reflows the arrow
    // PARAM-LIST spacing differently between the two raw inputs (`( n )` vs
    // `(n)`) — a known, pre-existing escape-hatch cosmetic, not a semantic
    // drift. Compare after collapsing ALL whitespace AND stripping spaces
    // immediately inside the arrow param parens, so the comparison is sensitive
    // to STATEMENTS + STRUCTURE but tolerant of that cosmetic reflow.
    const nat = compileWith(LAMBDA_BLOCK_BODY, "scrml-native", "lambda-parity-n");
    const def = compileWith(LAMBDA_BLOCK_BODY, null, "lambda-parity-d");
    const norm = (js) =>
      js
        .replace(/_scrml_\w+_\d+/g, "_scrml_X")
        .replace(/scrml-runtime\.\w+\.js/g, "scrml-runtime.X.js")
        .replace(/\(\s+/g, "(")
        .replace(/\s+\)/g, ")")
        .replace(/\s+/g, " ")
        .trim();
    expect(norm(normalizeChunkToken(nat.clientJs))).toBe(norm(normalizeChunkToken(def.clientJs)));
  });
});
