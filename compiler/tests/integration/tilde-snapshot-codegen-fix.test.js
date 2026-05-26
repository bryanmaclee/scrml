//
// Regression — ~snapshot = {...} tilde-decl with reactive deps codegen leak.
//
// Bug surfaced S125 Wave 14 DD; carried through S130 known-gaps Bug 15.
// Ratified S131 HU-5 Q-W35-1 (a) as a codegen-bounded bug fix; NOT a new
// language form (no SPEC §32 amendment).
//
// Pre-fix shape: a "~name = expr" line in a "${...}" body where expr
// carries reactive @-references would emit:
//
//     let _scrml_tilde_N = ~;
//     _scrml_derived_declare("name", () => ({...}));
//     _scrml_derived_subscribe("name", "...");
//
// The first line is invalid JS — the raw "~" sigil is bitwise-NOT on
// nothing -> SyntaxError at runtime.
//
// Root cause (Phase 0 trace):
//   1. Tokenizer emits "~" as TILDE token (tokenizer.ts:1135).
//   2. Live parser (ast-builder.js) has NO "~ IDENT =" lead handler at
//      statement position. Native parser (parse-stmt.js:3015
//      tildeDeclLeadFollows) DOES, but native is opt-in via
//      --parser=scrml-native.
//   3. Live parser falls through "~snapshot = {...}" to collectExpr()
//      catch-all at ast-builder.js:9665. The IDENT-= statement-boundary
//      check at line 2588-2596 breaks on "snapshot =" after the consumed
//      "~", returning just "~" as a bare-expr.
//   4. Spurious bare-expr "~" is pushed; next iteration matches the bare
//      IDENT-= tilde-decl handler at line 9570 for "snapshot = {...}".
//   5. Codegen at emit-logic.ts:bare-expr Phase 3 fast path sees
//      opts.tildeContext is active (set by per-group pre-scan because
//      "~" appears in the group's AST). Emits the "let _scrml_tilde_N"
//      capture line with emitExpr(node.exprNode, prevExprCtx) where
//      node.exprNode = {kind:"ident", name:"~"} and prevExprCtx.tildeVar
//      is null.
//   6. emit-expr.ts:emitIdent line 273: "name === '~' && ctx.tildeVar"
//      fails (tildeVar null); falls to "Plain identifier — pass through"
//      at line 292; returns literal "~".
//   7. Result: "let _scrml_tilde_N = ~;" — silent silent-correctness bug.
//
// The fix (two parts):
//   1. emit-logic.ts:bare-expr — skip the orphan "~" bare-expr emission
//      when the exprNode is exactly {kind:"ident", name:"~"} AND there
//      is no prior tilde to consume.
//   2. emit-expr.ts:emitIdent — defensive fallback when "name === '~'"
//      reaches the path with "ctx.tildeVar === null": emit
//      "null /* ~ orphaned — codegen-fallback */" so the cause is visible
//      and the JS parses.
//
// SPEC §32 ratifies "~" as the pipeline accumulator (READ-side atom);
// there is no statement-position production for a lone "~". Per HU-5
// Q-W35-1 (a) ratification, NO new SPEC §32 prose; NO new language form.
// The native parser already handles the unified "~ IDENT = expr" lead;
// mirroring that in the live parser is surfaceable as a separate
// follow-up (out of scope for this dispatch — codegen-bounded per brief).
//

import { describe, expect, test } from "bun:test";
import { compileScrml } from "../../src/api.js";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function compileSource(src, fname) {
  const dir = mkdtempSync(join(tmpdir(), "tilde-snapshot-"));
  const inputPath = join(dir, fname);
  writeFileSync(inputPath, src, "utf-8");
  const result = compileScrml({
    inputFiles: [inputPath],
    outputDir: dir,
    write: true,
    log: () => {},
  });
  const base = fname.replace(/\.scrml$/, "");
  const clientPath = join(dir, base + ".client.js");
  let clientJs = "";
  try { clientJs = readFileSync(clientPath, "utf-8"); } catch { /* file may not exist on hard errors */ }
  return {
    clientJs,
    errors: result.errors ?? [],
    warnings: result.warnings ?? [],
  };
}

