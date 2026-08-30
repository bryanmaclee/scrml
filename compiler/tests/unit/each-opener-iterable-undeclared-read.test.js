/**
 * S385 — `<each in=@x>` / `<each of=@x>` opener-iterable undeclared-read.
 *
 * SPEC §6.1.2 (the governing sentence, SPEC.md:2081):
 *
 *   > Read: `@varname` evaluates to the cell's current value. A structural
 *   > `<varname>` declaration (§6.1.1) — or an equivalently-resolved cell: an
 *   > `<each>`/`<tableFor>` loop local, an engine state cell (§51.0.C /
 *   > §51.0.H), a CE-inlined cross-file channel cell (§38.12), or an import
 *   > binding — SHALL be in scope; otherwise the read is `E-STATE-UNDECLARED`.
 *
 * That sentence does not scope by POSITION. An `<each in=@name>` where `name`
 * resolves to nothing is a read, and it SHALL fire. Before this landing it did
 * not: the compile was CLEAN, exit 0, and codegen lowered the typo to a live
 * `_scrml_reactive_get("<typo>")` that returns undefined, so the list rendered
 * EMPTY, forever, with zero diagnostic. A false NEGATIVE against the same
 * sentence the sibling `E-STATE-UNDECLARED` defects violated as false positives.
 *
 * WHY IT LEAKED. `<each>` is not a `kind:"markup"` node — the block splitter
 * raw-captures it and the AST builder rebuilds the opener by regexing NAMED
 * attributes out of the header. The node has no `attrs` array, so the markup
 * walk's `for (const attr of n.attrs)` loop (which is what feeds `visitAttr`,
 * the E-SCOPE-001 attribute-scope checker) reaches NOTHING on it. The iterable
 * survives only as raw text (`inExprRaw` / `ofExprRaw`).
 *
 * THE FIX IS THE SIBLING'S. `<match on=@cell>` had this identical gap for the
 * identical reason (ss42 item-2, §18.0.1 / §34) and closed it by parsing its own
 * raw and feeding it to `checkLogicExprIdents` — the SAME read-side walker a
 * `${@x}` interpolation uses. This is that, one node family over. Reusing the
 * walker instead of writing a second predicate is the whole point: a second
 * predicate can drift from the first, and drift is the defect class this
 * project keeps closing.
 *
 * §3 is the load-bearing half. Over-firing here is WORSE than the false
 * negative, so the no-regression cases pin every legitimate opener shape —
 * including the two ordering traps: the check runs BEFORE the per-item scope
 * push (or `in=x` would resolve against the loop's own `as x` binding and stay
 * silent), and a NESTED each's `in=` must still resolve against the OUTER each's
 * row binding (which requires the check to run INSIDE the outer scope).
 *
 * Harness: compileScrml on REAL source (mirrors named-machine-undeclared-read-ss42).
 * Diagnostic partition (diagnostic-stream rule): E- codes land in result.errors,
 * W-/I- codes land in result.warnings — so code lookups search BOTH streams.
 */

import { describe, test, expect } from "bun:test";
import { compileScrml } from "../../src/api.js";
import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";

const FIXTURE_DIR = "/tmp/s385-each-opener-iterable-undeclared-fixtures";
mkdirSync(FIXTURE_DIR, { recursive: true });

function compileSource(source, filename) {
  const filePath = join(FIXTURE_DIR, filename);
  writeFileSync(filePath, source);
  const result = compileScrml({
    inputFiles: [filePath],
    outputDir: join(FIXTURE_DIR, "dist"),
    write: false,
  });
  const first = [...(result.outputs ?? new Map()).values()][0];
  return {
    errors: result.errors ?? [],
    warnings: result.warnings ?? [],
    clientJs: (first && first.clientJs) || "",
  };
}

