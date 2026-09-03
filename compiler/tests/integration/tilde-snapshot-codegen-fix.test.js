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
// ⛑ S397 SUPERSEDES PART 2 OF THAT FIX, AND THIS NOTE IS HERE SO THE NARRATIVE
// ABOVE IS NOT READ AS CURRENT. The defensive fallback was fail-OPEN by
// construction — a "~" reaching emitIdent unresolved is by construction one the
// analysis could not resolve, so handing back a value asserted the opposite of
// what the compiler had just found, and the build stayed green. It is now
// E-CG-TILDE-UNRESOLVED (Error), a NEWLY MINTED codegen-stage §34 code — not
// E-TILDE-001, which is a §32.5 TYPE-SYSTEM code whose fire site has not landed.
// Part 1 of the fix (the emit-logic.ts bare-expr orphan skip) is UNCHANGED.
// The conformance proof that the code fires is
// conformance/cases/control-flow/ctrl-028-arm-body-tilde-read-orphan-neg.
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
import { foldChunkNamespacing } from "../helpers/chunk-scope.js";

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

    const { clientJs: __cjRaw } = compileSource(src, "minimal-snapshot.scrml"); const clientJs = foldChunkNamespacing(__cjRaw);

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

    const { clientJs: __cjRaw } = compileSource(src, "two-deps-snapshot.scrml"); const clientJs = foldChunkNamespacing(__cjRaw);

    expect(clientJs).toBeTruthy();
    expect(clientJs).not.toMatch(/let\s+_scrml_tilde_\d+\s*=\s*~/);
    assertNoRawTildeInExpressionPosition(clientJs);

    // The reactive-deps derived-declare carries both subscriptions.
    expect(clientJs).toMatch(/_scrml_derived_declare\("snapshot",[^;]+_scrml_reactive_get\("count"\)[^;]+_scrml_reactive_get\("name"\)/);
    expect(clientJs).toMatch(/_scrml_derived_subscribe\("snapshot", "count"\)/);
    expect(clientJs).toMatch(/_scrml_derived_subscribe\("snapshot", "name"\)/);
  });

  test("S397 fail-closed floor: orphan ~ in const-decl init position is E-CG-TILDE-UNRESOLVED, not a silent null", () => {
    // The orphan-in-decl-init case mirrors the bare-expr fix at a different
    // codegen path. "const result = ~" is fine when "~" resolves to a
    // "_scrml_tilde_N" set up by a preceding bare-expr; with the orphan-bare-expr
    // skip in place, a downstream "const result = ~" that has no real prior tilde
    // initializer reaches emit-expr.ts:emitIdent with ctx.tildeVar === null.
    //
    // ⛑ S397 RE-SCOPE — THIS TEST USED TO ASSERT THE OPPOSITE, AND THE FLIP IS THE
    // POINT. Until S397 it asserted `expect(clientJs).toMatch(/null \/\* ~ orphaned/)`
    // — that the compiler MUST emit the defensive marker `null /* ~ orphaned —
    // codegen-fallback */` and keep going. That marker was fail-OPEN by construction:
    // a "~" reaching that line is by construction one the analysis could not resolve,
    // so emitting a value asserted the opposite of what the compiler had just
    // discovered, and the program compiled at exit 0 with zero diagnostics while
    // binding null. S397 (bryan: "mint the code") replaced the marker with a minted
    // codegen-stage diagnostic. The shape under test is UNCHANGED and deliberately so
    // — only the contract it satisfies moved, from "emits a marker" to "is rejected".
    //
    // What this test still guards from the ORIGINAL HU-5 Q-W35-1 bug is intact and is
    // asserted below: a raw "~" sigil must never reach a JS expression position
    // (bitwise-NOT-on-nothing — a SyntaxError or a silent NaN). That was always the
    // real defect; the marker was only ever one way of avoiding it, and erroring is
    // the better one.
    const src = [
      "<program>",
      "${",
      "  <count> = 0",
      "  ~snapshot = { value: @count }",
      "  const result = ~",
      "}",
      "</program>",
    ].join("\n");

    const { clientJs: __cjRaw, errors } = compileSource(src, "orphan-consumer.scrml"); const clientJs = foldChunkNamespacing(__cjRaw);

    // The floor FIRES, exactly once, at severity error.
    const orphans = errors.filter((e) => e.code === "E-CG-TILDE-UNRESOLVED");
    expect(orphans.length).toBe(1);

    // ⚑ The message SHALL name the codegen-stage condition and SHALL NOT claim the
    // type system checked anything — E-TILDE-001 is a §32.5 TYPE-SYSTEM code whose
    // fire site has not landed, and a codegen diagnostic that borrowed its framing
    // would make "which stage owns this condition" unanswerable from the §34 catalog.
    expect(orphans[0].message).toContain("no accumulator slot");
    expect(orphans[0].message).toContain("reported by CODEGEN");
    expect(orphans[0].message).not.toContain("E-TILDE-001");

    // The pre-S397 fail-open marker is GONE — this is the assertion that would go red
    // if the fallback were ever restored.
    expect(clientJs).not.toContain("~ orphaned");

    // …and the ORIGINAL bug stays guarded: no raw "~" in expression position. The
    // placeholder codegen emits in its place is syntactically valid JS on purpose, so
    // this diagnostic is not buried under the §2.2.1 acorn gate's generic
    // E-CODEGEN-INVALID-LOGIC "compiler defect" framing.
    expect(clientJs).toBeTruthy();
    assertNoRawTildeInExpressionPosition(clientJs);
    expect(errors.some((e) => e.code === "E-CODEGEN-INVALID-LOGIC")).toBe(false);
  });
});