//
// Strict bug-shape assertion: the raw "~" sigil MUST NOT appear in a JS
// expression position. Matches "= ~;" / "( ~ )" / ", ~ ," etc. — i.e.
// any position where bitwise-NOT-on-nothing would parse as a SyntaxError
// or evaluate to NaN. Code comments are stripped first so the defensive
// marker comment "/* ~ orphaned — codegen-fallback */" (which only
// contains "~" inside a block comment) does not false-positive.
//
function assertNoRawTildeInExpressionPosition(clientJs) {
  const stripped = clientJs.replace(/\/\*[\s\S]*?\*\//g, "");
  const noComments = stripped.replace(/\/\/[^\n]*/g, "");
  expect(noComments).not.toMatch(/=\s*~\s*[;,)\n]/);
  expect(noComments).not.toMatch(/[(,]\s*~\s*[);,]/);
}

describe("~snapshot = {...} codegen fix — orphan ~ no longer leaks (HU-5 Q-W35-1)", () => {
  test("minimal repro: ~name = {...} with reactive deps emits no raw ~", () => {
    const src = [
      "<program>",
      "${",
      "  <count> = 0",
      "  ~snapshot = { value: @count }",
      "}",
      "</program>",
    ].join("\n");

    const { clientJs } = compileSource(src, "minimal-snapshot.scrml");

    // E-MU-001 (lin tracker) may fire here — that's a pre-existing
    // surface tension with "~name = expr" form and the lin-tracker's
    // consumption model, NOT a regression introduced by this fix.
    // What we verify: the codegen output (if produced) is well-formed.
    expect(clientJs).toBeTruthy();

    // PRIMARY ASSERTION: the bug-shape "let _scrml_tilde_N = ~;" is gone.
    expect(clientJs).not.toMatch(/let\s+_scrml_tilde_\d+\s*=\s*~/);

    // Cross-check: no raw "~" anywhere in expression position.
    assertNoRawTildeInExpressionPosition(clientJs);

    // The actual derived-declare for the tilde-decl name "snapshot" IS
    // emitted — the tilde-decl branch in emit-logic.ts correctly handles
    // the reactive-deps case. The bug was only the spurious bare-expr.
    expect(clientJs).toMatch(/_scrml_derived_declare\("snapshot",/);
    expect(clientJs).toMatch(/_scrml_derived_subscribe\("snapshot", "count"\)/);
  });

  test("~snapshot = {...} with two reactive deps emits derived + both subscriptions", () => {
    const src = [
      "<program>",
      "${",
      "  <count> = 0",
      '  <name> = "alice"',
      "  ~snapshot = { count: @count, name: @name }",
      "}",
      "</program>",
    ].join("\n");

    const { clientJs } = compileSource(src, "two-deps-snapshot.scrml");

    expect(clientJs).toBeTruthy();
    expect(clientJs).not.toMatch(/let\s+_scrml_tilde_\d+\s*=\s*~/);
    assertNoRawTildeInExpressionPosition(clientJs);

    // The reactive-deps derived-declare carries both subscriptions.
    expect(clientJs).toMatch(/_scrml_derived_declare\("snapshot",[^;]+_scrml_reactive_get\("count"\)[^;]+_scrml_reactive_get\("name"\)/);
    expect(clientJs).toMatch(/_scrml_derived_subscribe\("snapshot", "count"\)/);
    expect(clientJs).toMatch(/_scrml_derived_subscribe\("snapshot", "name"\)/);
  });

  test("defense-in-depth: orphan ~ in const-decl init position emits defensive marker (not raw ~)", () => {
    // The orphan-in-decl-init case mirrors the bare-expr fix at a different
    // codegen path. Pre-fix: "const result = ~;" was acceptable when "~"
    // resolved to a "_scrml_tilde_N" set up by a preceding bare-expr —
    // but with the orphan-bare-expr skip in place, a downstream "const
    // result = ~" that has no real prior tilde initializer would otherwise
    // emit literal "~" (the emit-expr.ts fallthrough). The defensive
    // marker in emit-expr.ts:emitIdent catches this.
    const src = [
      "<program>",
      "${",
      "  <count> = 0",
      "  ~snapshot = { value: @count }",
      "  const result = ~",
      "}",
      "</program>",
    ].join("\n");

    const { clientJs } = compileSource(src, "orphan-consumer.scrml");

    expect(clientJs).toBeTruthy();
    // No raw "~" in expression position.
    assertNoRawTildeInExpressionPosition(clientJs);
    // The defensive marker MUST appear for the orphan consumer.
    expect(clientJs).toMatch(/null \/\* ~ orphaned/);
  });
});