// Cross-stream code lookup (diagnostic-partition rule): a W-/I- code lands in
// `warnings`, an E- code in `errors` — search BOTH so a code-only assertion is
// stream-agnostic and cannot silently pass against the wrong partition.
function diagsByCode({ errors, warnings }, code) {
  return [...errors, ...warnings].filter((d) => d.code === code);
}

// =============================================================================
// §1 — the false negative fires
// =============================================================================
describe("§1 — an undeclared `@` read in the `<each>` opener iterable fires E-STATE-UNDECLARED", () => {
  test("`in=@totallyUndeclaredName` — the PA-reproduced case — no longer compiles clean", () => {
    const r = compileSource(
      `<program>
  <ul>
    <each in=@totallyUndeclaredName as x><li>\${x}</li></each>
  </ul>
</program>
`,
      "in-bare-undeclared.scrml",
    );
    const hits = diagsByCode(r, "E-STATE-UNDECLARED");
    expect(hits.length).toBeGreaterThan(0);
    // The diagnostic must NAME the offending cell — a generic "something is
    // undeclared" would not tell the author which typo to fix.
    expect(hits.some((d) => String(d.message).includes("totallyUndeclaredName"))).toBe(true);
    // And the silent-empty lowering must be gone: a failed compile emits no client.
    expect(r.clientJs).not.toContain('_scrml_reactive_get("totallyUndeclaredName")');
  });

  test("`of=@undeclared` — the `of=` twin of the same opener slot fires identically", () => {
    const r = compileSource(
      `<program>
  <each of=@undeclaredOfCell as x><li>\${x}</li></each>
</program>
`,
      "of-bare-undeclared.scrml",
    );
    const hits = diagsByCode(r, "E-STATE-UNDECLARED");
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.some((d) => String(d.message).includes("undeclaredOfCell"))).toBe(true);
  });

  test("`in=@undeclaredObj.items` — a dotted read resolves on the BASE cell, and fires on it", () => {
    const r = compileSource(
      `<program>
  <each in=@undeclaredObj.items as x><li>\${x}</li></each>
</program>
`,
      "in-member-undeclared.scrml",
    );
    const hits = diagsByCode(r, "E-STATE-UNDECLARED");
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.some((d) => String(d.message).includes("undeclaredObj"))).toBe(true);
  });

  test("the diagnostic is anchored on the `<each>` opener line, not the file head", () => {
    const r = compileSource(
      `<program>
  <div>filler</div>
  <div>filler</div>
  <each in=@anchorProbeCell as x><li>\${x}</li></each>
</program>
`,
      "in-anchor.scrml",
    );
    const hits = diagsByCode(r, "E-STATE-UNDECLARED")
      .filter((d) => String(d.message).includes("anchorProbeCell"));
    expect(hits.length).toBeGreaterThan(0);
    // The `<each>` opener is on source line 4.
    expect(hits[0].span?.line).toBe(4);
  });
});

// =============================================================================
// §2 — it is the SAME walker, not a second predicate
// =============================================================================
describe("§2 — the opener read fires the same code a `${@x}` read fires", () => {
  test("`in=@typo` and `${@typo}` produce the SAME diagnostic code", () => {
    const inOpener = compileSource(
      `<program>
  <each in=@sharedTypoName as x><li>\${x}</li></each>
</program>
`,
      "parity-opener.scrml",
    );
    const logicCtx = compileSource(
      `<program>
  <div>\${@sharedTypoName}</div>
</program>
`,
      "parity-logic.scrml",
    );
    const openerCodes = inOpener.errors
      .filter((d) => String(d.message).includes("sharedTypoName"))
      .map((d) => d.code);
    const logicCodes = logicCtx.errors
      .filter((d) => String(d.message).includes("sharedTypoName"))
      .map((d) => d.code);
    expect(openerCodes.length).toBeGreaterThan(0);
    expect(logicCodes.length).toBeGreaterThan(0);
    expect(new Set(openerCodes)).toEqual(new Set(logicCodes));
  });
});

