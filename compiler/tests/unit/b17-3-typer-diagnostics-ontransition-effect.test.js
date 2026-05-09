/* SPDX-License-Identifier: MIT
 * Phase A1b Step B17.3 — typer diagnostics for `<onTransition>` + `effect=`.
 *
 * Tests SYM PASS 17 (`walkValidateEngineB17Diagnostics` /
 * `validateEngineB17Diagnostics` in `compiler/src/symbol-table.ts`),
 * which consumes B17.2's parser annotations on `EngineStateChildEntry`:
 *   - `effectRaw: string | null`
 *   - `onTransitionElements: OnTransitionEntry[]`
 *
 * Coverage (per BRIEF §scope-IN, S74 Q1+Q2 ratification — 5 fire-sites):
 *   §B17.3.1  E-ENGINE-EFFECT-AMBIGUOUS — fire-site #1 (effect= on multi-target rule=)
 *   §B17.3.2  E-ENGINE-RULE-INVALID-VARIANT — fire-site #2 (<onTransition to=.X> bad variant)
 *   §B17.3.3  E-ENGINE-RULE-INVALID-VARIANT — fire-site #3 (<onTransition from=.X> bad variant)
 *   §B17.3.4  E-ENGINE-INVALID-TRANSITION — fire-site #4 (<onTransition to=.X> not in rule=)
 *   §B17.3.5  E-ONTRANSITION-NO-TARGET — fire-site #5 (NEW; missing both to= and from=)
 *   §B17.3.6  Composition / regression-guard
 *
 * Source-of-truth: SPEC §51.0.H (lines 20536-20585) + §51.0.F (rule= contract)
 * + §34 rows: E-ENGINE-EFFECT-AMBIGUOUS (existing), E-ENGINE-RULE-INVALID-VARIANT
 * (existing), E-ENGINE-INVALID-TRANSITION (existing), E-ONTRANSITION-NO-TARGET
 * (NEW S74 — A1b B17.3).
 */

import { describe, expect, test } from "bun:test";
import { splitBlocks } from "../../src/block-splitter.js";
import { buildAST } from "../../src/ast-builder.js";
import { runSYM } from "../../src/symbol-table.ts";

// ---------------------------------------------------------------------------
// Helpers (mirror a5-3-typer-walker fixture style)
// ---------------------------------------------------------------------------

function runUpToSYM(source, filePath = "test.scrml") {
  const bs = splitBlocks(filePath, source);
  const { ast } = buildAST(bs);
  return { ast, sym: runSYM({ filePath, ast }) };
}

function errorsByCode(sym, code) {
  return sym.errors.filter((e) => e.code === code);
}

// ---------------------------------------------------------------------------
// §B17.3.1 — E-ENGINE-EFFECT-AMBIGUOUS (fire-site #1, §51.0.H line 20471)
// ---------------------------------------------------------------------------
//
// Predicate: `entry.effectRaw != null && entry.rule.kind === "multi"`.

