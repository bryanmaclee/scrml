/**
 * A1 regression — `<expr.member> is some/is not` in ternary inside ${} markup
 * interpolation must NOT fire E-SCOPE-001 (false positive).
 *
 * Provenance:
 *   Bug brief (S84 A1) reported 16+ sites in examples/23-trucking-dispatch/ that
 *   were claimed to fire E-SCOPE-001 on the pattern:
 *       ${@cell.member is not ? "" : @cell.member}
 *   PA-suspected locus: preprocessForAcorn extension (S66 .Variant fix shape).
 *
 * Investigation (this dispatch, S84 close): the bug does NOT reproduce at HEAD.
 * The 16 cited trucking-dispatch files fail with unrelated E-RI-002 (server-fn
 * reactive-write) BEFORE TS runs, which is why the brief observed "compile any
 * of these files to see the false-fire" — but the false-fire is not the one
 * named. The expression-parser regex at compiler/src/expression-parser.ts:709
 *     ([A-Za-z_$@][A-Za-z0-9_$.]*)\s+is\s+not(?!\s+not)  →  __scrml_is_not__($1)
 * already handles `@expr.member is not` (the leading `@` and dotted member
 * chain are inside the character class).
 *
 * What this test locks in:
 *   - All sixteen literal text-shapes from the bug brief, compiled in isolation
 *     (no upstream E-RI-002 blocker), produce zero E-SCOPE-001 errors.
 *   - The compiled client JS contains a properly-narrowed `=== null || ===
 *     undefined` check against the reactive cell's member, NOT a bare-ident
 *     reference that would suggest the @-binding was lost.
 *
 * Failure mode this test catches (write-test-always rule, pa.md feedback):
 *   - Regex in preprocessForAcorn drops support for `@`-leading or dotted-member
 *     LHS of `is not` / `is some`.
 *   - Ternary-inside-${} loses reactive-binding rewrite for member-access RHS.
 *   - The downstream ast-builder markup `${...}` processor stops routing the
 *     ternary expression through expression-parser.
 */

import { describe, test, expect } from "bun:test";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "path";
import { writeFileSync, rmSync, existsSync, mkdirSync } from "fs";
import { compileScrml } from "../../src/api.js";

const testDir = dirname(fileURLToPath(new URL(import.meta.url)));
let tmpCounter = 0;

function compileSource(scrmlSource) {
  const tag = `markup-interp-member-is-not-ternary-${++tmpCounter}`;
  const tmpDir = resolve(testDir, `_tmp_${tag}`);
  const tmpInput = resolve(tmpDir, `${tag}.scrml`);
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(tmpInput, scrmlSource);
  try {
    const result = compileScrml({
      inputFiles: [tmpInput],
      write: false,
      outputDir: resolve(tmpDir, "out"),
    });
    let clientJs = null;
    for (const [fp, output] of result.outputs) {
      if (fp.includes(tag)) {
        clientJs = output.clientJs ?? null;
      }
    }
    return { errors: result.errors ?? [], clientJs };
  } finally {
    if (existsSync(tmpInput)) rmSync(tmpInput);
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true });
  }
}

function errsByCode(errors, code) {
  return (errors ?? []).filter((e) => e?.code === code);
}

// ===========================================================================
// §1 — `is not` member-access ternary inside ${} interpolation
// ===========================================================================

