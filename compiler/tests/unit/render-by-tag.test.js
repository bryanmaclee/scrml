/**
 * Phase A1b Step B6 — render-by-tag classifier.
 *
 * Tests the PASS 5 walker added to Stage 3.06 SYM
 * (`compiler/src/symbol-table.ts`). For every `<x/>` self-closed structural
 * tag in markup that resolves to a registered state cell, B6 fires one of two
 * diagnostics depending on the cell's classified `_cellKind` (B5 substrate)
 * and `decl.isConst`:
 *
 *   - E-CELL-NO-RENDER-SPEC      — cell has no render-spec; use `${@x}` interpolation.
 *     Fires for: Shape 1 plain, Shape 3 plain derived, Shape 3 markup-typed
 *     derived (per SPEC §6.6.17), Variant C compound parent (Phase 0 §3.1
 *     disposition — spec-silent extension).
 *   - E-CELL-RENDER-SPEC-NOT-BINDABLE — Shape 2 declaration with non-bindable
 *     RHS markup (e.g., `<div>`, `<span>`). Use Shape 3 (`const <x>`) instead.
 *
 * **Disposition deferrals (Phase 0 §3.2):**
 *   - PascalCase RHS tags (e.g., `<x> = <MyComp/>`) are DEFERRED — the spec
 *     (line 1341) requires component-prop catalog inspection, which is B14 /
 *     M18 / M20 territory. B6 v1 does NOT fire on these to avoid mis-firing
 *     on cases the spec explicitly says require substrate that does not yet
 *     exist. Test §B6.15 documents the deferral.
 *
 * **Disambiguator note (Phase 0 §2.1):**
 *   B5 collapses `_cellKind === "markup-typed"` across two spec-distinct
 *   cases. B6 disambiguates via `decl.isConst`:
 *     - `markup-typed && isConst === true`  → Shape 3 markup-typed derived
 *                                              → E-CELL-NO-RENDER-SPEC
 *     - `markup-typed && isConst === false` → Shape 2 non-bindable RHS
 *                                              → E-CELL-RENDER-SPEC-NOT-BINDABLE
 *
 * Test §B6.1  — Shape 1 plain `<count>=0` + `<count/>` → fires E-CELL-NO-RENDER-SPEC
 * Test §B6.2  — Shape 2 input(text) + `<userName/>` → no fire
 * Test §B6.3  — Shape 2 input(checkbox) + `<agree/>` → no fire
 * Test §B6.4  — Shape 2 textarea + `<bio/>` → no fire
 * Test §B6.5  — Shape 2 select + `<role/>` → no fire
 * Test §B6.6  — Shape 2 `<msg> = <div>...</div>` + `<msg/>` → fires E-CELL-RENDER-SPEC-NOT-BINDABLE
 * Test §B6.7  — Shape 2 `<note> = <span>...</span>` + `<note/>` → fires E-CELL-RENDER-SPEC-NOT-BINDABLE
 * Test §B6.8  — Shape 3 plain derived (`const <doubled> = @count * 2`) + `<doubled/>` → fires E-CELL-NO-RENDER-SPEC
 * Test §B6.9  — Shape 3 markup-typed derived (`const <badge> = <span>...</span>`) + `<badge/>` → fires E-CELL-NO-RENDER-SPEC (SPEC §6.6.17 line 3027)
 * Test §B6.10 — Variant C compound parent + `<formRes/>` → fires E-CELL-NO-RENDER-SPEC (Phase 0 §3.1)
 * Test §B6.11 — `${@count}` interpolation form (no `<count/>` tag) → no fire
 * Test §B6.12 — Decl with no use-site → no fire
 * Test §B6.13 — PascalCase tag `<MyComponent/>` → no fire (deferred per Phase 0 §3.2)
 * Test §B6.14 — HTML built-in self-closed `<br/>` → no fire (not a state cell)
 * Test §B6.15 — Multi-use Shape 2 bindable: `<userName/>` x3 → 0 fires
 * Test §B6.16 — Multi-use Shape 1: `<count/>` x3 → 3 fires (each independent)
 * Test §B6.17 — Diagnostic shape: span / code / severity / message
 * Test §B6.18 — Unresolved tag (`<undefinedThing/>`) → no fire (out of B6 scope)
 */

import { describe, test, expect } from "bun:test";
import { splitBlocks } from "../../src/block-splitter.js";
import { buildAST } from "../../src/ast-builder.js";
import { runSYM } from "../../src/symbol-table.ts";

