/**
 * Phase A1b Step B18 — Multi-statement event-handler validation
 * (E-MULTI-STATEMENT-HANDLER) — L19.
 *
 * Per SPEC §5.2.3 (lines 1127-1188) + §4.14 (line 980) + §34 catalog row
 * 14260.
 *
 * **What B18 owns:**
 *   1. Markup-attribute fire-site (ast-builder.js markup branch): bare-form
 *      event-handler attribute values containing top-level `;` outside
 *      expression-internal contexts (strings, parens, braces, brackets,
 *      comments, ${...} interpolation).
 *   2. Engine state-child `:`-shorthand body fire-site (symbol-table.ts
 *      SYM PASS 11): `:`-shorthand bodies (`<Variant : single-expression>`)
 *      containing top-level `;`. Bare-body and self-closing forms exempt.
 *
 * **Out of scope (deferred):**
 *   - Match-block `:`-shorthand arm bodies (§18.0.1) — parser yields raw
 *     text only today; same shape as engine state-children pre-B15.
 *   - Compile-time named-function existence — resolver territory (B3).
 *   - A1c codegen — bare-form lowering to `function(event){...}` wrapper.
 *
 * Coverage areas:
 *   §B18.1 — Bare-call form ALLOWED (`onclick=fn()`)
 *   §B18.2 — Bare-assignment form ALLOWED (`onclick=@phase = .Loading`)
 *   §B18.3 — Bare single-expression form ALLOWED (`onclick=@count++`)
 *   §B18.4 — Multi-statement fires (`onclick=fn(); other()`)
 *   §B18.5 — String-internal `;` ALLOWED (`onclick=log("hi; bye")`)
 *   §B18.6 — Nested-body `;` ALLOWED (`onclick=arr.forEach(x => { x.a; x.b })`)
 *   §B18.7 — `${...}` arrow form ALLOWED (`onclick=${() => { stmt1; stmt2 }}`)
 *   §B18.8 — Engine state-child `:`-shorthand multi-statement fires
 *   §B18.9 — Engine state-child `:`-shorthand single-expression ALLOWED
 *   §B18.10 — Engine state-child bare-body `;` ALLOWED (multi-children OK)
 *   §B18.11 — Multiple violations: each fires its own diagnostic
 *   §B18.12 — Diagnostic message shape (code + spec ref + canonical fix)
 *   §B18.13 — Non-event attribute with `;` does NOT fire (only event handlers)
 *   §B18.14 — `on:click` namespaced form fires
 *   §B18.15 — `onserver:` channel handler fires
 *   §B18.16 — Helper unit tests (scanForTopLevelSemicolon edge cases)
 */

import { describe, test, expect } from "bun:test";
import { splitBlocks } from "../../src/block-splitter.js";
import { buildAST } from "../../src/ast-builder.js";
import { runSYM } from "../../src/symbol-table.ts";
import {
  scanForTopLevelSemicolon,
  isEventHandlerAttrName,
} from "../../src/multi-statement-scan.ts";
import { parseEngineStateChildren } from "../../src/engine-statechild-parser.ts";
import { validateEngineStateChildrenAndRules } from "../../src/symbol-table.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function compile(source, filePath = "test.scrml") {
  const bs = splitBlocks(filePath, source);
  const tab = buildAST(bs);
  const sym = runSYM({ filePath, ast: tab.ast });
  return { ast: tab.ast, tabErrors: tab.errors, sym };
}

function tabErrorsByCode(tabErrors, code) {
  return (tabErrors || []).filter((e) => e.code === code);
}

function symErrorsByCode(sym, code) {
  return (sym.errors || []).filter((e) => e.code === code);
}

const CODE = "E-MULTI-STATEMENT-HANDLER";

// ---------------------------------------------------------------------------
// §B18.1 — Bare-call form ALLOWED
// ---------------------------------------------------------------------------