describe("A1 — `@expr.member is not` ternary in ${} markup interpolation", () => {
  test("§1.1 single-property is-not ternary fires no E-SCOPE-001", () => {
    const src = `<program>
  \${
    <currentLoad> = not
  }
  <body>
    <div>\${@currentLoad.origin_address is not ? "" : @currentLoad.origin_address}</div>
  </body>
</program>
`;
    const { errors, clientJs } = compileSource(src);
    expect(errsByCode(errors, "E-SCOPE-001")).toEqual([]);
    // Reactive-binding integrity: the compiled JS must read currentLoad through
    // the reactive-cell accessor on BOTH branches of the ternary.
    expect(clientJs).toContain('_scrml_reactive_get("currentLoad").origin_address');
    // The `is not` lowering must produce a null/undefined narrowing check, not
    // a stray reference to a bare identifier or a placeholder leak.
    //
    // Phase B-2 (2026-05-17): non-trivial LHS (member access) is now wrapped
    // in a single-eval IIFE per SPEC §42.2.4 line 18436. The emitted absence
    // check now binds against the IIFE local `__scrml_is_v` instead of
    // re-inlining `origin_address` twice. The narrowing-check shape is now:
    //   `((__scrml_is_v) => __scrml_is_v === null || __scrml_is_v === undefined)(<lhs>)`
    expect(clientJs).toMatch(/__scrml_is_v === null \|\| __scrml_is_v === undefined/);
    expect(clientJs).not.toContain("__scrml_is_not__");
  });

  test("§1.2 all sixteen trucking-dispatch repro sites compile clean in isolation", () => {
    // Composite repro covering every cited brief site. State declarations match
    // the originals: `<currentLoad>`, `<currentCustomer>`, `<assignment>`.
    const src = `<program>
  \${
    <currentLoad> = not
    <currentCustomer> = not
    <assignment> = not
  }
  <body>
    <!-- profile.scrml:178 -->
    <div>\${@currentCustomer.created_at is not ? "—" : @currentCustomer.created_at.substring(0, 10)}</div>

    <!-- customer/load-detail.scrml:395, 402 — driver/load-detail.scrml:636, 641 -->
    <div>\${@currentLoad.origin_address is not ? "" : @currentLoad.origin_address}</div>
    <div>\${@currentLoad.destination_address is not ? "" : @currentLoad.destination_address}</div>

    <!-- customer/load-detail.scrml:429, 432, 433, 439, 442 -->
    <div>\${@assignment.tractor_unit is not ? "—" : @assignment.tractor_unit}</div>
    <div>\${@assignment.tractor_make is not ? "" : @assignment.tractor_make}</div>
    <div>\${@assignment.tractor_model is not ? "" : @assignment.tractor_model}</div>
    <div>\${@assignment.trailer_unit is not ? "—" : @assignment.trailer_unit}</div>
    <div>\${@assignment.trailer_type is not ? "" : @assignment.trailer_type}</div>

    <!-- customer/load-detail.scrml:555, 561 — driver/load-detail.scrml:630, 631 -->
    <div>\${@currentLoad.customer_contact is not ? "" : @currentLoad.customer_contact}</div>
    <div>\${@currentLoad.customer_phone is not ? "" : @currentLoad.customer_phone}</div>
  </body>
</program>
`;
    const { errors, clientJs } = compileSource(src);
    expect(errsByCode(errors, "E-SCOPE-001")).toEqual([]);
    // Every member access in the brief sites must surface as a reactive-cell
    // read on BOTH branches; count is 2 sites × 10 ternaries = 20 reads.
    // Allow >=18 to tolerate emitter dedup; primary signal is "no bare idents".
    const reactiveReadCount =
      (clientJs.match(/_scrml_reactive_get\("(currentLoad|currentCustomer|assignment)"\)\./g) ?? []).length;
    expect(reactiveReadCount).toBeGreaterThanOrEqual(18);
  });

  test("§1.3 `is some` mirror form compiles clean (driver/home.scrml:345,367 shape)", () => {
    const src = `<program>
  \${
    <assignment> = not
  }
  <body>
    <div>\${@assignment.driver_location is some ? @assignment.driver_location : "n/a"}</div>
  </body>
</program>
`;
    const { errors, clientJs } = compileSource(src);
    expect(errsByCode(errors, "E-SCOPE-001")).toEqual([]);
    expect(clientJs).toContain('_scrml_reactive_get("assignment").driver_location');
    // `is some` lowering produces an `!== null && !== undefined` shape (or the
    // existing equivalent the emitter chooses). Either way, no placeholder leak.
    expect(clientJs).not.toContain("__scrml_is_some__");
  });

  test("§1.4 deeper member chain (`@cell.a.b is not`) fires no E-SCOPE-001", () => {
    const src = `<program>
  \${
    <user> = not
  }
  <body>
    <div>\${@user.profile.email is not ? "" : @user.profile.email}</div>
  </body>
</program>
`;
    const { errors, clientJs } = compileSource(src);
    expect(errsByCode(errors, "E-SCOPE-001")).toEqual([]);
    expect(clientJs).toContain('_scrml_reactive_get("user").profile.email');
  });
});
