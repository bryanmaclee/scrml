/**
 * S385 — `<each>` OPENER-EXPRESSION undeclared-read: `in=` / `of=` / `key=`.
 *
 * All three opener slots are captured by the same `_captureAttrValue` raw-text
 * path and lowered by codegen without ever reaching the typer, so all three
 * leaked undeclared reads. They differ in FAILURE MODE and in SCOPE:
 *
 *   slot    lowers to                              failure when undeclared
 *   ------  -------------------------------------  --------------------------
 *   in=     `_scrml_reactive_get("typo")`          list renders EMPTY, forever
 *   of=     `Array.from({length: Number(typo)…})`  zero repeats (of= is a COUNT,
 *                                                  not a second iterable)
 *   key=    `(r, _scrml_each_idx) => typo`         ReferenceError on FIRST
 *                                                  RENDER — takes the page down
 *
 *   slot    evaluated                    so it is checked
 *   ------  ---------------------------  -----------------------------------
 *   in=/of= once, before any row exists  BEFORE the per-item scope push
 *   key=    per item, row var in scope   AFTER the push and the `as` bindings
 *
 * That ordering split is load-bearing in BOTH directions and is pinned by
 * ORDERING TRAP A/B (§3) and ORDERING TRAP C (§5).
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
    // NO ASSERTION ON EMITTED JS HERE, DELIBERATELY. An earlier revision of this
    // test asserted the emitted client did not contain
    // `_scrml_reactive_get("totallyUndeclaredName")`. That assertion was
    // VACUOUS: chunk-cell-scoping emits `_scrml_cs_reactive_get(...)`, which
    // does not contain the substring `_scrml_reactive_get(`, so it passed
    // against output that still carried the bad lowering verbatim. It also
    // tested the wrong artifact — codegen runs regardless of TS errors, and the
    // CLI writes artifacts even on a failed compile (verified: exit 1, files
    // still written). The DIAGNOSTIC is the contract; the emitted text is not.
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
  // CODE-AGNOSTIC BY DESIGN. Asserts NO `E-` diagnostic at all, not just
  // E-STATE-UNDECLARED. `checkLogicExprIdents` also fires E-SCOPE-001 (bare
  // undeclared ident, and the "missing `@` sigil" variant), E-SCOPE-012
  // (`session` outside a server fn body), and - via `checkRowFieldAccessInExpr`
  // - E-TYPE-004. Filtering on one code would let a future edit that makes
  // `in=@rows.filter(n => n > 1)` fire E-SCOPE-001 on the ARROW PARAM pass every
  // case in this block green, which is precisely the regression this block
  // exists to catch. Given this file's own premise - over-firing is worse than
  // the false negative it closes - the assertion has to be code-agnostic.
  function expectNoErrors(r, label) {
    const errs = [...r.errors, ...r.warnings]
      .filter((d) => String(d.code).startsWith("E-"));
    expect({ label, errors: errs.map((d) => `${d.code}: ${d.message}`) })
      .toEqual({ label, errors: [] });
  }

  test("`in=@rows` over a declared structural cell", () => {
    expectNoErrors(compileSource(
      `<program>
  <rows> = [1, 2, 3]
  <each in=@rows as x><li>\${x}</li></each>
</program>
`,
      "ok-declared-cell.scrml",
    ), "declared cell");
  });

  test("`in=@rows.filter(n => n > 1)` — a call chain with an ARROW PARAM does not false-fire on the param", () => {
    expectNoErrors(compileSource(
      `<program>
  <rows> = [1, 2, 3]
  <each in=@rows.filter(n => n > 1) as x><li>\${x}</li></each>
</program>
`,
      "ok-call-arrow.scrml",
    ), "call + arrow param");
  });

  test("`in=[1, 2, 3]` — an inline array literal has no reads at all", () => {
    expectNoErrors(compileSource(
      `<program>
  <each in=[1, 2, 3] as x><li>\${x}</li></each>
</program>
`,
      "ok-array-literal.scrml",
    ), "array literal");
  });

  test("`@.` — the §17.7.3 contextual iteration sigil is NOT a cell read", () => {
    expectNoErrors(compileSource(
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
    expectNoErrors(compileSource(
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
    expectNoErrors(compileSource(
      `<program>
  <m> = { a: 1, b: 2 }
  <each in=@m.entries() as (k, v)><li>\${k}: \${v}</li></each>
</program>
`,
      "ok-tuple-destructure.scrml",
    ), "2-name destructure");
  });

  test("an `@_`-prefixed / ambient read is exempt (walker-inherited exemption)", () => {
    expectNoErrors(compileSource(
      `<program>
  <each in=@_internalRows as x><li>\${x}</li></each>
</program>
`,
      "ok-underscore-exempt.scrml",
    ), "@_ prefixed");
  });
});

// =============================================================================
// §4 — `key=`: the same hole, one slot over, with a WORSE failure mode
// =============================================================================
//
// `keyExprRaw` is captured by the same `_captureAttrValue` raw-text path as
// `inExprRaw` and lowered by codegen without reaching the typer. But where an
// undeclared `in=` renders an EMPTY list, an undeclared `key=` lowers to
// `(r, _scrml_each_idx) => undeclaredName` — a bare reference to an identifier
// that does not exist. That is a ReferenceError on FIRST RENDER: it takes the
// whole page down, not one list.
//
// ORDERING IS THE MIRROR OF `in=`. The key expression is evaluated PER ITEM,
// with the row variable bound as a function parameter, so it is checked AFTER
// the per-item scope push. Checking it alongside `in=`/`of=` (i.e. before the
// push) would false-fire on the documented `key=r.id` row-variable form — an
// over-fire, which this file's premise ranks as worse than the false negative.
describe("§4 — an undeclared `key=` expression on the `<each>` opener fires", () => {
  test("`key=undeclaredBareKey` — was a clean exit-0 compile emitting a ReferenceError", () => {
    const r = compileSource(
      `<program>
  <rows> = [1, 2, 3]
  <each in=@rows key=undeclaredBareKey as r><li>\${r}</li></each>
</program>
`,
      "key-bare-undeclared.scrml",
    );
    const errs = r.errors.filter((d) => String(d.message).includes("undeclaredBareKey"));
    expect(errs.length).toBeGreaterThan(0);
    // Not asserted on emitted JS — see the note in §1. Codegen still lowers the
    // key to `(r, _scrml_each_idx) => undeclaredBareKey` because codegen runs
    // regardless of TS errors; what changed is that the compile now REPORTS,
    // and so a build gate stops before that JS is ever loaded.
  });

  test("`key=@undeclaredAtKey` — the `@` form fires E-STATE-UNDECLARED, not a lowering crash", () => {
    const r = compileSource(
      `<program>
  <rows> = [1, 2, 3]
  <each in=@rows key=@undeclaredAtKey as r><li>\${r}</li></each>
</program>
`,
      "key-at-undeclared.scrml",
    );
    const hits = diagsByCode(r, "E-STATE-UNDECLARED")
      .filter((d) => String(d.message).includes("undeclaredAtKey"));
    expect(hits.length).toBeGreaterThan(0);
    // Before this landing the `@` form reached codegen and died as
    // E-CODEGEN-INVALID-LOGIC ("could not lower this construct") — a crash
    // report, not a diagnostic. It must not regress to that.
    expect(diagsByCode(r, "E-CODEGEN-INVALID-LOGIC").length).toBe(0);
  });
});

describe("§5 — every documented `key=` form still compiles clean", () => {
  function expectNoErrors2(r, label) {
    const errs = [...r.errors, ...r.warnings]
      .filter((d) => String(d.code).startsWith("E-"));
    expect({ label, errors: errs.map((d) => `${d.code}: ${d.message}`) })
      .toEqual({ label, errors: [] });
  }

  test("`key=@.id` — the documented idiom, 22 uses in the corpus", () => {
    expectNoErrors2(compileSource(
      `<program>
  <rows> = [1, 2, 3]
  <each in=@rows key=@.id as r><li>\${r}</li></each>
</program>
`,
      "ok-key-at-dot.scrml",
    ), "key=@.id");
  });

  test("`key=__index__` — the documented positional-fallback sentinel, 13 uses in the corpus", () => {
    // Not a declared identifier anywhere. It survives on the walker's
    // `_`-prefix exemption — which is exactly why the check must go THROUGH the
    // walker rather than re-deriving its own notion of what counts as a read.
    expectNoErrors2(compileSource(
      `<program>
  <rows> = [1, 2, 3]
  <each in=@rows key=__index__ as r><li>\${r}</li></each>
</program>
`,
      "ok-key-index.scrml",
    ), "key=__index__");
  });

  test("ORDERING TRAP C — `key=r.id` resolves against the each's OWN `as r` row binding", () => {
    // The load-bearing case for the placement. `key=` lowers to
    // `(r, _scrml_each_idx) => r.id`, so `r` IS in scope for it. Checking `key=`
    // in the same pre-push group as `in=`/`of=` would report `r` undeclared.
    expectNoErrors2(compileSource(
      `<program>
  <rows> = [1, 2, 3]
  <each in=@rows as r key=r.id><li>\${r}</li></each>
</program>
`,
      "ok-key-row-var.scrml",
    ), "key=r.id over the own row binding");
  });

  // GAP-S385-EACH-KEY-DESTRUCTURE — do NOT restore this as a clean-compile case.
  //
  // An earlier revision asserted `<each in=@m.entries() as (k, v) key=k>`
  // compiles clean. It does compile clean — and the JS it emits crashes on first
  // render, TWICE:
  //
  //   (_scrml_each_item, _scrml_each_idx) => k,     // free `k` -> ReferenceError
  //     const _scrml_each_key_1 = k;                // read here...
  //     const k = _scrml_each_item.key;             // ...bound AFTER -> TDZ
  //
  // So the assertion was pinning the exact failure class this whole file exists
  // to close, and the suite was blessing it.
  //
  // THE SCOPE CHECK IS CORRECT HERE; CODEGEN IS NOT. `k` genuinely IS in scope
  // for `key=` (that is ORDERING TRAP C, above, and it is right). The defect is
  // in `emit-each.ts`: `keyFnBody` is computed at ~:3160 and consumed at ~:3164
  // and ~:3172, but `emitDestructureBindingLines` does not run until ~:3184 — so
  // the standalone key arrow closes over a free name, and the item factory reads
  // it one line before it is declared. Narrow: it needs `key=` to REFERENCE a
  // destructure name. Without `key=`, the default key expression does not mention
  // `k`/`v` and the same source emits fine.
  //
  // Left as a todo rather than fixed here: this is a type-system dispatch, and
  // the repair is not a line move. Reordering fixes the `_scrml_each_key_1` read,
  // but the standalone `(item, idx) => k` arrow needs a BODY carrying the
  // bindings (or the key expression rewritten against `item.key`) — an emitted-
  // shape change, not a reorder. Filed for its own landing.
  test.todo("GAP-S385-EACH-KEY-DESTRUCTURE — `as (k, v) key=k` compiles clean but emits a ReferenceError + TDZ (emit-each.ts ~:3160, keyFnBody computed before emitDestructureBindingLines)");
});

// =============================================================================
// §6 — the `of=` slot is checked only when it is LIVE
// =============================================================================
describe("§6 — `iterShape` gates which opener slot is checked", () => {
  test("`of=@undeclared` alone fires (it is the live slot)", () => {
    const r = compileSource(
      `<program>
  <each of=@undeclaredCount as i><li>\${i}</li></each>
</program>
`,
      "of-live-slot.scrml",
    );
    const hits = diagsByCode(r, "E-STATE-UNDECLARED")
      .filter((d) => String(d.message).includes("undeclaredCount"));
    expect(hits.length).toBeGreaterThan(0);
  });

  test("a DEAD `of=` alongside a live `in=` is NOT reported", () => {
    // `in=` and `of=` are mutually exclusive shapes. When both are present the
    // AST builder tie-breaks `iterShape` to `"in"` and codegen lowers `in=`
    // only, so the `of=` text never reaches the output. Raising a scope error
    // about an attribute with no effect on the emitted program would be noise
    // pointing at the wrong thing — the both-present CONFLICT is the diagnostic
    // that belongs here, and it is not this check's to fire.
    const r = compileSource(
      `<program>
  <rows> = [1, 2, 3]
  <each in=@rows of=@deadSlotTypo as r><li>\${r}</li></each>
</program>
`,
      "of-dead-slot.scrml",
    );
    const hits = [...r.errors, ...r.warnings]
      .filter((d) => String(d.message).includes("deadSlotTypo"));
    expect(hits).toEqual([]);
  });
});

// =============================================================================
// §7 — landing note: a forward reference to a LATER `const` now rejects
// =============================================================================
describe("§7 — `in=<later const>` rejects, consistently with its siblings", () => {
  test("`<each in=laterNames>` above the `const` rejects — as `${laterNames}` already did", () => {
    // NEWLY-REJECTING, and outside the swept corpus (zero corpus hits). It is
    // recorded here rather than left implicit because it is a behaviour change
    // an adopter could hit. It is CONSISTENCY, not a new rule: the identical
    // forward reference already rejected in a `${...}` interpolation and in
    // `<tableFor in=…>`. Reactive CELLS hoist to file scope (§6.9, and the
    // typer pre-binds them for exactly this reason); a `const` in a `${}` logic
    // body does not.
    const src = (body) => `<program>
  ${body}
  \${
    const laterNames = ["a", "b"]
  }
</program>
`;
    const eachForm = compileSource(
      src(`<each in=laterNames as nm><li>\${nm}</li></each>`),
      "later-const-each.scrml",
    );
    const interpForm = compileSource(
      src(`<div>\${laterNames}</div>`),
      "later-const-interp.scrml",
    );
    const eachCodes = eachForm.errors
      .filter((d) => String(d.message).includes("laterNames")).map((d) => d.code);
    const interpCodes = interpForm.errors
      .filter((d) => String(d.message).includes("laterNames")).map((d) => d.code);
    expect(eachCodes.length).toBeGreaterThan(0);
    expect(interpCodes.length).toBeGreaterThan(0);
    // Same code, same mistake — that is the point.
    expect(new Set(eachCodes)).toEqual(new Set(interpCodes));
  });

  test("a reactive CELL declared later still resolves (cells hoist; consts do not)", () => {
    const r = compileSource(
      `<program>
  <each in=@laterCell as x><li>\${x}</li></each>
  <laterCell> = [1, 2, 3]
</program>
`,
      "later-cell-hoists.scrml",
    );
    const errs = [...r.errors, ...r.warnings]
      .filter((d) => String(d.code).startsWith("E-"));
    expect(errs.map((d) => `${d.code}: ${d.message}`)).toEqual([]);
  });
});

// =============================================================================
// §8 — a read sitting BESIDE a `@.` sigil is still checked
// =============================================================================
//
// The `<match on=>` precedent this check was modelled on bails on the whole raw
// when it starts with `@.`. Copying that bail here was wrong: on `<each>` a
// leading `@.` is common, and the bail skipped the ENTIRE opener expression
// rather than the sigil sub-read — so any cell read beside it went unchecked and
// the mistake surfaced from codegen as E-CODEGEN-INVALID-LOGIC instead of naming
// the cell. The sigil is exempted inside the shared walker, where it belongs.
describe("§8 — the `@.` sigil does not shield the rest of the expression", () => {
  test("`key=@.id + @typo` names the undeclared cell (was an E-CODEGEN-INVALID-LOGIC crash)", () => {
    const r = compileSource(
      `<program>
  <rows> = [1, 2, 3]
  <each in=@rows key=@.id + @hiddenKeyTypo as r><li>\${r}</li></each>
</program>
`,
      "atdot-key-beside.scrml",
    );
    const hits = diagsByCode(r, "E-STATE-UNDECLARED")
      .filter((d) => String(d.message).includes("hiddenKeyTypo"));
    expect(hits.length).toBeGreaterThan(0);
    expect(diagsByCode(r, "E-CODEGEN-INVALID-LOGIC").length).toBe(0);
  });

  test("`in=@.rows.concat(@typo)` names the undeclared cell", () => {
    const r = compileSource(
      `<program>
  <rows> = [1, 2, 3]
  <each in=@.rows.concat(@hiddenTypoCell) as r><li>\${r}</li></each>
</program>
`,
      "atdot-in-beside.scrml",
    );
    const hits = diagsByCode(r, "E-STATE-UNDECLARED")
      .filter((d) => String(d.message).includes("hiddenTypoCell"));
    expect(hits.length).toBeGreaterThan(0);
  });

  test("the `@.`-only forms stay clean — no over-fire from dropping the bail", () => {
    const cases = [
      ["keyId", `<each in=@rows key=@.id as r><li>\${r}</li></each>`],
      ["keyEmail", `<each in=@rows key=@.email as r><li>\${r}</li></each>`],
      ["bodySigil", `<each in=@rows><li>\${@.}</li></each>`],
    ];
    for (const [label, opener] of cases) {
      const r = compileSource(
        `<program>
  <rows> = [1, 2, 3]
  ${opener}
</program>
`,
        `atdot-clean-${label}.scrml`,
      );
      const errs = [...r.errors, ...r.warnings]
        .filter((d) => String(d.code).startsWith("E-"));
      expect({ label, errors: errs.map((d) => d.code) }).toEqual({ label, errors: [] });
    }
  });
});

// =============================================================================
// §9 — `${…}` IS NOT A WORKING OPENER FORM, AND THIS CHECK DOES NOT COVER IT
// =============================================================================
//
// THIS SECTION REPLACES AN EARLIER ONE THAT PINNED THE OPPOSITE, AND THE REASON
// IS THE WHOLE R4 FINDING. Round 3 scanned the opener's RAW TEXT for `${ … }`
// interpolation bodies and scope-checked those instead of the whole value. §9
// then pinned "a multi-interpolation opener checks every `${…}`" — a property
// that reads like added coverage and is not, because the construct it describes
// CANNOT COMPILE IN THE FIRST PLACE.
//
// MEASURED ON `origin/main` BY COMPILING THROUGH THE CLI — three spellings, all
// three REJECTED with `E-CODEGEN-INVALID-LOGIC` and no output written:
//     <each in=${@rows} as r>              -> FAILED, 1 error
//     <each in=@rows as r key=${r}>        -> FAILED, 1 error
//     <each in=@rows as r key=${@a}-${r}>  -> FAILED, 1 error
// So the text scan bought ZERO coverage while causing a false POSITIVE on
// `in=@rows.map(r => `id-${r}`)` (it reached inside a lambda body the shared
// walker deliberately skips) and a false NEGATIVE on
// `in=@undeclaredHidden.map(x => `${1}`)` (its targets list REPLACED the whole
// value rather than adding to it). Deleting it closes both.
//
// ⚠ READ THE NEXT PARAGRAPH BEFORE COMPARING THIS SECTION TO `main` — THE TWO
// HARNESSES DO NOT MEASURE THE SAME THING, AND THAT DIVERGENCE IS WHY AN EARLIER
// REVIEW ROUND DISAGREED WITH ITSELF ABOUT WHETHER THIS SHAPE COMPILES.
// `E-CODEGEN-INVALID-LOGIC` on these shapes comes from the emitted-JS parse gate
// in `api.js`, and that gate lives inside `if (write && outputDir)`. This file's
// `compileSource` passes `write: false`, so THE GATE NEVER RUNS HERE. Measured
// on `main` through THIS harness, all four shapes below come back CLEAN — the
// programmatic API silently accepts source whose emitted JS does not parse.
// (Filed as a separate gap; see the report. It is not this arc's to fix.)
//
// THAT MAKES THE ACCEPT/REJECT DIRECTION OF THIS ARC STRICTLY CORRECT. Rejecting
// at the TYPE-SYSTEM stage closes the silent-accept in every `write:false`
// consumer — the LSP among them — not just in the CLI, which already caught it
// one stage later. The MESSAGE is still wrong (see the `test.todo`); the
// direction is not.
//
// WHAT IS PINNED HERE IS THE PROPERTY THAT ACTUALLY MATTERS: the form is
// REJECTED, not silently accepted. Deliberately CODE-AGNOSTIC — which stage
// rejects it is not this check's contract, and asserting the code would make
// this test a tripwire on an unrelated arc. See the `test.todo` below for the
// honest diagnostic, which is a separate piece of work.
describe("§9 — an interpolated `${…}` opener value is rejected, not silently accepted", () => {
  const INTERP_OPENERS = [
    ["in", `<each in=\${@rows} as r><li>\${r}</li></each>`],
    ["keySingle", `<each in=@rows as r key=\${r}><li>\${r}</li></each>`],
    ["keyMulti", `<each in=@rows as r key=\${@a}-\${r}><li>\${r}</li></each>`],
    ["keyMultiWithTypo", `<each in=@rows as r key=\${@a}-\${@hiddenSecondTypo}><li>\${r}</li></each>`],
  ];

  for (const [label, opener] of INTERP_OPENERS) {
    test(`\`${label}\` — an interpolated opener fails the compile`, () => {
      const r = compileSource(
        `<program>
  <a> = 1
  <rows> = [1, 2]
  ${opener}
</program>
`,
        `interp-opener-${label}.scrml`,
      );
      const errs = [...r.errors, ...r.warnings]
        .filter((d) => String(d.code).startsWith("E-"));
      // At least one hard error. NOT a specific code — see the header note.
      expect({ label, errorCount: errs.length > 0 })
        .toEqual({ label, errorCount: true });
    });
  }

  // A BACKTICK TEMPLATE IS A DIFFERENT THING FROM A BARE `${…}`, AND THE
  // DISTINCTION IS WHY THE ABOVE COSTS NOTHING. A real template literal is
  // valid JS, parses, and the walker descends it — so an undeclared read inside
  // one IS still named. Only the UNQUOTED `${…}`, which is not a JS expression
  // under any spelling, degrades to the `$` message.
  test("a backtick template in `key=` still names an undeclared read inside it", () => {
    const r = compileSource(
      `<program>
  <rows> = [1, 2]
  <each in=@rows as r key=\`row-\${@templateHiddenTypo}\`><li>\${r}</li></each>
</program>
`,
      "template-literal-key-typo.scrml",
    );
    const hits = diagsByCode(r, "E-STATE-UNDECLARED")
      .filter((d) => String(d.message).includes("templateHiddenTypo"));
    expect(hits.length).toBeGreaterThan(0);
  });

  // THE HONEST DIAGNOSTIC IS MISSING AND NEITHER SPELLING NAMES THE MISTAKE.
  // Through the CLI on `origin/main` an interpolated opener reports
  // E-CODEGEN-INVALID-LOGIC ("the compiler could not lower this construct to
  // valid output"); with the whole-value parse this arc lands, the TS stage
  // rejects first and reports E-SCOPE-001 "Undeclared identifier `$`". BOTH are
  // placeholders: neither says *`${…}` is not an opener form — write the
  // expression directly*. Recorded here rather than left to be rediscovered.
  test.todo("GAP-S385-EACH-OPENER-INTERPOLATION — `<each in=${…}>` / `key=${…}` should say \"not a valid opener form\"; today it says E-CODEGEN-INVALID-LOGIC (CLI, main) or E-SCOPE-001 on `$` (post-r4)");

  // AND THE HARNESS DIVERGENCE ITSELF IS A GAP, NOT A TEST-FILE QUIRK.
  test.todo("GAP-S385-VALIDATE-EMIT-SKIPPED-WHEN-WRITE-FALSE — `compileScrml({write:false})` skips the emitted-JS parse gate (api.js, the gate is inside `if (write && outputDir)`), so every unit test on that harness is blind to E-CODEGEN-INVALID-LOGIC");
});

// =============================================================================
// §10 — ADVERSARIAL SHAPE SET. A CLEAN CORPUS DIFFERENTIAL IS NOT SUFFICIENT.
// =============================================================================
//
// WHY THIS SECTION EXISTS, AND IT IS NOT A STYLE PREFERENCE. Round 3 measured
// its corpus impact at 0 newly-failing of 1005 files, positive-controlled, and
// that measurement was CORRECT AND STILL MISSED A HIGH FALSE POSITIVE. No file
// in the corpus happens to put a template literal inside an `<each in=>` lambda,
// so the differential could not see it.
//
// That is the coverage-removal blind spot in general form: THE INPUTS THAT WOULD
// TRIP A NEWLY-REJECTING CHANGE ARE PRECISELY THE ONES NOBODY HAS WRITTEN YET.
// A corpus differential measures BLAST RADIUS over existing artifacts; it cannot
// measure the shape space a new rejection now closes. Compounding it here: the
// corpus is ~100% LLM-authored, so its ergonomic diversity is far narrower than
// what a person writing scrml by hand produces.
//
// So the safety claim for a rejecting change is TWO-PART:
//   (1) corpus differential clean — necessary, NOT sufficient; and
//   (2) an enumerated adversarial shape set, each shape a fixture, each asserted
//       to compile with ZERO `E-` diagnostics.
// Every case below is code-agnostic on purpose (same rationale as §3): a future
// edit that makes any of these fire ANY error must turn this file red.
describe("§10 — adversarial opener shapes that must not false-fire", () => {
  function expectNoErrors3(r, label) {
    const errs = [...r.errors, ...r.warnings]
      .filter((d) => String(d.code).startsWith("E-"));
    expect({ label, errors: errs.map((d) => `${d.code}: ${d.message}`) })
      .toEqual({ label, errors: [] });
  }

  // Each entry is [label, <program> body]. The body carries its own declarations
  // so a shape can bring whatever cells it needs.
  const SHAPES = [
    // ---- lambda bodies: expression form and block form ---------------------
    ["lambda-expression-body",
      `<rows> = [1, 2, 3]
  <each in=@rows.filter(n => n > 1) as x><li>\${x}</li></each>`],
    ["lambda-block-body",
      `<rows> = [1, 2, 3]
  <each in=@rows.filter(n => { return n > 1 }) as x><li>\${x}</li></each>`],
    ["lambda-block-body-multi-statement",
      `<rows> = [1, 2, 3]
  <each in=@rows.filter(n => { const keep = n > 1; return keep }) as x><li>\${x}</li></each>`],

    // ---- F1: a template literal NESTED INSIDE a lambda ---------------------
    // The exact round-3 false positive. The raw scan reached into the lambda
    // body and reported `r` as an outer-scope read.
    ["template-literal-inside-lambda",
      `<rows> = [1, 2, 3]
  <each in=@rows.map(r => \`id-\${r}\`) as x><li>\${x}</li></each>`],
    ["template-literal-inside-lambda-dotted",
      `<rows> = [1, 2, 3]
  <each in=@rows.map(r => \`row-\${r.id}-\${r.name}\`) as x><li>\${x}</li></each>`],

    // ---- a template literal at the TOP of the opener, reading a real cell ---
    ["template-literal-top-level-reading-a-cell",
      `<rows> = [1, 2, 3]
  <prefix> = "p"
  <each in=@rows.map(r => \`\${@prefix}-\${r}\`) as x><li>\${x}</li></each>`],

    // ---- destructured lambda params ---------------------------------------
    ["lambda-array-destructure-param",
      `<pairs> = [[1, 2], [3, 4]]
  <each in=@pairs.map(([k, v]) => k + v) as x><li>\${x}</li></each>`],
    ["lambda-object-destructure-param",
      `<rows> = [1, 2, 3]
  <each in=@rows.map(({ id }) => id) as x><li>\${x}</li></each>`],
    ["lambda-object-destructure-renamed",
      `<rows> = [1, 2, 3]
  <each in=@rows.map(({ id: rowId }) => rowId) as x><li>\${x}</li></each>`],
    ["lambda-rest-param",
      `<rows> = [1, 2, 3]
  <each in=@rows.map((...args) => args[0]) as x><li>\${x}</li></each>`],
    ["lambda-two-params-reduce",
      `<rows> = [1, 2, 3]
  <each in=@rows.reduce((acc, cur) => acc.concat(cur), []) as x><li>\${x}</li></each>`],

    // ---- a lambda param that SHADOWS a declared cell name ------------------
    ["lambda-param-shadowing-a-cell-name",
      `<rows> = [1, 2, 3]
  <each in=@rows.map(rows => rows + 1) as x><li>\${x}</li></each>`],

    // ---- the `as`-alias referenced in `key=` -------------------------------
    ["as-alias-in-key",
      `<rows> = [1, 2, 3]
  <each in=@rows as r key=r.id><li>\${r}</li></each>`],
    ["as-alias-in-key-inside-a-template-literal",
      `<rows> = [1, 2, 3]
  <each in=@rows as r key=\`row-\${r.id}\`><li>\${r}</li></each>`],
    ["as-alias-in-key-call-chain",
      `<rows> = [1, 2, 3]
  <each in=@rows as r key=r.tags.join("-")><li>\${r}</li></each>`],

    // ---- `@.` and `@.field` ------------------------------------------------
    ["at-dot-bare-in-key",
      `<rows> = [1, 2, 3]
  <each in=@rows key=@.id as r><li>\${r}</li></each>`],
    ["at-dot-field-in-in",
      `<outer> = [1, 2]
  <each in=@outer as o><ul><each in=@.rows as r><li>\${r}</li></each></ul></each>`],

    // ---- long method chains ------------------------------------------------
    ["long-method-chain",
      `<rows> = [1, 2, 3]
  <each in=@rows.filter(a => a > 0).map(b => b * 2).slice(0, 3) as x><li>\${x}</li></each>`],
    ["long-method-chain-with-a-template-literal-limb",
      `<rows> = [1, 2, 3]
  <each in=@rows.filter(a => a > 0).map(b => \`n-\${b}\`).slice(0, 3) as x><li>\${x}</li></each>`],

    // ---- a nested each whose inner opener reads the OUTER alias ------------
    ["nested-each-inner-in-reads-outer-alias",
      `<groups> = [1, 2]
  <each in=@groups as g><ul><each in=g.items as it><li>\${it}</li></each></ul></each>`],
    ["nested-each-inner-key-reads-outer-alias",
      `<groups> = [1, 2]
  <each in=@groups as g><ul><each in=g.items as it key=g.id + it.id><li>\${it}</li></each></ul></each>`],
    ["nested-each-inner-lambda-reads-outer-alias",
      `<groups> = [1, 2]
  <each in=@groups as g><ul><each in=g.items.filter(i => i.gid === g.id) as it><li>\${it}</li></each></ul></each>`],

    // ---- `of=` count form with an expression -------------------------------
    ["of-count-plain-cell",
      `<n> = 3
  <each of=@n as i><li>\${i}</li></each>`],
    ["of-count-arithmetic",
      `<n> = 3
  <each of=@n + 1 as i><li>\${i}</li></each>`],
    ["of-count-length-of-a-cell",
      `<rows> = [1, 2, 3]
  <each of=@rows.length as i><li>\${i}</li></each>`],
    ["of-count-with-a-lambda",
      `<rows> = [1, 2, 3]
  <each of=@rows.filter(n => n > 1).length as i><li>\${i}</li></each>`],

    // ---- assorted expression forms the walker must tolerate ---------------
    ["ternary-iterable",
      `<flag> = true
  <a> = [1]
  <b> = [2]
  <each in=@flag ? @a : @b as x><li>\${x}</li></each>`],
    ["array-literal-iterable",
      `<each in=[1, 2, 3] as x><li>\${x}</li></each>`],
    ["global-in-a-chain",
      `<rows> = [1, 2, 3]
  <each in=@rows.map(r => r.id).filter(Boolean) as x><li>\${x}</li></each>`],
    ["optional-chain-iterable",
      `<box> = 0
  <each in=@box?.rows as x><li>\${x}</li></each>`],
    ["two-name-destructure-opener",
      `<m> = 0
  <each in=@m.entries() as (k, v)><li>\${k}\${v}</li></each>`],
  ];

  for (const [label, body] of SHAPES) {
    test(`\`${label}\` compiles with zero E- diagnostics`, () => {
      expectNoErrors3(
        compileSource(`<program>\n  ${body}\n</program>\n`, `adversarial-${label}.scrml`),
        label,
      );
    });
  }
});