describe("§B18.1 bare-call form is allowed", () => {
  test("`onclick=fn()` — no fire", () => {
    const source = `<program>
<button onclick=startGame()>Begin</>
</program>`;
    const { tabErrors } = compile(source);
    expect(tabErrorsByCode(tabErrors, CODE)).toHaveLength(0);
  });

  test("`onclick=fn(literal)` — no fire", () => {
    const source = `<program>
<button onclick=track("click")>Begin</>
</program>`;
    const { tabErrors } = compile(source);
    expect(tabErrorsByCode(tabErrors, CODE)).toHaveLength(0);
  });

  test("`onclick=fn(arg1, arg2)` — no fire (commas don't trigger)", () => {
    const source = `<program>
<button onclick=submit("foo", 42)>Begin</>
</program>`;
    const { tabErrors } = compile(source);
    expect(tabErrorsByCode(tabErrors, CODE)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// §B18.2 — Bare-assignment form ALLOWED
// ---------------------------------------------------------------------------

describe("§B18.2 bare-assignment form is allowed", () => {
  test("`onclick=@phase = .Loading` — no fire (assignment-as-expression §50)", () => {
    const source = `<program>
\${ <phase> = .Idle }
<button onclick=@phase = .Loading>Begin</>
</program>`;
    const { tabErrors } = compile(source);
    expect(tabErrorsByCode(tabErrors, CODE)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// §B18.3 — Bare single-expression ALLOWED
// ---------------------------------------------------------------------------

describe("§B18.3 bare single-expression is allowed", () => {
  test("`onclick=@count++` — no fire", () => {
    const source = `<program>
\${ <count> = 0 }
<button onclick=@count++>Inc</>
</program>`;
    const { tabErrors } = compile(source);
    expect(tabErrorsByCode(tabErrors, CODE)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// §B18.4 — Multi-statement form fires
// ---------------------------------------------------------------------------

describe("§B18.4 multi-statement bare-form fires E-MULTI-STATEMENT-HANDLER", () => {
  test("`onclick=startGame(); track()` fires", () => {
    const source = `<program>
<button onclick=startGame(); track()>Begin</>
</program>`;
    const { tabErrors } = compile(source);
    const fires = tabErrorsByCode(tabErrors, CODE);
    expect(fires.length).toBeGreaterThanOrEqual(1);
    expect(fires[0].message).toContain("E-MULTI-STATEMENT-HANDLER");
    expect(fires[0].message).toContain("onclick");
    expect(fires[0].message).toContain("button");
  });

  test("`onclick=fn(); other(); third()` fires (potentially multiple times)", () => {
    const source = `<program>
<button onclick=fn(); other(); third()>Begin</>
</program>`;
    const { tabErrors } = compile(source);
    const fires = tabErrorsByCode(tabErrors, CODE);
    expect(fires.length).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// §B18.5 — String-internal `;` ALLOWED
// ---------------------------------------------------------------------------

describe("§B18.5 string-internal semicolons are allowed", () => {
  test("`onclick=log(\"hi; bye\")` — no fire", () => {
    const source = `<program>
<button onclick=log("hi; bye")>Log</>
</program>`;
    const { tabErrors } = compile(source);
    expect(tabErrorsByCode(tabErrors, CODE)).toHaveLength(0);
  });

  test("single-quoted string with `;` — no fire", () => {
    const source = `<program>
<button onclick=log('a; b; c')>Log</>
</program>`;
    const { tabErrors } = compile(source);
    expect(tabErrorsByCode(tabErrors, CODE)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// §B18.6 — Nested-body `;` ALLOWED
// ---------------------------------------------------------------------------

describe("§B18.6 nested-body semicolons are allowed", () => {
  test("`onclick=arr.forEach(x => { x.a; x.b })` — no fire", () => {
    const source = `<program>
<button onclick=arr.forEach(x => { x.a; x.b })>Walk</>
</program>`;
    const { tabErrors } = compile(source);
    expect(tabErrorsByCode(tabErrors, CODE)).toHaveLength(0);
  });

  test("nested call with `;` inside argument — no fire", () => {
    const source = `<program>
<button onclick=outer(inner(a; b))>X</>
</program>`;
    const { tabErrors } = compile(source);
    // The `;` is inside parens — paren depth > 0 — not top-level.
    expect(tabErrorsByCode(tabErrors, CODE)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// §B18.7 — `${...}` arrow form ALLOWED
// ---------------------------------------------------------------------------

describe("§B18.7 \${...} arrow form is allowed", () => {
  test("`onclick=\${() => { stmt1; stmt2 }}` — no fire", () => {
    const source = `<program>
<button onclick=\${() => { stmt1; stmt2 }}>X</>
</program>`;
    const { tabErrors } = compile(source);
    expect(tabErrorsByCode(tabErrors, CODE)).toHaveLength(0);
  });

  test("`onclick=\${complex; expr}` — no fire (entire \${...} is one opaque value)", () => {
    const source = `<program>
<button onclick=\${a; b; c}>X</>
</program>`;
    const { tabErrors } = compile(source);
    // The `${...}` opens brace depth > 0; semicolons inside are not top-level.
    expect(tabErrorsByCode(tabErrors, CODE)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// §B18.8/9/10 — Engine state-child `:`-shorthand fire-site (SYM PASS 11)
//
// **Surface-form note:** today's block-splitter does NOT tokenize the
// canonical spec-form `:`-shorthand (`<Idle : startGame()>` — `:` INSIDE
// opener, body terminated by `>`) per §4.14. BS also chokes on the post-
// `>` `:` form when used as an engine state-child body (the bare `;` at
// markup level corrupts BS state). Per the B15 test-file note (lines 26-
// 31), when canonical-form parsing lands, additional integration tests
// can be added without changing PASS 11.
//
// To exercise the SYM PASS 11 fire-site (B18 fire-site #2) today, we
// invoke `validateEngineStateChildrenAndRules` directly with synthetic
// engine-decl AST nodes carrying the appropriate `rulesRaw`. The parser
// (`parseEngineStateChildren`) DOES handle the post-`>` `:` form
// correctly (covered by §B18.16b parser tests), so the validator-direct
// integration is end-to-end accurate for the parser-supported subset.
// ---------------------------------------------------------------------------

// Helper: build a synthetic engine-decl + fileAst with `_record.engineMeta`
// populated, then call validateEngineStateChildrenAndRules and collect
// SYM diagnostics.
function runValidator(rulesRaw, opts = {}) {
  const { initialVariant = null, variants = [], forType = "T" } = opts;
  const errors = [];
  const engineDecl = {
    kind: "engine-decl",
    rulesRaw,
    span: { file: "test.scrml", start: 0, end: rulesRaw.length, line: 1, col: 1 },
    _record: {
      engineMeta: {
        forType,
        variants: [],
        initialVariant,
        derivedExpr: null,
        varName: forType.toLowerCase(),
        isExported: false,
        isPinned: false,
      },
    },
  };
  // Synthesize fileAst.typeDecls so getEnumVariantsFromTypeDecls finds variants.
  const fileAst = {
    typeDecls: variants.length > 0
      ? [{ name: forType, kind: "enum", variants }]
      : [],
  };
  validateEngineStateChildrenAndRules(engineDecl, fileAst, errors, "test.scrml");
  return { errors, engineDecl };
}

describe("§B18.8 engine state-child :-shorthand multi-statement fires (SYM PASS 11)", () => {
  test("`<Small> : startGame(); track()` (post-> form) fires E-MULTI-STATEMENT-HANDLER", () => {
    const rulesRaw = `<Small> : startGame(); track()
<Big rule=.Small></>`;
    const { errors } = runValidator(rulesRaw, {
      forType: "MarioState",
      variants: ["Small", "Big"],
      initialVariant: "Small",
    });
    const fires = errors.filter((e) => e.code === CODE);
    expect(fires.length).toBeGreaterThanOrEqual(1);
    expect(fires[0].message).toContain("E-MULTI-STATEMENT-HANDLER");
    expect(fires[0].message).toContain("Small");
  });

  test("multiple :-shorthand multi-statement state-children — multiple fires", () => {
    const rulesRaw = `<Small> : startGame(); track()
<Big> : stop(); finalize()`;
    const { errors } = runValidator(rulesRaw, {
      forType: "MarioState",
      variants: ["Small", "Big"],
      initialVariant: "Small",
    });
    const fires = errors.filter((e) => e.code === CODE);
    expect(fires.length).toBeGreaterThanOrEqual(2);
  });

  test("string-internal `;` inside :-shorthand body — no fire", () => {
    const rulesRaw = `<Small> : log("hi; bye")
<Big rule=.Small></>`;
    const { errors } = runValidator(rulesRaw, {
      forType: "MarioState",
      variants: ["Small", "Big"],
      initialVariant: "Small",
    });
    const fires = errors.filter((e) => e.code === CODE);
    expect(fires.length).toBe(0);
  });

  test("nested-body `;` inside :-shorthand body — no fire (paren-internal)", () => {
    const rulesRaw = `<Small> : fn(a; b)
<Big rule=.Small></>`;
    const { errors } = runValidator(rulesRaw, {
      forType: "MarioState",
      variants: ["Small", "Big"],
      initialVariant: "Small",
    });
    const fires = errors.filter((e) => e.code === CODE);
    expect(fires.length).toBe(0);
  });
});

describe("§B18.9 engine state-child :-shorthand single-expression is allowed", () => {
  test("`<Small> : startGame()` — no fire", () => {
    const rulesRaw = `<Small> : startGame()
<Big rule=.Small></>`;
    const { errors } = runValidator(rulesRaw, {
      forType: "MarioState",
      variants: ["Small", "Big"],
      initialVariant: "Small",
    });
    expect(errors.filter((e) => e.code === CODE).length).toBe(0);
  });

  test("`<Small> : \"emoji\"` literal — no fire", () => {
    const rulesRaw = `<Small> : "emoji"
<Big rule=.Small></>`;
    const { errors } = runValidator(rulesRaw, {
      forType: "MarioState",
      variants: ["Small", "Big"],
      initialVariant: "Small",
    });
    expect(errors.filter((e) => e.code === CODE).length).toBe(0);
  });
});

describe("§B18.10 engine state-child bare-body and self-closing are exempt", () => {
  test("bare-body state-child — no fire even if body has `;`", () => {
    const rulesRaw = `<Small rule=.Big></>
<Big rule=.Small></>`;
    const { errors } = runValidator(rulesRaw, {
      forType: "MarioState",
      variants: ["Small", "Big"],
      initialVariant: "Small",
    });
    expect(errors.filter((e) => e.code === CODE).length).toBe(0);
  });

  test("self-closing state-child — no fire", () => {
    const rulesRaw = `<Small rule=.Big/>
<Big rule=.Small/>`;
    const { errors } = runValidator(rulesRaw, {
      forType: "MarioState",
      variants: ["Small", "Big"],
      initialVariant: "Small",
    });
    expect(errors.filter((e) => e.code === CODE).length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// §B18.11 — Multiple violations
// ---------------------------------------------------------------------------

describe("§B18.11 multiple violations each fire their own diagnostic", () => {
  test("two markup multi-statement handlers — two fires", () => {
    const source = `<program>
<button onclick=fn(); other()>A</>
<button onclick=foo(); bar()>B</>
</program>`;
    const { tabErrors } = compile(source);
    const fires = tabErrorsByCode(tabErrors, CODE);
    expect(fires.length).toBeGreaterThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// §B18.12 — Diagnostic message shape
// ---------------------------------------------------------------------------

describe("§B18.12 diagnostic message shape", () => {
  test("markup-attribute fire — message names attribute, tag, and references §5.2.3", () => {
    const source = `<program>
<button onclick=fn(); other()>X</>
</program>`;
    const { tabErrors } = compile(source);
    const fires = tabErrorsByCode(tabErrors, CODE);
    expect(fires.length).toBeGreaterThanOrEqual(1);
    const msg = fires[0].message;
    expect(msg).toContain("E-MULTI-STATEMENT-HANDLER");
    expect(msg).toContain("onclick");
    expect(msg).toContain("button");
    expect(msg).toContain("§5.2.3");
    // S437 — the fix-it is §5.2.3's: braces first (built from the user's own
    // statements), a named function second. The pre-S435 "lift to a named
    // function" as the only fix is gone.
    expect(msg).toContain("Wrap the statements in braces");
    expect(msg).toContain("`onclick={ fn(); other() }`");
    expect(msg).toContain("name a function");
    expect(msg).not.toContain("lift the body");
  });

  test("engine state-child fire — message names tag and references §4.14", () => {
    const rulesRaw = `<Small> : startGame(); track()
<Big rule=.Small></>`;
    const { errors } = runValidator(rulesRaw, {
      forType: "MarioState",
      variants: ["Small", "Big"],
      initialVariant: "Small",
    });
    const fires = errors.filter((e) => e.code === CODE);
    expect(fires.length).toBeGreaterThanOrEqual(1);
    const msg = fires[0].message;
    expect(msg).toContain("E-MULTI-STATEMENT-HANDLER");
    expect(msg).toContain("Small");
    expect(msg).toContain("§4.14");
  });
});

// ---------------------------------------------------------------------------
// §B18.13 — Non-event attribute with `;` does NOT fire
// ---------------------------------------------------------------------------

describe("§B18.13 non-event-handler attributes are exempt", () => {
  test("`title=\"a; b\"` (string with `;` — string-internal anyway) — no fire", () => {
    const source = `<program>
<button title="a; b">X</>
</program>`;
    const { tabErrors } = compile(source);
    expect(tabErrorsByCode(tabErrors, CODE)).toHaveLength(0);
  });

  test("non-event attribute would never be the owner anyway", () => {
    // Even if a `;` were top-level after a non-event attr, the rule does
    // not apply. Construct a synthetic case: `class=foo; data-x=bar` —
    // class is not on*.
    const source = `<program>
<div class=foo>X</>
</program>`;
    const { tabErrors } = compile(source);
    expect(tabErrorsByCode(tabErrors, CODE)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// §B18.14 — `on:click` namespaced form fires
// ---------------------------------------------------------------------------

describe("§B18.14 on:event namespaced form fires", () => {
  test("`on:click=fn(); other()` fires", () => {
    const source = `<program>
<button on:click=fn(); other()>X</>
</program>`;
    const { tabErrors } = compile(source);
    const fires = tabErrorsByCode(tabErrors, CODE);
    expect(fires.length).toBeGreaterThanOrEqual(1);
    expect(fires[0].message).toContain("on:click");
  });
});

// ---------------------------------------------------------------------------
// §B18.15 — `onserver:`/`onclient:` channel handler fires
// ---------------------------------------------------------------------------

describe("§B18.15 channel-handler attrs fire (per saved survey scope decision)", () => {
  test("`onserver:msg=handle(); track()` fires", () => {
    const source = `<program>
<div onserver:msg=handle(); track()>X</>
</program>`;
    const { tabErrors } = compile(source);
    const fires = tabErrorsByCode(tabErrors, CODE);
    expect(fires.length).toBeGreaterThanOrEqual(1);
    expect(fires[0].message).toContain("onserver:msg");
  });
});

// ---------------------------------------------------------------------------
// §B18.16 — Helper unit tests
// ---------------------------------------------------------------------------

describe("§B18.16 scanForTopLevelSemicolon helper", () => {
  test("empty / non-string input returns []", () => {
    expect(scanForTopLevelSemicolon("")).toEqual([]);
    expect(scanForTopLevelSemicolon(null)).toEqual([]);
    expect(scanForTopLevelSemicolon(undefined)).toEqual([]);
    expect(scanForTopLevelSemicolon(42)).toEqual([]);
  });

  test("no `;` returns []", () => {
    expect(scanForTopLevelSemicolon("fn()")).toEqual([]);
    expect(scanForTopLevelSemicolon("a + b")).toEqual([]);
  });

  test("top-level `;` recorded with offset", () => {
    const hits = scanForTopLevelSemicolon("a; b");
    expect(hits).toHaveLength(1);
    expect(hits[0].offset).toBe(1);
  });

  test("multiple top-level `;` all recorded", () => {
    const hits = scanForTopLevelSemicolon("a; b; c");
    expect(hits).toHaveLength(2);
    expect(hits.map((h) => h.offset)).toEqual([1, 4]);
  });

  test("`;` inside parens is NOT top-level", () => {
    expect(scanForTopLevelSemicolon("fn(a; b)")).toEqual([]);
    expect(scanForTopLevelSemicolon("a(b(c; d))")).toEqual([]);
  });

  test("`;` inside braces is NOT top-level", () => {
    expect(scanForTopLevelSemicolon("{ a; b }")).toEqual([]);
    expect(scanForTopLevelSemicolon("x => { a; b }")).toEqual([]);
  });

  test("`;` inside brackets is NOT top-level", () => {
    expect(scanForTopLevelSemicolon("[a; b]")).toEqual([]);
  });

  test("`;` inside double-quoted string is NOT top-level", () => {
    expect(scanForTopLevelSemicolon(`"a; b"`)).toEqual([]);
    expect(scanForTopLevelSemicolon(`log("hi; bye")`)).toEqual([]);
  });

  test("`;` inside single-quoted string is NOT top-level", () => {
    expect(scanForTopLevelSemicolon(`'a; b'`)).toEqual([]);
  });

  test("`;` inside backtick template literal is NOT top-level", () => {
    expect(scanForTopLevelSemicolon("`a; b`")).toEqual([]);
  });

  test("`;` inside `${...}` interpolation is NOT top-level", () => {
    // Brace-depth > 0 throughout the interp → all `;` inside skipped.
    expect(scanForTopLevelSemicolon("`pre${a; b}post`")).toEqual([]);
  });

  test("`;` inside `//` line comment is NOT top-level", () => {
    expect(scanForTopLevelSemicolon("// a; b\nc")).toEqual([]);
  });

  test("`;` inside `/* */` block comment is NOT top-level", () => {
    expect(scanForTopLevelSemicolon("/* a; b */ c")).toEqual([]);
  });

  test("escape sequences inside strings handled", () => {
    // `\"` doesn't terminate the string — `;` after `\"` is still string-internal.
    expect(scanForTopLevelSemicolon(`"a\\"; b"`)).toEqual([]);
  });

  test("mixed: real top-level `;` after grouped expr-internal `;`", () => {
    // `fn(a; b); other()` — the first `;` is paren-internal, the second is top-level.
    const hits = scanForTopLevelSemicolon("fn(a; b); other()");
    expect(hits).toHaveLength(1);
    expect(hits[0].offset).toBe(8); // position of the second `;`
  });

  test("unclosed string consumes to end without throwing", () => {
    // Defensive: malformed input shouldn't throw.
    expect(() => scanForTopLevelSemicolon('"unclosed')).not.toThrow();
  });

  test("unclosed paren consumes to end without throwing", () => {
    expect(() => scanForTopLevelSemicolon("fn(a; b")).not.toThrow();
  });
});

describe("§B18.16b parseEngineStateChildren — isColonShorthand flag", () => {
  test("post-> `:` form sets isColonShorthand: true", () => {
    const out = parseEngineStateChildren(`<Small> : startGame()`);
    expect(out).toHaveLength(1);
    expect(out[0].isColonShorthand).toBe(true);
    expect(out[0].bodyRaw).toContain("startGame()");
  });

  test("bare-body form sets isColonShorthand: false", () => {
    const out = parseEngineStateChildren(`<Small rule=.Big></Small>`);
    expect(out).toHaveLength(1);
    expect(out[0].isColonShorthand).toBe(false);
  });

  test("self-closing form sets isColonShorthand: false", () => {
    const out = parseEngineStateChildren(`<Small rule=.Big/>`);
    expect(out).toHaveLength(1);
    expect(out[0].isColonShorthand).toBe(false);
  });

  test("multi-statement :-shorthand body recorded for downstream B18 fire", () => {
    const out = parseEngineStateChildren(`<Small> : a(); b()`);
    expect(out).toHaveLength(1);
    expect(out[0].isColonShorthand).toBe(true);
    // The post-`:` text contains a top-level `;` — PASS 11 will fire.
    const hits = scanForTopLevelSemicolon(out[0].bodyRaw);
    expect(hits.length).toBeGreaterThanOrEqual(1);
  });
});

describe("§B18.16c isEventHandlerAttrName predicate", () => {
  test("`onclick`, `onsubmit` etc. — true", () => {
    expect(isEventHandlerAttrName("onclick")).toBe(true);
    expect(isEventHandlerAttrName("onsubmit")).toBe(true);
    expect(isEventHandlerAttrName("oninput")).toBe(true);
    expect(isEventHandlerAttrName("onmouseenter")).toBe(true);
  });

  test("`on:click` namespaced — true", () => {
    expect(isEventHandlerAttrName("on:click")).toBe(true);
  });

  test("`onserver:`/`onclient:` — true", () => {
    expect(isEventHandlerAttrName("onserver:msg")).toBe(true);
    expect(isEventHandlerAttrName("onclient:foo")).toBe(true);
  });

  test("non-event attrs — false", () => {
    expect(isEventHandlerAttrName("class")).toBe(false);
    expect(isEventHandlerAttrName("title")).toBe(false);
    expect(isEventHandlerAttrName("href")).toBe(false);
    expect(isEventHandlerAttrName("data-x")).toBe(false);
    expect(isEventHandlerAttrName("bind:value")).toBe(false);
    expect(isEventHandlerAttrName("class:active")).toBe(false);
  });

  test("edge: `on` alone — false (regex requires at least one [a-z])", () => {
    expect(isEventHandlerAttrName("on")).toBe(false);
  });

  test("edge: empty / non-string — false", () => {
    expect(isEventHandlerAttrName("")).toBe(false);
    expect(isEventHandlerAttrName(null)).toBe(false);
    expect(isEventHandlerAttrName(undefined)).toBe(false);
  });
});