describe("§B17.3.1 — E-ENGINE-EFFECT-AMBIGUOUS (§51.0.H, fire-site #1)", () => {
  test("effect= on multi-target rule= fires E-ENGINE-EFFECT-AMBIGUOUS", () => {
    const src = `\${ type AppMode:enum = { Idle, Active, Done } }
<engine for=AppMode initial=.Idle>
  <Idle rule=(.Active | .Done) effect=\${ log("leaving idle") }></>
  <Active rule=.Done></>
  <Done></>
</>`;
    const { sym } = runUpToSYM(src);
    const errs = errorsByCode(sym, "E-ENGINE-EFFECT-AMBIGUOUS");
    expect(errs.length).toBe(1);
    expect(errs[0].message).toContain("Idle");
    expect(errs[0].message).toContain("multi-target");
    expect(errs[0].severity).toBe("error");
  });

  test("effect= on single-target rule= does NOT fire", () => {
    const src = `\${ type AppMode:enum = { Idle, Active } }
<engine for=AppMode initial=.Idle>
  <Idle rule=.Active effect=\${ log("activating") }></>
  <Active></>
</>`;
    const { sym } = runUpToSYM(src);
    expect(errorsByCode(sym, "E-ENGINE-EFFECT-AMBIGUOUS").length).toBe(0);
  });

  test("effect= on wildcard rule=* does NOT fire (only kind===\"multi\" fires)", () => {
    const src = `\${ type AppMode:enum = { Idle, A, B } }
<engine for=AppMode initial=.Idle>
  <Idle rule=* effect=\${ log("anywhere") }></>
  <A></>
  <B></>
</>`;
    const { sym } = runUpToSYM(src);
    expect(errorsByCode(sym, "E-ENGINE-EFFECT-AMBIGUOUS").length).toBe(0);
  });

  test("absent effect= does NOT fire even on multi-target rule=", () => {
    const src = `\${ type AppMode:enum = { Idle, A, B } }
<engine for=AppMode initial=.Idle>
  <Idle rule=(.A | .B)></>
  <A></>
  <B></>
</>`;
    const { sym } = runUpToSYM(src);
    expect(errorsByCode(sym, "E-ENGINE-EFFECT-AMBIGUOUS").length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// §B17.3.2 — E-ENGINE-RULE-INVALID-VARIANT for <onTransition to=.X> (fire-site #2)
// ---------------------------------------------------------------------------

describe("§B17.3.2 — E-ENGINE-RULE-INVALID-VARIANT for <onTransition to=.X> (§51.0.H, fire-site #2)", () => {
  test("<onTransition to=.Bogus> with .Bogus not in for=Type fires", () => {
    const src = `\${ type AppMode:enum = { Idle, Active } }
<engine for=AppMode initial=.Idle>
  <Idle rule=.Active>
    <onTransition to=.Bogus>\${ log("x") }</>
  </>
  <Active></>
</>`;
    const { sym } = runUpToSYM(src);
    const errs = errorsByCode(sym, "E-ENGINE-RULE-INVALID-VARIANT");
    expect(errs.length).toBeGreaterThanOrEqual(1);
    const onT = errs.find((e) => e.message.includes("<onTransition to=.Bogus>"));
    expect(onT).toBeTruthy();
    expect(onT.message).toContain("Bogus");
    expect(onT.message).toContain("Idle");
  });

  test("<onTransition to=.Active> with .Active in for=Type does NOT fire", () => {
    const src = `\${ type AppMode:enum = { Idle, Active } }
<engine for=AppMode initial=.Idle>
  <Idle rule=.Active>
    <onTransition to=.Active>\${ log("activating") }</>
  </>
  <Active></>
</>`;
    const { sym } = runUpToSYM(src);
    const errs = errorsByCode(sym, "E-ENGINE-RULE-INVALID-VARIANT");
    // Make sure no <onTransition>-flavored fire occurred.
    const onT = errs.filter((e) => e.message.includes("<onTransition"));
    expect(onT.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// §B17.3.3 — E-ENGINE-RULE-INVALID-VARIANT for <onTransition from=.X> (fire-site #3)
// ---------------------------------------------------------------------------

describe("§B17.3.3 — E-ENGINE-RULE-INVALID-VARIANT for <onTransition from=.X> (§51.0.H, fire-site #3)", () => {
  test("<onTransition from=.Bogus> with .Bogus not in for=Type fires", () => {
    const src = `\${ type AppMode:enum = { Idle, Active } }
<engine for=AppMode initial=.Idle>
  <Idle rule=.Active></>
  <Active>
    <onTransition from=.Bogus>\${ log("from bogus") }</>
  </>
</>`;
    const { sym } = runUpToSYM(src);
    const errs = errorsByCode(sym, "E-ENGINE-RULE-INVALID-VARIANT");
    const onT = errs.find((e) => e.message.includes("<onTransition from=.Bogus>"));
    expect(onT).toBeTruthy();
    expect(onT.message).toContain("Bogus");
    expect(onT.message).toContain("Active");
  });

  test("<onTransition from=.Idle> with .Idle in for=Type does NOT fire", () => {
    const src = `\${ type AppMode:enum = { Idle, Active } }
<engine for=AppMode initial=.Idle>
  <Idle rule=.Active></>
  <Active>
    <onTransition from=.Idle>\${ log("from idle") }</>
  </>
</>`;
    const { sym } = runUpToSYM(src);
    const errs = errorsByCode(sym, "E-ENGINE-RULE-INVALID-VARIANT");
    const onT = errs.filter((e) => e.message.includes("<onTransition"));
    expect(onT.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// §B17.3.4 — E-ENGINE-INVALID-TRANSITION compile-time (fire-site #4)
// ---------------------------------------------------------------------------
//
// Mirrors A5-3 PASS 16 fire-site #3 (`<onTimeout to=.X>` legality vs surrounding
// `rule=`). The from-state IS this state-child; `to=` must be permitted by `rule=`.

describe("§B17.3.4 — E-ENGINE-INVALID-TRANSITION (§51.0.F, fire-site #4)", () => {
  test("<onTransition to=.X> outside single-target rule= fires", () => {
    const src = `\${ type AppMode:enum = { Idle, Active, Done } }
<engine for=AppMode initial=.Idle>
  <Idle rule=.Active>
    <onTransition to=.Done>\${ log("oops") }</>
  </>
  <Active rule=.Done></>
  <Done></>
</>`;
    const { sym } = runUpToSYM(src);
    const errs = errorsByCode(sym, "E-ENGINE-INVALID-TRANSITION");
    expect(errs.length).toBe(1);
    expect(errs[0].message).toContain("<onTransition to=.Done>");
    expect(errs[0].message).toContain("Idle");
    expect(errs[0].message).toContain("rule=.Active");
  });

  test("<onTransition to=.X> matching single-target rule= does NOT fire", () => {
    const src = `\${ type AppMode:enum = { Idle, Active } }
<engine for=AppMode initial=.Idle>
  <Idle rule=.Active>
    <onTransition to=.Active>\${ log("activating") }</>
  </>
  <Active></>
</>`;
    const { sym } = runUpToSYM(src);
    expect(errorsByCode(sym, "E-ENGINE-INVALID-TRANSITION").length).toBe(0);
  });

  test("<onTransition to=.X> in multi-target rule= but X not listed fires", () => {
    const src = `\${ type AppMode:enum = { Idle, A, B, C } }
<engine for=AppMode initial=.Idle>
  <Idle rule=(.A | .B)>
    <onTransition to=.C>\${ log("oops") }</>
  </>
  <A></>
  <B></>
  <C></>
</>`;
    const { sym } = runUpToSYM(src);
    const errs = errorsByCode(sym, "E-ENGINE-INVALID-TRANSITION");
    expect(errs.length).toBe(1);
    expect(errs[0].message).toContain("<onTransition to=.C>");
    expect(errs[0].message).toMatch(/multi-target|\.A.*\.B/);
  });

  test("<onTransition to=.X> in multi-target rule= AND X listed does NOT fire", () => {
    const src = `\${ type AppMode:enum = { Idle, A, B } }
<engine for=AppMode initial=.Idle>
  <Idle rule=(.A | .B)>
    <onTransition to=.A>\${ log("a") }</>
    <onTransition to=.B>\${ log("b") }</>
  </>
  <A></>
  <B></>
</>`;
    const { sym } = runUpToSYM(src);
    expect(errorsByCode(sym, "E-ENGINE-INVALID-TRANSITION").length).toBe(0);
  });

  test("<onTransition to=.X> with rule=* wildcard never fires", () => {
    const src = `\${ type AppMode:enum = { Idle, A, B } }
<engine for=AppMode initial=.Idle>
  <Idle rule=*>
    <onTransition to=.A>\${ log("a") }</>
    <onTransition to=.B>\${ log("b") }</>
  </>
  <A></>
  <B></>
</>`;
    const { sym } = runUpToSYM(src);
    expect(errorsByCode(sym, "E-ENGINE-INVALID-TRANSITION").length).toBe(0);
  });

  test("<onTransition to=.X> in terminal state (no rule=) fires", () => {
    const src = `\${ type AppMode:enum = { Going, Done } }
<engine for=AppMode initial=.Going>
  <Going rule=.Done></>
  <Done>
    <onTransition to=.Going>\${ log("recover?") }</>
  </>
</>`;
    const { sym } = runUpToSYM(src);
    const errs = errorsByCode(sym, "E-ENGINE-INVALID-TRANSITION");
    expect(errs.length).toBe(1);
    expect(errs[0].message).toContain("<onTransition to=.Going>");
    expect(errs[0].message).toContain("Done");
    expect(errs[0].message).toContain("terminal state");
  });

  test("<onTransition from=.X> never triggers fire-site #4 (only to= cases)", () => {
    const src = `\${ type AppMode:enum = { Idle, Active } }
<engine for=AppMode initial=.Idle>
  <Idle rule=.Active></>
  <Active>
    <onTransition from=.Idle>\${ log("arrived") }</>
  </>
</>`;
    const { sym } = runUpToSYM(src);
    expect(errorsByCode(sym, "E-ENGINE-INVALID-TRANSITION").length).toBe(0);
  });

  test("<onTransition to=.Bogus> (non-variant) skips fire-site #4 (fire-site #2 fires instead)", () => {
    const src = `\${ type AppMode:enum = { Idle, Active } }
<engine for=AppMode initial=.Idle>
  <Idle rule=.Active>
    <onTransition to=.Bogus>\${ log("x") }</>
  </>
  <Active></>
</>`;
    const { sym } = runUpToSYM(src);
    // Fire-site #2 fires; fire-site #4 does NOT (don't double-fire on a non-variant)
    expect(errorsByCode(sym, "E-ENGINE-INVALID-TRANSITION").length).toBe(0);
    expect(errorsByCode(sym, "E-ENGINE-RULE-INVALID-VARIANT").length).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// §B17.3.5 — E-ONTRANSITION-NO-TARGET (NEW; fire-site #5)
// ---------------------------------------------------------------------------

describe("§B17.3.5 — E-ONTRANSITION-NO-TARGET (NEW S74 catalog row, fire-site #5)", () => {
  test("<onTransition>...</> with neither to= nor from= fires", () => {
    const src = `\${ type AppMode:enum = { Idle, Active } }
<engine for=AppMode initial=.Idle>
  <Idle rule=.Active>
    <onTransition>\${ log("when?") }</>
  </>
  <Active></>
</>`;
    const { sym } = runUpToSYM(src);
    const errs = errorsByCode(sym, "E-ONTRANSITION-NO-TARGET");
    expect(errs.length).toBe(1);
    expect(errs[0].message).toContain("Idle");
    expect(errs[0].message).toContain("no trigger");
    expect(errs[0].severity).toBe("error");
  });

  test("self-closing <onTransition/> with neither to= nor from= fires", () => {
    const src = `\${ type AppMode:enum = { Idle, Active } }
<engine for=AppMode initial=.Idle>
  <Idle rule=.Active>
    <onTransition/>
  </>
  <Active></>
</>`;
    const { sym } = runUpToSYM(src);
    expect(errorsByCode(sym, "E-ONTRANSITION-NO-TARGET").length).toBe(1);
  });

  test("<onTransition to=.X> alone does NOT fire fire-site #5", () => {
    const src = `\${ type AppMode:enum = { Idle, Active } }
<engine for=AppMode initial=.Idle>
  <Idle rule=.Active>
    <onTransition to=.Active>\${ log("activating") }</>
  </>
  <Active></>
</>`;
    const { sym } = runUpToSYM(src);
    expect(errorsByCode(sym, "E-ONTRANSITION-NO-TARGET").length).toBe(0);
  });

  test("<onTransition from=.X> alone does NOT fire fire-site #5", () => {
    const src = `\${ type AppMode:enum = { Idle, Active } }
<engine for=AppMode initial=.Idle>
  <Idle rule=.Active></>
  <Active>
    <onTransition from=.Idle>\${ log("from idle") }</>
  </>
</>`;
    const { sym } = runUpToSYM(src);
    expect(errorsByCode(sym, "E-ONTRANSITION-NO-TARGET").length).toBe(0);
  });

  test("no-target <onTransition> SKIPS fire-sites #2/#3/#4 (continue after #5)", () => {
    const src = `\${ type AppMode:enum = { Idle, Active } }
<engine for=AppMode initial=.Idle>
  <Idle rule=.Active>
    <onTransition>\${ log("orphan") }</>
  </>
  <Active></>
</>`;
    const { sym } = runUpToSYM(src);
    expect(errorsByCode(sym, "E-ONTRANSITION-NO-TARGET").length).toBe(1);
    expect(errorsByCode(sym, "E-ENGINE-RULE-INVALID-VARIANT").length).toBe(0);
    expect(errorsByCode(sym, "E-ENGINE-INVALID-TRANSITION").length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// §B17.3.6 — Composition / regression-guard
// ---------------------------------------------------------------------------

describe("§B17.3.6 — Composition / regression-guard", () => {
  test("multiple <onTransition> in one body — order-independent fires", () => {
    const src = `\${ type AppMode:enum = { Idle, A, B, C } }
<engine for=AppMode initial=.Idle>
  <Idle rule=.A>
    <onTransition to=.A>\${ log("a") }</>
    <onTransition to=.Bogus>\${ log("bad-variant") }</>
    <onTransition to=.C>\${ log("not-in-rule") }</>
    <onTransition>\${ log("no-target") }</>
  </>
  <A></>
  <B></>
  <C></>
</>`;
    const { sym } = runUpToSYM(src);
    // Fire-site #2 fires once (.Bogus not a variant).
    expect(errorsByCode(sym, "E-ENGINE-RULE-INVALID-VARIANT").length).toBeGreaterThanOrEqual(1);
    // Fire-site #4 fires once (.C is a variant but not in rule=.A).
    const invalidTrans = errorsByCode(sym, "E-ENGINE-INVALID-TRANSITION");
    expect(invalidTrans.length).toBeGreaterThanOrEqual(1);
    expect(invalidTrans.some((e) => e.message.includes(".C"))).toBe(true);
    // Fire-site #5 fires once (no-target).
    expect(errorsByCode(sym, "E-ONTRANSITION-NO-TARGET").length).toBe(1);
  });

  test("effect= AND <onTransition> children co-existing (§51.0.H allowed)", () => {
    // Single-target rule= → effect= legal; all <onTransition to=> matching
    // single-target rule=.A also legal. NO fires expected.
    const src = `\${ type AppMode:enum = { Idle, A } }
<engine for=AppMode initial=.Idle>
  <Idle rule=.A effect=\${ playSound("default") }>
    <onTransition to=.A>\${ log("with handler") }</>
  </>
  <A></>
</>`;
    const { sym } = runUpToSYM(src);
    expect(errorsByCode(sym, "E-ENGINE-EFFECT-AMBIGUOUS").length).toBe(0);
    expect(errorsByCode(sym, "E-ENGINE-INVALID-TRANSITION").length).toBe(0);
    expect(errorsByCode(sym, "E-ENGINE-RULE-INVALID-VARIANT").length).toBe(0);
    expect(errorsByCode(sym, "E-ONTRANSITION-NO-TARGET").length).toBe(0);
  });

  test("clean engine — no <onTransition> + no effect= — produces no B17.3 fires", () => {
    const src = `\${ type AppMode:enum = { Idle, Active } }
<engine for=AppMode initial=.Idle>
  <Idle rule=.Active></>
  <Active></>
</>`;
    const { sym } = runUpToSYM(src);
    expect(errorsByCode(sym, "E-ENGINE-EFFECT-AMBIGUOUS").length).toBe(0);
    expect(errorsByCode(sym, "E-ONTRANSITION-NO-TARGET").length).toBe(0);
    // Note: B15 might still fire its own E-ENGINE-RULE-INVALID-VARIANT on
    // unrelated issues, so we don't blanket-assert that count is 0 here —
    // only that no B17.3-specific message is produced.
    const onT = errorsByCode(sym, "E-ENGINE-RULE-INVALID-VARIANT")
      .filter((e) => e.message.includes("<onTransition"));
    expect(onT.length).toBe(0);
  });

  test("regression — A5-3 onTimeout fires intact alongside B17.3 fires", () => {
    // Single state-child carrying BOTH an <onTimeout to=.Bogus/> (A5-3 fire-site
    // #4: E-ENGINE-RULE-INVALID-VARIANT) AND an <onTransition to=.Bogus2>
    // (B17.3 fire-site #2: same code). Both should fire independently.
    const src = `\${ type AppMode:enum = { Idle, Active } }
<engine for=AppMode initial=.Idle>
  <Idle rule=.Active>
    <onTimeout after=1s to=.Bogus1/>
    <onTransition to=.Bogus2>\${ log("bad") }</>
  </>
  <Active></>
</>`;
    const { sym } = runUpToSYM(src);
    const errs = errorsByCode(sym, "E-ENGINE-RULE-INVALID-VARIANT");
    expect(errs.some((e) => e.message.includes("Bogus1"))).toBe(true);
    expect(errs.some((e) => e.message.includes("Bogus2"))).toBe(true);
  });

  test("regression — engine with no for=Type (variants empty) skips fire-sites #2/#3", () => {
    // When variants is empty (unknown for=Type), B15/A5-3/B17.3 all skip
    // variant-set checks. B17.3 still fires non-variant-gated checks (#1, #4, #5).
    const src = `<engine for=UnknownType initial=.Idle>
  <Idle>
    <onTransition>\${ log("orphan") }</>
  </>
</>`;
    const { sym } = runUpToSYM(src);
    // Fire-site #5 should fire regardless of variant-set being empty.
    expect(errorsByCode(sym, "E-ONTRANSITION-NO-TARGET").length).toBe(1);
    // Fire-sites #2/#3 should NOT fire (variants empty → skipped).
    const onT = errorsByCode(sym, "E-ENGINE-RULE-INVALID-VARIANT")
      .filter((e) => e.message.includes("<onTransition"));
    expect(onT.length).toBe(0);
  });
});