function parse(source) {
  const bs = splitBlocks("test.scrml", source);
  return buildAST(bs);
}

function buildAndRun(source) {
  const { ast, errors } = parse(source);
  const sym = runSYM({ filePath: "test.scrml", ast });
  return { ast, errors, sym };
}

function errsByCode(sym, code) {
  return sym.errors.filter((e) => e.code === code);
}

// ---------------------------------------------------------------------------
// §B6.1 — Shape 1 plain + `<count/>` → E-CELL-NO-RENDER-SPEC
// ---------------------------------------------------------------------------

describe("§B6.1 Shape 1 plain `<count>=0` + `<count/>` use-site", () => {
  test("fires E-CELL-NO-RENDER-SPEC", () => {
    const src = `<program>\${ <count> = 0 }<count/></program>`;
    const { sym } = buildAndRun(src);
    const fires = errsByCode(sym, "E-CELL-NO-RENDER-SPEC");
    expect(fires.length).toBe(1);
    expect(fires[0].message).toContain("count");
    expect(fires[0].severity).toBe("error");
  });
});

// ---------------------------------------------------------------------------
// §B6.2 — Shape 2 input(text) + `<userName/>` → no fire
// ---------------------------------------------------------------------------

describe("§B6.2 Shape 2 input(text) bindable + `<userName/>` use-site", () => {
  test("no fire (bindable accepts render-by-tag)", () => {
    const src = `<program>\${ <userName req length(>=2)> = <input type="text"/> }<userName/></program>`;
    const { sym } = buildAndRun(src);
    expect(errsByCode(sym, "E-CELL-NO-RENDER-SPEC").length).toBe(0);
    expect(errsByCode(sym, "E-CELL-RENDER-SPEC-NOT-BINDABLE").length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// §B6.3 — Shape 2 input(checkbox) + `<agree/>` → no fire
// ---------------------------------------------------------------------------

describe("§B6.3 Shape 2 input(checkbox) bindable + `<agree/>` use-site", () => {
  test("no fire", () => {
    const src = `<program>\${ <agree req> = <input type="checkbox"/> }<agree/></program>`;
    const { sym } = buildAndRun(src);
    expect(errsByCode(sym, "E-CELL-NO-RENDER-SPEC").length).toBe(0);
    expect(errsByCode(sym, "E-CELL-RENDER-SPEC-NOT-BINDABLE").length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// §B6.4 — Shape 2 textarea + `<bio/>` → no fire
// ---------------------------------------------------------------------------

describe("§B6.4 Shape 2 textarea bindable + `<bio/>` use-site", () => {
  test("no fire", () => {
    const src = `<program>\${ <bio> = <textarea/> }<bio/></program>`;
    const { sym } = buildAndRun(src);
    expect(errsByCode(sym, "E-CELL-NO-RENDER-SPEC").length).toBe(0);
    expect(errsByCode(sym, "E-CELL-RENDER-SPEC-NOT-BINDABLE").length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// §B6.5 — Shape 2 select + `<role/>` → no fire
// ---------------------------------------------------------------------------

describe("§B6.5 Shape 2 select bindable + `<role/>` use-site", () => {
  test("no fire", () => {
    const src = `<program>\${ <role> = <select><option value="a"/><option value="b"/></select> }<role/></program>`;
    const { sym } = buildAndRun(src);
    expect(errsByCode(sym, "E-CELL-NO-RENDER-SPEC").length).toBe(0);
    expect(errsByCode(sym, "E-CELL-RENDER-SPEC-NOT-BINDABLE").length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// §B6.6 — Shape 2 with `<div>` RHS + `<msg/>` → E-CELL-RENDER-SPEC-NOT-BINDABLE
// ---------------------------------------------------------------------------

describe("§B6.6 Shape 2 non-bindable `<msg> = <div>...</div>` + `<msg/>`", () => {
  test("fires E-CELL-RENDER-SPEC-NOT-BINDABLE", () => {
    const src = `<program>\${ <msg> = <div>hi</div> }<msg/></program>`;
    const { sym } = buildAndRun(src);
    const fires = errsByCode(sym, "E-CELL-RENDER-SPEC-NOT-BINDABLE");
    expect(fires.length).toBe(1);
    expect(fires[0].message).toContain("msg");
    expect(fires[0].severity).toBe("error");
    expect(errsByCode(sym, "E-CELL-NO-RENDER-SPEC").length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// §B6.7 — Shape 2 with `<span>` RHS + `<note/>` → E-CELL-RENDER-SPEC-NOT-BINDABLE
// ---------------------------------------------------------------------------

describe("§B6.7 Shape 2 non-bindable `<note> = <span>...</span>` + `<note/>`", () => {
  test("fires E-CELL-RENDER-SPEC-NOT-BINDABLE", () => {
    const src = `<program>\${ <note> = <span>note</span> }<note/></program>`;
    const { sym } = buildAndRun(src);
    const fires = errsByCode(sym, "E-CELL-RENDER-SPEC-NOT-BINDABLE");
    expect(fires.length).toBe(1);
    expect(fires[0].message).toContain("note");
  });
});

// ---------------------------------------------------------------------------
// §B6.8 — Shape 3 plain derived + `<doubled/>` → E-CELL-NO-RENDER-SPEC
// ---------------------------------------------------------------------------

describe("§B6.8 Shape 3 plain derived `const <doubled> = @count * 2` + `<doubled/>`", () => {
  test("fires E-CELL-NO-RENDER-SPEC", () => {
    const src = `<program>\${ <count> = 0; const <doubled> = @count * 2 }<doubled/></program>`;
    const { sym } = buildAndRun(src);
    const fires = errsByCode(sym, "E-CELL-NO-RENDER-SPEC");
    // doubled fires; count is not used as <count/> here
    const doubledFires = fires.filter((e) => e.message.includes("doubled"));
    expect(doubledFires.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// §B6.9 — Shape 3 markup-typed derived + `<badge/>` → E-CELL-NO-RENDER-SPEC
// SPEC §6.6.17 line 3027 — derived markup cells use `${@badge}` interpolation
// ---------------------------------------------------------------------------

describe("§B6.9 Shape 3 markup-typed derived `const <badge> = <span>...</span>` + `<badge/>`", () => {
  test("fires E-CELL-NO-RENDER-SPEC (SPEC §6.6.17 line 3027)", () => {
    const src = `<program>\${ <userName> = <input type="text"/>; const <badge> = <span class="b">\${@userName}</span> }<badge/></program>`;
    const { sym } = buildAndRun(src);
    const fires = errsByCode(sym, "E-CELL-NO-RENDER-SPEC");
    const badgeFires = fires.filter((e) => e.message.includes("badge"));
    expect(badgeFires.length).toBe(1);
    // Disambiguator note: B5 stamps badge as "markup-typed"; B6 reads
    // decl.isConst === true → routes to E-CELL-NO-RENDER-SPEC, not
    // E-CELL-RENDER-SPEC-NOT-BINDABLE.
    expect(errsByCode(sym, "E-CELL-RENDER-SPEC-NOT-BINDABLE").length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// §B6.10 — Variant C compound parent + `<formRes/>` → E-CELL-NO-RENDER-SPEC
// Phase 0 §3.1 disposition — spec-silent; spec-faithful extension
// ---------------------------------------------------------------------------

describe("§B6.10 Variant C compound parent + `<formRes/>` use-site", () => {
  test("fires E-CELL-NO-RENDER-SPEC (Phase 0 §3.1 disposition)", () => {
    const src = `<program>\${ <formRes><name>="" <email>="" </> }<formRes/></program>`;
    const { sym } = buildAndRun(src);
    const fires = errsByCode(sym, "E-CELL-NO-RENDER-SPEC");
    const formResFires = fires.filter((e) => e.message.includes("formRes"));
    expect(formResFires.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// §B6.11 — `${@count}` interpolation (no tag use) → no fire
// ---------------------------------------------------------------------------

describe("§B6.11 Shape 1 with `${@count}` interpolation (no `<count/>` tag)", () => {
  test("no fire — interpolation is the spec-canonical alternative", () => {
    const src = `<program>\${ <count> = 0 }<p>\${@count}</p></program>`;
    const { sym } = buildAndRun(src);
    expect(errsByCode(sym, "E-CELL-NO-RENDER-SPEC").length).toBe(0);
    expect(errsByCode(sym, "E-CELL-RENDER-SPEC-NOT-BINDABLE").length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// §B6.12 — Decl with no use-site → no fire
// ---------------------------------------------------------------------------

describe("§B6.12 Shape 1 declared but unused", () => {
  test("no fire — there is no use-site to walk", () => {
    const src = `<program>\${ <count> = 0 }</program>`;
    const { sym } = buildAndRun(src);
    expect(errsByCode(sym, "E-CELL-NO-RENDER-SPEC").length).toBe(0);
    expect(errsByCode(sym, "E-CELL-RENDER-SPEC-NOT-BINDABLE").length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// §B6.13 — PascalCase tag `<MyComponent/>` → no fire (deferred per Phase 0 §3.2)
// ---------------------------------------------------------------------------

describe("§B6.13 PascalCase render-by-tag use `<MyComponent/>`", () => {
  test("no fire — deferred to B14/M18/M20 (Phase 0 §3.2)", () => {
    // PascalCase tag is a component invocation, not a state-cell render-by-tag.
    // B6 walks lowercase tags only; PascalCase tag must not produce an
    // E-CELL-* diagnostic without component-prop-catalog substrate.
    const src = `<program>\${ <count> = 0 }<MyComponent/></program>`;
    const { sym } = buildAndRun(src);
    expect(errsByCode(sym, "E-CELL-NO-RENDER-SPEC").length).toBe(0);
    expect(errsByCode(sym, "E-CELL-RENDER-SPEC-NOT-BINDABLE").length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// §B6.14 — HTML built-in self-closed `<br/>` → no fire
// ---------------------------------------------------------------------------

describe("§B6.14 HTML built-in self-closed tag `<br/>`", () => {
  test("no fire — `br` is not a registered state cell", () => {
    const src = `<program>\${ <count> = 0 }<p>line1<br/>line2</p></program>`;
    const { sym } = buildAndRun(src);
    expect(errsByCode(sym, "E-CELL-NO-RENDER-SPEC").length).toBe(0);
    expect(errsByCode(sym, "E-CELL-RENDER-SPEC-NOT-BINDABLE").length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// §B6.15 — Multi-use Shape 2 bindable: `<userName/>` x3 → 0 fires
// ---------------------------------------------------------------------------

describe("§B6.15 Shape 2 bindable used 3x", () => {
  test("zero fires — bindable accepts every use-site", () => {
    const src = `<program>\${ <userName req> = <input type="text"/> }<userName/><div><userName/></div><span><userName/></span></program>`;
    const { sym } = buildAndRun(src);
    expect(errsByCode(sym, "E-CELL-NO-RENDER-SPEC").length).toBe(0);
    expect(errsByCode(sym, "E-CELL-RENDER-SPEC-NOT-BINDABLE").length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// §B6.16 — Multi-use Shape 1: `<count/>` x3 → 3 fires (each independent)
// ---------------------------------------------------------------------------

describe("§B6.16 Shape 1 plain used 3x", () => {
  test("three fires — each use-site is independent", () => {
    const src = `<program>\${ <count> = 0 }<count/><div><count/></div><span><count/></span></program>`;
    const { sym } = buildAndRun(src);
    const fires = errsByCode(sym, "E-CELL-NO-RENDER-SPEC");
    const countFires = fires.filter((e) => e.message.includes("count"));
    expect(countFires.length).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// §B6.17 — Diagnostic shape: span / code / severity / message
// ---------------------------------------------------------------------------

describe("§B6.17 Diagnostic shape", () => {
  test("E-CELL-NO-RENDER-SPEC carries span anchored at use-site, severity=error, helpful message", () => {
    const src = `<program>\${ <count> = 0 }<count/></program>`;
    const { sym } = buildAndRun(src);
    const fires = errsByCode(sym, "E-CELL-NO-RENDER-SPEC");
    expect(fires.length).toBe(1);
    const f = fires[0];
    expect(f.code).toBe("E-CELL-NO-RENDER-SPEC");
    expect(f.severity).toBe("error");
    expect(f.span).toBeDefined();
    expect(typeof f.span.start).toBe("number");
    expect(typeof f.span.end).toBe("number");
    // Use-site span must be at or after the decl's RHS — `<count/>` use
    // appears AFTER the `${ <count> = 0 }` block.
    expect(f.span.start).toBeGreaterThan(0);
    // Message points at the spec-canonical alternative.
    expect(f.message).toMatch(/\$\{@count\}|interpolation/);
  });

  test("E-CELL-RENDER-SPEC-NOT-BINDABLE carries span, severity=error, mentions Shape 3 / const alternative", () => {
    const src = `<program>\${ <msg> = <div>hi</div> }<msg/></program>`;
    const { sym } = buildAndRun(src);
    const fires = errsByCode(sym, "E-CELL-RENDER-SPEC-NOT-BINDABLE");
    expect(fires.length).toBe(1);
    const f = fires[0];
    expect(f.code).toBe("E-CELL-RENDER-SPEC-NOT-BINDABLE");
    expect(f.severity).toBe("error");
    expect(f.span).toBeDefined();
    // Message guidance — points at Shape 3 / const remediation.
    expect(f.message).toMatch(/const|Shape 3|bindable/i);
  });
});

// ---------------------------------------------------------------------------
// §B6.18 — Unresolved tag (`<undefinedThing/>`) → no fire
// ---------------------------------------------------------------------------

describe("§B6.18 Unresolved lowercase tag", () => {
  test("no fire — out of B6's scope (covered by other passes)", () => {
    // `undefinedThing` is not registered. B6 only fires on REGISTERED state
    // cells; unresolved tags are scope's concern (existing infra).
    const src = `<program>\${ <count> = 0 }<undefinedThing/></program>`;
    const { sym } = buildAndRun(src);
    expect(errsByCode(sym, "E-CELL-NO-RENDER-SPEC").length).toBe(0);
    expect(errsByCode(sym, "E-CELL-RENDER-SPEC-NOT-BINDABLE").length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// §B6.19 — E-CELL-RENDER-SPEC-NOT-BINDABLE is DECL-scoped, not use-scoped
//
// SPEC §6.2 Shape 2 states the rule as a property of the DECLARATION: "The RHS
// markup is a non-input element (e.g., `<div>`, `<span>`). Shape 2 requires
// bindable markup. Use Shape 3 (`const <derived>`) for display-only markup
// cells." Nothing in that sentence mentions a use site.
//
// The check used to fire only at `<x/>` render-by-tag uses, so the two shapes
// below — `${@x}` interpolation, and no use at all — were silently ACCEPTED and
// lowered to `_scrml_reactive_set(x, null)`, discarding the authored markup with
// no diagnostic at all. §B6.11/§B6.12 above pin the same two use-patterns for
// Shape 1, where silence is correct; these pin them for the shape where it was
// a hole.
// ---------------------------------------------------------------------------

describe("§B6.19 decl-scoped E-CELL-RENDER-SPEC-NOT-BINDABLE", () => {
  test("fires on `${@plain}` interpolation use (no render-by-tag use at all)", () => {
    const src = `<program>\${ <plain> = <span class="p">yo</span> }<div>\${@plain}</div></program>`;
    const { sym } = buildAndRun(src);
    const fires = errsByCode(sym, "E-CELL-RENDER-SPEC-NOT-BINDABLE");
    expect(fires.length).toBe(1);
    expect(fires[0].message).toContain("plain");
    expect(fires[0].severity).toBe("error");
  });

  test("fires on a decl with NO use anywhere", () => {
    const src = `<program>\${ <plain> = <span class="p">yo</span> }<div>hi</div></program>`;
    const { sym } = buildAndRun(src);
    const fires = errsByCode(sym, "E-CELL-RENDER-SPEC-NOT-BINDABLE");
    expect(fires.length).toBe(1);
    expect(fires[0].message).toContain("plain");
  });

  test("fires EXACTLY ONCE with a `<plain/>` render-by-tag use — no double-fire", () => {
    // The decl-scoped fire and the old use-site fire must not both land. One
    // offending declaration, one diagnostic.
    const src = `<program>\${ <plain> = <span class="p">yo</span> }<plain/></program>`;
    const { sym } = buildAndRun(src);
    expect(errsByCode(sym, "E-CELL-RENDER-SPEC-NOT-BINDABLE").length).toBe(1);
  });

  test("fires ONCE even with THREE `<plain/>` uses — the count tracks decls, not uses", () => {
    // The sharpest no-double-fire probe: under the old use-site rule this shape
    // emitted 3. Contrast §B6.16, where Shape 1's E-CELL-NO-RENDER-SPEC
    // correctly DOES fire per use, because that one really is a use-site fault.
    const src = `<program>\${ <plain> = <span>yo</span> }<plain/><div><plain/></div><span><plain/></span></program>`;
    const { sym } = buildAndRun(src);
    expect(errsByCode(sym, "E-CELL-RENDER-SPEC-NOT-BINDABLE").length).toBe(1);
  });

  test("the diagnostic is reported at the DECLARATION, not at the use site", () => {
    const src = `<program>\${ <plain> = <span>yo</span> }<plain/></program>`;
    const { sym } = buildAndRun(src);
    const fires = errsByCode(sym, "E-CELL-RENDER-SPEC-NOT-BINDABLE");
    expect(fires.length).toBe(1);
    // The `<plain/>` use is the LAST occurrence in the source; the decl comes
    // first. A span at or past the use would mean the old anchoring survived.
    expect(fires[0].span.start).toBeLessThan(src.lastIndexOf("<plain/>"));
  });

  test("two distinct offending decls fire twice — one diagnostic each", () => {
    const src = `<program>\${ <a> = <span>x</span>; <b> = <div>y</div> }<p>\${@a}\${@b}</p></program>`;
    const { sym } = buildAndRun(src);
    const fires = errsByCode(sym, "E-CELL-RENDER-SPEC-NOT-BINDABLE");
    expect(fires.length).toBe(2);
    expect(fires.filter((e) => e.message.includes("<a>")).length).toBe(1);
    expect(fires.filter((e) => e.message.includes("<b>")).length).toBe(1);
  });

  // -- THE TRAP: these guards are the reason the check keys on `_cellKind` --
  //
  // A LEGAL Shape 2 bindable cell also has a markup RHS, and also lowers to
  // `_scrml_reactive_set(name, null)` — the cell holds the input's VALUE, which
  // starts empty. The emitted symptom is byte-identical to the broken case, so
  // any check keying on "the RHS is markup" makes every form input in the
  // corpus an error. Only `_cellKind` separates them.

  test("REGRESSION — a bindable `<input>` RHS with NO use stays clean", () => {
    const src = `<program>\${ <userName req> = <input type="text"/> }<div>hi</div></program>`;
    const { sym } = buildAndRun(src);
    expect(errsByCode(sym, "E-CELL-RENDER-SPEC-NOT-BINDABLE").length).toBe(0);
  });

  test("REGRESSION — bindable `<textarea>` / `<select>` RHS with only `${@x}` use stay clean", () => {
    const src = `<program>\${ <bio> = <textarea/>; <role> = <select/> }<p>\${@bio}\${@role}</p></program>`;
    const { sym } = buildAndRun(src);
    expect(errsByCode(sym, "E-CELL-RENDER-SPEC-NOT-BINDABLE").length).toBe(0);
  });

  test("REGRESSION — Shape 3 `const` markup cell with `${@badge}` use stays clean", () => {
    // `const` IS the SPEC-named alternative this diagnostic points authors at.
    // If the decl check ever fired here it would reject its own remediation.
    const src = `<program>\${ const <badge> = <span class="b">B</span> }<p>\${@badge}</p></program>`;
    const { sym } = buildAndRun(src);
    expect(errsByCode(sym, "E-CELL-RENDER-SPEC-NOT-BINDABLE").length).toBe(0);
  });

  test("REGRESSION — Shape 1 `<count> = 0` (no markup RHS) unaffected", () => {
    const src = `<program>\${ <count> = 0 }<p>\${@count}</p></program>`;
    const { sym } = buildAndRun(src);
    expect(errsByCode(sym, "E-CELL-RENDER-SPEC-NOT-BINDABLE").length).toBe(0);
  });

  test("REGRESSION — a PascalCase (component) RHS stays deferred, not newly rejected", () => {
    // Phase 0 §3.2: deciding whether a component exposes a bindable prop needs
    // the component prop catalog (B14/M18/M20). The decl check mirrors the
    // use-site deferral rather than tightening one side of it.
    const src = `<program>\${ <widget> = <MyComp/> }<p>\${@widget}</p></program>`;
    const { sym } = buildAndRun(src);
    expect(errsByCode(sym, "E-CELL-RENDER-SPEC-NOT-BINDABLE").length).toBe(0);
  });

  test("the message names the RHS tag and the Shape 3 `const` remediation", () => {
    const src = `<program>\${ <plain> = <span>yo</span> }</program>`;
    const { sym } = buildAndRun(src);
    const f = errsByCode(sym, "E-CELL-RENDER-SPEC-NOT-BINDABLE")[0];
    expect(f).toBeDefined();
    expect(f.message).toContain("<span>");
    expect(f.message).toContain("const <plain>");
    expect(f.message).toMatch(/input, textarea, select/);
  });
});