// =============================================================================
// §3 — NO-REGRESSION. Over-firing here is worse than the false negative.
// =============================================================================
describe("§3 — every legitimate opener iterable still compiles clean", () => {
  function expectNoUndeclared(r, label) {
    const hits = diagsByCode(r, "E-STATE-UNDECLARED");
    expect({ label, hits: hits.map((d) => d.message) })
      .toEqual({ label, hits: [] });
  }

  test("`in=@rows` over a declared structural cell", () => {
    expectNoUndeclared(compileSource(
      `<program>
  <rows> = [1, 2, 3]
  <each in=@rows as x><li>\${x}</li></each>
</program>
`,
      "ok-declared-cell.scrml",
    ), "declared cell");
  });

  test("`in=@rows.filter(n => n > 1)` — a call chain with an ARROW PARAM does not false-fire on the param", () => {
    expectNoUndeclared(compileSource(
      `<program>
  <rows> = [1, 2, 3]
  <each in=@rows.filter(n => n > 1) as x><li>\${x}</li></each>
</program>
`,
      "ok-call-arrow.scrml",
    ), "call + arrow param");
  });

  test("`in=[1, 2, 3]` — an inline array literal has no reads at all", () => {
    expectNoUndeclared(compileSource(
      `<program>
  <each in=[1, 2, 3] as x><li>\${x}</li></each>
</program>
`,
      "ok-array-literal.scrml",
    ), "array literal");
  });

  test("`@.` — the §17.7.3 contextual iteration sigil is NOT a cell read", () => {
    expectNoUndeclared(compileSource(
      `<program>
  <rows> = [1, 2, 3]
  <each in=@rows><li>\${@.}</li></each>
</program>
`,
      "ok-at-dot.scrml",
    ), "@. sigil");
  });

  test("ORDERING TRAP A — a NESTED each's `in=` resolves against the OUTER each's `as` binding", () => {
    // The inner opener is evaluated INSIDE the outer per-item scope, so `r` is
    // bound. A check hoisted out of the outer scope would false-fire here.
    expectNoUndeclared(compileSource(
      `<program>
  <rows> = [1, 2, 3]
  <each in=@rows as r>
    <each in=r.kids as k><li>\${k}</li></each>
  </each>
</program>
`,
      "ok-nested-outer-binding.scrml",
    ), "nested inner in= over outer row binding");
  });

  test("ORDERING TRAP B — `in=@x` must NOT be satisfied by the each's OWN `as @x`-shaped binding", () => {
    // `as items` binds `items` in the PER-ITEM scope. The opener iterable is
    // evaluated OUTSIDE that scope, so a same-named `@items` cell that was never
    // declared must still fire. If the check ran AFTER the scope push, the loop
    // local would absorb the lookup and this would silently pass.
    const r = compileSource(
      `<program>
  <each in=@shadowProbe as shadowProbe><li>\${shadowProbe}</li></each>
</program>
`,
      "trap-self-shadow.scrml",
    );
    const hits = diagsByCode(r, "E-STATE-UNDECLARED")
      .filter((d) => String(d.message).includes("shadowProbe"));
    expect(hits.length).toBeGreaterThan(0);
  });

  test("`in=@m.entries() as (k, v)` — the §59.8 2-name destructure opener is unaffected", () => {
    expectNoUndeclared(compileSource(
      `<program>
  <m> = { a: 1, b: 2 }
  <each in=@m.entries() as (k, v)><li>\${k}: \${v}</li></each>
</program>
`,
      "ok-tuple-destructure.scrml",
    ), "2-name destructure");
  });

  test("an `@_`-prefixed / ambient read is exempt (walker-inherited exemption)", () => {
    expectNoUndeclared(compileSource(
      `<program>
  <each in=@_internalRows as x><li>\${x}</li></each>
</program>
`,
      "ok-underscore-exempt.scrml",
    ), "@_ prefixed");
  });
});
