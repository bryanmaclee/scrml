/**
 * S437 — E-MULTI-STATEMENT-HANDLER on EVERY bare `;`-sequence handler
 * (change-id s437-bare-handler-sequence-drop).
 *
 * SPEC §5.2.3: "A BARE event-handler value that contains a `;` outside of
 * expression-internal contexts (string literals, template literals, parentheses,
 * brackets, braces, nested function bodies, comments) is compile error
 * `E-MULTI-STATEMENT-HANDLER`. The fix is to wrap the statements in braces —
 * `onclick={ startGame(); track("start") }` — or to name a function." and
 * "The error is kept so the unbraced sequence can never be silently read the
 * wrong way."
 *
 * The defect (pre-S437, exit 0, no diagnostic):
 *   <button onclick=@count = 0; track("reset")>r</button>
 *   -> <button data-scrml-bind-onclick="…" track reset>
 * The fire-site found the `;` but attributed it to the latest `name=` in the
 * RAW text — which was `count =` inside the handler's own value — and skipped a
 * non-event owner. Every assignment-shaped leader (`@a = 0`, `@o.x = 1`) was
 * missed; call / compound / postfix leaders fired. Separately, the `<each>`
 * body re-split, the engine state-child body build, and the `<match>` arm
 * re-parse all DISCARD their TAB errors, so no leader fired inside them.
 *
 * Coverage:
 *   §1 fires — every leader shape, trailing attrs, spacing variants
 *   §2 does-not-fire — `;` in strings / template literals / parens; braced
 *      forms; `${…}` arrow; single statements; non-handler attrs
 *   §3 nested positions — `<each>` row, engine state-child, `<match>` arm
 *      (plain and `<each>`-bearing), `<each>` inside an engine body; one
 *      diagnostic per handler; span on the real source line
 *   §4 message — braces fix-it built from the user's statements, no statement
 *      dropped from the fix-it
 *   §5 braced forms compile and emit every statement in the handler body
 *   §6 bareHandlerStatementsText helper
 */

import { describe, test, expect } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { compileScrml } from "../../src/api.js";
import { validateEmittedArtifact } from "../../src/codegen/validate-emit.ts";
import { bareHandlerStatementsText, attrShapedTokenInStatements } from "../../src/multi-statement-scan.ts";
import { splitBlocks } from "../../src/block-splitter.js";
import { buildAST } from "../../src/ast-builder.js";

const CODE = "E-MULTI-STATEMENT-HANDLER";

function compileSource(source) {
  const dir = mkdtempSync(join(tmpdir(), "scrml-s437-msh-"));
  try {
    const file = join(dir, "app.scrml");
    writeFileSync(file, source);
    const r = compileScrml({ inputFiles: [file], write: false });
    const out = [...(r.outputs?.values?.() ?? [])][0] ?? {};
    const errors = [...(r.errors ?? [])];
    // The emitted-JS parse gate (E-CODEGEN-INVALID-LOGIC) runs on the WRITE
    // path only, so a `write: false` compile of a malformed handler reports no
    // error. Apply the gate's own validator here, or "compiles" would be blind
    // to exactly the failure the S437 round-3 re-review found (F1–F3).
    if (typeof out.clientJs === "string" && out.clientJs.length > 0) {
      const gate = validateEmittedArtifact({ sourceFile: file, artifact: "app.client.js", contents: out.clientJs });
      if (gate) errors.push(gate);
    }
    return {
      errors,
      html: out.html ?? "",
      clientJs: out.clientJs ?? "",
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function mshErrors(r) {
  return r.errors.filter((e) => e.code === CODE);
}

const PRE = `<program>
<count> = 5
<obj> = { x: 1 }
<items> = []
<msg> = ""
\${ function track(x) { @msg = x } }
\${ function startGame() { @count = 1 } }
`;
const POST = `\n</program>\n`;
const top = (body) => PRE + body + POST;

// ---------------------------------------------------------------------------
// §1 — fires, whatever the leading statement is
// ---------------------------------------------------------------------------

describe("§1 a bare `;`-sequence handler fires regardless of its first statement", () => {
  const cases = [
    ["assignment-led (the S437 reproducer)", `<button onclick=@count = 0; track("reset")>r</button>`],
    ["call-led (§5.2.3 worked example)", `<button onclick=startGame(); track("start")>r</button>`],
    ["compound-assignment-led", `<button onclick=@count += 1; track("x")>r</button>`],
    ["postfix-increment-led", `<button onclick=@count++; track("x")>r</button>`],
    ["postfix-decrement-led", `<button onclick=@count--; track("x")>r</button>`],
    ["method-call-led", `<button onclick=@items.push(1); track("x")>r</button>`],
    ["member-assignment-led", `<button onclick=@obj.x = 2; track("x")>r</button>`],
    ["assignment then assignment", `<button onclick=@count = 0; @msg = "a">r</button>`],
    ["three statements", `<button onclick=@count = 0; @msg = "a"; track("z")>r</button>`],
    ["trailing attribute after the sequence", `<button onclick=@count = 0; track("x") class="y">r</button>`],
    ["call-led with trailing attribute", `<button onclick=startGame(); track("x") class="y">r</button>`],
    ["no space after `;`", `<button onclick=@count = 0;track("x")>r</button>`],
    ["space before `;`", `<button onclick=@count = 0 ; track("x")>r</button>`],
    ["trailing `;` with nothing after", `<button onclick=@count = 0;>r</button>`],
  ];
  for (const [name, body] of cases) {
    test(name, () => {
      const r = compileSource(top(body));
      expect(mshErrors(r).length).toBe(1);
    });
  }
});

// ---------------------------------------------------------------------------
// §2 — does not fire
// ---------------------------------------------------------------------------

describe("§2 expression-internal `;`, braced forms and non-handlers do not fire", () => {
  const cases = [
    ["`;` inside a string on an assignment RHS", `<button onclick=@msg = "a; b">r</button>`],
    ["`;` inside a call's string argument", `<button onclick=track("a; b")>r</button>`],
    ["`;` inside a template literal", "<button onclick=@msg = `a; ${@count}`>r</button>"],
    ["`;` inside parens", `<button onclick=track((1, "x;y"))>r</button>`],
    ["braced assignment-led block", `<button onclick={ @count = 0; track("reset") }>r</button>`],
    ["braced call-led block", `<button onclick={ startGame(); track("start") }>r</button>`],
    ["`\${…}` arrow with a block body", `<button onclick=\${() => { @count = 0; track("a") }}>r</button>`],
    ["single bare assignment + trailing attribute", `<button onclick=@count = 0 class="y">r</button>`],
    ["two single-statement handlers on one element", `<button onclick=@count = 0 onmouseenter=@msg = "h">r</button>`],
    ["`;` in a quoted non-handler attribute", `<div style="color: red; font-weight: bold">d</div>`],
  ];
  for (const [name, body] of cases) {
    test(name, () => {
      const r = compileSource(top(body));
      expect(mshErrors(r).length).toBe(0);
    });
  }
});

// ---------------------------------------------------------------------------
// §3 — nested positions (each / engine / match)
// ---------------------------------------------------------------------------

const ENGINE_PRE = `<program>
type Phase:enum = { Idle, Loading }
<count> = 5
<msg> = ""
<rows> = []
\${ function track(x) { @msg = x } }
`;

describe("§3 nested positions fire exactly once, on the real source line", () => {
  test("inside an `<each>` row", () => {
    const r = compileSource(top(
      `<ul><each in=@items as it><li><button onclick=@count = 0; track("e")>r</button></li></each></ul>`,
    ));
    const f = mshErrors(r);
    expect(f.length).toBe(1);
    // `<ul>` is on line 8 of the file (7 prelude lines).
    expect(f[0].tabSpan?.line ?? f[0].span?.line).toBe(8);
  });

  test("braced handler inside an `<each>` row does not fire", () => {
    const r = compileSource(top(
      `<ul><each in=@items as it><li><button onclick={ @count = 0; track("e") }>r</button></li></each></ul>`,
    ));
    expect(mshErrors(r).length).toBe(0);
  });

  test("inside an engine state-child body", () => {
    const r = compileSource(ENGINE_PRE + `<engine for=Phase initial=.Idle>
    <Idle>
        <button onclick=@count = 0; track("go")>Begin</button>
    </>
    <Loading><p>...</p></>
</>` + POST);
    const f = mshErrors(r);
    expect(f.length).toBe(1);
  });

  test("braced handler inside an engine state-child does not fire", () => {
    const r = compileSource(ENGINE_PRE + `<engine for=Phase initial=.Idle>
    <Idle>
        <button onclick={ @count = 0; track("go") }>Begin</button>
    </>
    <Loading><p>...</p></>
</>` + POST);
    expect(mshErrors(r).length).toBe(0);
  });

  test("inside a `<match>` arm", () => {
    const r = compileSource(ENGINE_PRE + `<ph>: Phase = .Idle
<match on=@ph>
    <Idle><button onclick=@count = 0; track("m")>M</button></>
    <Loading><p>x</p></>
</>` + POST);
    expect(mshErrors(r).length).toBe(1);
  });

  test("inside an `<each>`-bearing `<match>` arm (the blanked-arm path)", () => {
    const r = compileSource(ENGINE_PRE + `<ph>: Phase = .Idle
<match on=@ph>
    <Idle><button onclick=@count = 0; track("mx")>M</button><ul><each in=@rows as it><li>x</li></each></ul></>
    <Loading><p>x</p></>
</>` + POST);
    expect(mshErrors(r).length).toBe(1);
  });

  test("inside an `<each>` nested in an engine body — forwarded once, not twice", () => {
    const r = compileSource(ENGINE_PRE + `<engine for=Phase initial=.Idle>
    <Idle><ul><each in=@rows as it><li><button onclick=@count = 0; track("ee")>r</button></li></each></ul></>
    <Loading><p>x</p></>
</>` + POST);
    expect(mshErrors(r).length).toBe(1);
  });

  test("`:`-shorthand state-child body stays §4.14's (SYM) fire, not double-fired here", () => {
    const r = compileSource(ENGINE_PRE + `<engine for=Phase initial=.Idle>
    <Idle : track("a"); track("b")>
    <Loading><p>x</p></>
</>` + POST);
    // One fire total (the §4.14 site), never an extra attribute-site fire.
    expect(mshErrors(r).length).toBeLessThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// §4 — the message
// ---------------------------------------------------------------------------

describe("§4 the message gives §5.2.3's fix built from the user's statements", () => {
  test("assignment-led reproducer — braces fix-it verbatim", () => {
    const r = compileSource(top(`<button onclick=@count = 0; track("reset")>r</button>`));
    const [e] = mshErrors(r);
    expect(e.message).toContain("`onclick`");
    expect(e.message).toContain("`<button>`");
    expect(e.message).toContain("Wrap the statements in braces");
    expect(e.message).toContain('`onclick={ @count = 0; track("reset") }`');
    expect(e.message).toContain("name a function");
    expect(e.message).toContain("§5.2.3");
    expect(e.message).not.toContain("lift the body");
  });

  test("three statements — the fix-it keeps all three (none silently dropped)", () => {
    const r = compileSource(top(`<button onclick=@count = 0; @msg = "a"; track("z")>r</button>`));
    const [e] = mshErrors(r);
    expect(e.message).toContain('`onclick={ @count = 0; @msg = "a"; track("z") }`');
  });

  test("a value that ends in a string no longer runs on into the next attribute (s457 4a)", () => {
    // Before s457 the tokenizer read `hidden=@on` as part of the handler value
    // when the value ended in a string, and this case pinned the "runs on into
    // the next attribute" fix-it. The one unquoted-value reader (SPEC §5.2 "An
    // unquoted value is read WHOLE") now ends the handler at `@a = "s"`, so
    // `hidden=@on` is its own attribute and the `;` after ITS value is a
    // statement list in a non-handler attribute (§5.2.4).
    const r = compileSource(`<program>
<a> = ""
<on> = false
<button onclick=@a = "s" hidden=@on;>x</button>
</program>
`);
    expect(mshErrors(r)).toEqual([]);
    const e = (r.errors ?? []).find((d) => d.code === "E-ATTR-MULTI-STATEMENT");
    expect(e).toBeDefined();
    expect(e.message).toContain("attribute `hidden`");
  });

  test("trailing attribute is not pulled into the fix-it", () => {
    const r = compileSource(top(`<button onclick=@count = 0; track("x") class="y">r</button>`));
    const [e] = mshErrors(r);
    expect(e.message).toContain('`onclick={ @count = 0; track("x") }`');
  });
});

// ---------------------------------------------------------------------------
// §5 — the braced fix compiles and emits every statement
// ---------------------------------------------------------------------------

describe("§5 the braced form compiles and its handler body carries every statement", () => {
  test("`onclick={ @count = 0; track(\"reset\") }` — reactive set AND the call, in order", () => {
    const r = compileSource(`<program>
<count> = 5
\${ function track(x) { @count = @count + 1 } }
<button onclick={ @count = 0; track("reset") }>r</button>
</program>
`);
    expect(r.errors.filter((e) => e.severity !== "warning").length).toBe(0);
    const js = r.clientJs;
    // Emitted shape: `"_scrml_attr_onclick_1": function(_scrml_event) { <set>; <call>; },`
    const handler = js.match(/["']_scrml_attr_onclick_\d+["']\s*:\s*function\(_scrml_event\)\s*\{[^\n]*\}/)?.[0] ?? "";
    expect(handler).not.toBe("");
    const setAt = handler.search(/_scrml_\w*reactive_set\(\s*["']count["']\s*,\s*0\s*\)/);
    const callAt = handler.search(/track\w*\(\s*["']reset["']\s*\)/);
    expect(setAt).toBeGreaterThanOrEqual(0);
    expect(callAt).toBeGreaterThan(setAt);
  });
});

// ---------------------------------------------------------------------------
// §6 — bareHandlerStatementsText
// ---------------------------------------------------------------------------

describe("§6 bareHandlerStatementsText", () => {
  const at = (text, semis) => semis.map((s) => text.indexOf(";", s));
  test("head through the last `;` plus one tail statement", () => {
    const t = ` onclick=@count = 0; track("reset") class="y"`;
    const v = t.indexOf("@");
    expect(bareHandlerStatementsText(t, v, at(t, [0]))).toBe(`@count = 0; track("reset")`);
  });
  test("tail assignment spans its operator", () => {
    const t = ` onclick=f(); @msg = "a b"`;
    const v = t.indexOf("f");
    expect(bareHandlerStatementsText(t, v, at(t, [0]))).toBe(`f(); @msg = "a b"`);
  });
  test("trailing `;` with no tail drops the separator", () => {
    const t = ` onclick=@count = 0;`;
    const v = t.indexOf("@");
    expect(bareHandlerStatementsText(t, v, at(t, [0]))).toBe(`@count = 0`);
  });
  test("empty hit list returns empty string", () => {
    expect(bareHandlerStatementsText(" onclick=f()", 9, [])).toBe("");
  });
});

describe("§6b attrShapedTokenInStatements", () => {
  test("a swallowed attribute after the first statement is reported", () => {
    expect(attrShapedTokenInStatements(`@a = "s" hidden=@on`)).toBe("hidden");
    expect(attrShapedTokenInStatements(`f(); @a = 1 data-x=2`)).toBe("data-x");
  });
  test("a statement's own leading assignment is not an attribute", () => {
    expect(attrShapedTokenInStatements(`@count = 0; track("reset")`)).toBe(null);
    expect(attrShapedTokenInStatements(`x=1; y=2`)).toBe(null);
    expect(attrShapedTokenInStatements(`@msg="a"; f()`)).toBe(null);
  });
  test("`==` / `=>` and `name=` inside strings, parens or braces are not attributes", () => {
    expect(attrShapedTokenInStatements(`@a = b ==c; f()`)).toBe(null);
    expect(attrShapedTokenInStatements(`@a = "x y=1"; f()`)).toBe(null);
    expect(attrShapedTokenInStatements(`f(a, b=1); g()`)).toBe(null);
    expect(attrShapedTokenInStatements(`@a = list.map(x => x); f()`)).toBe(null);
  });
});

// ---------------------------------------------------------------------------
// §7 — inline-block handlers keep EVERY statement, in order, at every position
// (g-each-row-event-handler-keeps-only-first-statement,
//  g-expr-handler-drops-every-statement-after-a-leading-call)
// ---------------------------------------------------------------------------

describe("§7 inline-block handlers emit every statement in order at every position", () => {
  const src = `<program>
type Phase:enum = { Idle, Loading }
<ph>: Phase = .Idle
<a> = 0
<items> = [{ id: 1, name: "x" }]
\${ function track(n) { @a = @a + 10 } }
<button onclick={ @a = 11; track("TOPA") }>t</button>
<button onclick={ track("TOPC"); @a = 12 }>t</button>
<button onclick=\${track("TOPX"); @a = 13}>t</button>
<engine for=Phase initial=.Idle>
    <Idle>
        <button onclick={ @a = 21; track("ENGA") }>e</button>
        <button onclick={ track("ENGC"); @a = 22 }>e</button>
    </>
    <Loading><p>l</p></>
</>
<match on=@ph>
    <Idle>
        <button onclick={ @a = 31; track("MA") }>m</button>
        <button onclick={ track("MC"); @a = 32 }>m</button>
    </>
    <Loading><p>l</p></>
</>
<ul><each in=@items key=@.id>
    <li><button onclick={ @a = 41; track(@.name) }>r</button><button onclick={ track("EC"); @a = 42 }>r</button><button onclick=\${track("EX"); @a = 43}>r</button></li>
</each></ul>
</program>
`;
  const r = compileSource(src);
  const js = r.clientJs;
  // Every emitted handler function, one per line in the output.
  const handlers = js.split("\n").filter((l) => /function\(_scrml_event\) \{/.test(l));
  const handlerWith = (needle) => handlers.find((h) => h.includes(needle)) ?? "";
  const setOf = (n) => new RegExp(`_scrml_\\w*reactive_set\\("a", ${n}\\)`);
  const callOf = (arg) => new RegExp(`_scrml_track_\\d+\\(${arg}\\)`);
  const inOrder = (h, first, second) => {
    const i = h.search(first);
    const j = h.search(second);
    return i >= 0 && j > i;
  };

  test("compiles clean", () => {
    expect(r.errors.filter((e) => e.severity !== "warning" && e.severity !== "info")).toEqual([]);
  });

  const cases = [
    ["top level, assignment-led", '"TOPA"', setOf(11), callOf('"TOPA"')],
    ["top level, call-led", '"TOPC"', callOf('"TOPC"'), setOf(12)],
    ["top level, `${…; …}` call-led", '"TOPX"', callOf('"TOPX"'), setOf(13)],
    ["engine state-child, assignment-led", '"ENGA"', setOf(21), callOf('"ENGA"')],
    ["engine state-child, call-led", '"ENGC"', callOf('"ENGC"'), setOf(22)],
    ["match arm, assignment-led", '"MA"', setOf(31), callOf('"MA"')],
    ["match arm, call-led", '"MC"', callOf('"MC"'), setOf(32)],
    ["each row, assignment-led reading the row item `@.name`", "_scrml_each_item.name", setOf(41), callOf("_scrml_each_item\\.name")],
    ["each row, call-led", '"EC"', callOf('"EC"'), setOf(42)],
    ["each row, `${…; …}` call-led", '"EX"', callOf('"EX"'), setOf(43)],
  ];
  for (const [name, needle, first, second] of cases) {
    test(name, () => {
      const h = handlerWith(needle);
      expect(h).not.toBe("");
      expect(inOrder(h, first, second)).toBe(true);
    });
  }

  test("a 1-statement block is byte-identical to the bare shape (SPEC: equivalent)", () => {
    const one = compileSource(`<program>
<a> = 0
\${ function track(n) { @a = 1 } }
<button onclick={ track("one") }>t</button>
</program>
`).clientJs;
    const bare = compileSource(`<program>
<a> = 0
\${ function track(n) { @a = 1 } }
<button onclick=\${track("one")}>t</button>
</program>
`).clientJs;
    const pick = (js) => js.split("\n").find((l) => l.includes('"one"')) ?? "";
    expect(pick(one)).not.toBe("");
    expect(pick(one)).toBe(pick(bare));
  });
});

// ---------------------------------------------------------------------------
// §8 — S437 round 3: the handler statement list is PARSED (function-body
// statement parser), never split as text. F1–F4 from the re-review plus the
// shape list, in all four positions.
// ---------------------------------------------------------------------------


/** The parsed handler value of the first `onclick` in `src` (a <program> body). */
function handlerValue(handler) {
  const src = `<program>\n<s> = "a;b"\n<n> = 0\n<button onclick=${handler}>x</button>\n</program>\n`;
  const tab = buildAST(splitBlocks("h.scrml", src));
  let found = null;
  const seen = new Set();
  const walk = (n) => {
    if (found || !n || typeof n !== "object" || seen.has(n)) return;
    seen.add(n);
    if (Array.isArray(n)) { n.forEach(walk); return; }
    if (n.name === "onclick" && n.value) { found = n.value; return; }
    Object.values(n).forEach(walk);
  };
  walk(tab.ast);
  return found;
}
const stmtKinds = (v) => (v && v.handlerBlock ? v.handlerBlock.stmts.map((s) => s.kind) : null);

describe("§8a the statement count comes from the parse, not from `;` / newlines in the text", () => {
  test("F1 — a comment-only line is not a statement: ONE statement (multi-line → lowered from the list)", () => {
    // Round 4 #1: a multi-line value lowers from its parsed statement list
    // whatever the count, because the older path splits at newlines.
    expect(stmtKinds(handlerValue('{\n    // record the click\n    track("c")\n}'))).toEqual(["bare-expr"]);
  });
  test("F1 — `${ a; // tail\\n }` is one statement", () => {
    expect(stmtKinds(handlerValue('${ track("c"); // tail\n }'))).toBe(null);
  });
  test("F1 — comments between two statements: exactly two statements", () => {
    expect(stmtKinds(handlerValue('{\n  // a\n  f(1)\n  // b\n  f(2)\n  // c\n}'))).toEqual(["bare-expr", "bare-expr"]);
  });
  test("`/* ; */` between statements: two statements, the comment is not one", () => {
    expect(stmtKinds(handlerValue("{ f(1); /* ; */ f(2) }"))).toEqual(["bare-expr", "bare-expr"]);
  });
  test("F2 — a `.method()` continuation line is one statement", () => {
    expect(stmtKinds(handlerValue("{ go(1)\n    .toString() }"))).toEqual(["bare-expr"]);
    expect(stmtKinds(handlerValue("{ fetchX()\n    .then(r => r) }"))).toEqual(["bare-expr"]);
  });
  test("leading `?` / `:` and a trailing operator continue the statement", () => {
    expect(stmtKinds(handlerValue("{ @n = @n > 5\n ? 1\n : 2\n f(@n) }"))).toEqual(["state-decl", "bare-expr"]);
    expect(stmtKinds(handlerValue("{ @n = 1 +\n 2\n f(@n) }"))).toEqual(["state-decl", "bare-expr"]);
  });
  test("F3 — braceless `if … else` is ONE if-stmt carrying its alternate", () => {
    const v = handlerValue('{ if (@n > 0) f(1); else f(2)\n f(3) }');
    expect(stmtKinds(v)).toEqual(["if-stmt", "bare-expr"]);
    expect(v.handlerBlock.stmts[0].alternate).toHaveLength(1);
  });
  test("F4 — `${ /;/.test(@s) && go(1) }` stays ONE expression (the regex `;` is not a separator)", () => {
    expect(stmtKinds(handlerValue("${ /;/.test(@s) && go(1) }"))).toBe(null);
  });
  test("a template literal holding `;` and a newline is one string", () => {
    expect(stmtKinds(handlerValue("{ @s = `x;\ny`; f(@s) }"))).toEqual(["state-decl", "bare-expr"]);
  });
  test("closures and IIFEs are one expression", () => {
    expect(stmtKinds(handlerValue("${() => { f(1); f(2) }}"))).toBe(null);
    expect(stmtKinds(handlerValue("${(function(){ f(1); f(2) })()}"))).toBe(null);
  });
  test("`const` then use, and a loop in a block", () => {
    expect(stmtKinds(handlerValue('{ const k = "a"\n f(k) }'))).toEqual(["const-decl", "bare-expr"]);
    expect(stmtKinds(handlerValue("{ for (const x of [1, 2]) { f(x) } f(9) }"))).toEqual(["for-stmt", "bare-expr"]);
  });
});

// Every shape, in all four positions. `P` in a template is the position tag.
const SHAPES = [
  ["F1 comment-only line", '{\n            // record the click\n            t("P")\n        }', ['"P"']],
  ["F1 comment lines between statements", '{\n            // first\n            t("P1")\n            // second\n            t("P2")\n        }', ['"P1"', '"P2"']],
  ["F1 trailing line comments", '{ t("P1") // one\n            t("P2") // two\n        }', ['"P1"', '"P2"']],
  ["F1 `${ // note … }`", '${ // note\n            t("P1"); t("P2") }', ['"P1"', '"P2"']],
  ["F1 `${ a; // tail }`", '${ t("P"); // tail\n        }', ['"P"']],
  ["`/* ; */` block comment", '{ t("P1"); /* ; */ t("P2") }', ['"P1"', '"P2"']],
  ["F2 `.concat` continuation", '{ @s = "P"\n            .concat("x")\n            t(@s) }', ['"P"\\.concat\\("x"\\)', "_t_\\d+\\("]],
  ["F2 `.map` / `.then`-style continuation line", '{ ["P"]\n            .map((v) => t(v)) }', ['\\["P"\\]\\s*\\.map']],
  ["leading `?` / `:` continuation", '{ @n = @n > 5\n            ? 1\n            : 2\n            t("P" + @n) }', ["\\? 1 : 2", '"P" \\+']],
  ["trailing-operator continuation", '{ @n = 1 +\n            2\n            t("P" + @n) }', ["1 \\+ 2", '"P" \\+']],
  ["F3 braceless if … else", '{ if (@n > 5) t("Pa"); else t("Pb")\n            t("P") }', ['"Pa"', "else", '"Pb"', '"P"\\)']],
  ["braced if … else", '{ if (@n > 5) { t("Pa") } else { t("Pb") } t("P") }', ['"Pa"', "else", '"Pb"', '"P"\\)']],
  ["F4 regex with `;` (expression form)", '${ /;/.test(@s) && t("P") }', ["/;/\\.test"]],
  ["regex with `;` in a block", '{ @n = /;/.test(@s) ? 1 : 0; t("P" + @n) }', ["/;/\\.test", '"P" \\+']],
  ["template literal with `;` and newline", '{ @s = `x;\ny`; t("P" + @s.length) }', ["`x;\\ny`", '"P" \\+']],
  ["`const` then use", '{ const k = "P"\n            t(k + "k") }', ['const k = "P"', "k \\+ \"k\""]],
  ["loop in a block", '{ for (const x of [1, 2]) { t("P" + x) } t("P9") }', ["for \\(const x of", '"P9"']],
];

function fourPositions(tpl) {
  const h = (P) => tpl.split("P").join(P);
  return `<program>
type Phase:enum = { Idle, Loading }
<ph>: Phase = .Idle
<log> = ""
<n> = 0
<s> = "a;b"
<items> = [{ id: 1, name: "r" }]
\${ function t(x) { @log = @log + x + "," } }
<button id="top" onclick=${h("T")}>top</button>
<engine for=Phase initial=.Idle>
    <Idle>
        <button id="eng" onclick=${h("E")}>engine</button>
    </>
    <Loading : "Loading…">
</>
<match on=@ph>
    <Idle>
        <button id="mat" onclick=${h("M")}>match</button>
    </>
    <Loading><p>Loading…</p></>
</>
<ul><each in=@items key=@.id>
    <li><button class="row" onclick=${h("R")}>\${@.name}</button></li>
</each></ul>
</program>
`;
}

describe("§8b every shape compiles and emits its statements in order, in all four positions", () => {
  for (const [name, tpl, markers] of SHAPES) {
    test(name, () => {
      const r = compileSource(fourPositions(tpl));
      const errs = r.errors.filter((e) => e.severity !== "warning" && e.severity !== "info");
      expect(errs.map((e) => e.code)).toEqual([]);
      // One listener per position; find it by its position tag, then check the
      // markers appear in order within it.
      const lines = r.clientJs.split(/(?=function\(_scrml_event\) \{)/);
      for (const P of ["T", "E", "M", "R"]) {
        const tagged = markers.map((m) => m.split("P").join(P));
        const handler = lines.find((l) => new RegExp(tagged[tagged.length - 1]).test(l.slice(0, 600)) && new RegExp(tagged[0]).test(l.slice(0, 600))) ?? "";
        expect(handler).not.toBe("");
        let at = 0;
        for (const m of tagged) {
          const idx = handler.slice(at).search(new RegExp(m));
          expect(idx).toBeGreaterThanOrEqual(0);
          at += idx + 1;
        }
      }
    });
  }
});

describe("§8c braceless `if … else` in an ordinary function body keeps its else (shared parser fix)", () => {
  test("`if (c) a; else b` — else branch is conditional, not unconditional", () => {
    const r = compileSource(`<program>
<a> = 0
<r> = ""
\${ function pick() { if (@a > 0) @r = "pos"; else @r = "neg" } }
<button onclick=pick()>p</button>
</program>
`);
    const fn = r.clientJs.slice(r.clientJs.indexOf("function _scrml_pick"));
    expect(fn).toMatch(/\{\s*_scrml_\w*reactive_set\("r", "pos"\);\s*\}\s*else \{\s*_scrml_\w*reactive_set\("r", "neg"\);\s*\}/);
  });
  test("newline-separated `if (c) a\\n else b`", () => {
    const r = compileSource(`<program>
<a> = 0
<r> = ""
\${ function pick() {
    if (@a > 0) @r = "pos"
    else @r = "neg"
} }
<button onclick=pick()>p</button>
</program>
`);
    const fn = r.clientJs.slice(r.clientJs.indexOf("function _scrml_pick"));
    expect(fn).toMatch(/\}\s*else \{\s*_scrml_\w*reactive_set\("r", "neg"\);\s*\}/);
  });
  test("an `if` with no else followed by `;;` and another statement is unchanged", () => {
    const v = handlerValue("{ if (@n > 0) f(1);; f(2) }");
    expect(v.handlerBlock.stmts[0].alternate).toBe(null);
    expect(stmtKinds(v)).toEqual(["if-stmt", "bare-expr"]);
  });
});

// ---------------------------------------------------------------------------
// §9 — S437 round 4 (review items #1–#5)
// ---------------------------------------------------------------------------

const codesOf = (r) => r.errors.filter((e) => e.severity !== "warning" && e.severity !== "info").map((e) => e.code);
const prog = (body) => `<program>\n<n> = 3\n<r> = 0\n<r2> = 0\n<a> = true\n\${ function h() { @r2 = 9 } }\n${body}\n</program>\n`;

describe("§9a #4 — a BRACED consequent then `;` then `else` is rejected (the else-lookahead is braceless-only)", () => {
  const rejects = [
    ["handler: `{ if (@a) { @r = 1 }; else @r = 2 }`", "<button onclick={ if (@a) { @r = 1 }; else @r = 2 }>x</button>"],
    ["handler: `};⏎ else { … }`", "<button onclick={ if (@a) { @r = 1 };\n else { @r = 2 } }>x</button>"],
    ["function body: `if (@a) { @r = 1 }; else @r = 2`", "${ function f() { if (@a) { @r = 1 }; else @r = 2 } }\n<button onclick=f()>x</button>"],
    ["function body: `};⏎ else { … }` (base compiled this via leaked text)", "${ function f() {\n  if (@a) { @r = 1 };\n  else { @r = 2 }\n} }\n<button onclick=f()>x</button>"],
  ];
  for (const [name, body] of rejects) {
    test(name, () => {
      expect(codesOf(compileSource(prog(body)))).toContain("E-STMT-UNEXPECTED-TOKEN");
    });
  }
  test("value position `const v = if (@a) { lift 1 };⏎ else { … }` is still rejected, as on base", () => {
    const r = compileSource(prog("<button onclick={ const v = if (@a) { lift 1 };\n else { @r = 2 }\n @r = v }>x</button>"));
    expect(codesOf(r).length).toBeGreaterThan(0);
  });
  test("control: braceless `if (@a) @r = 1; else @r = 2` and adjacent `} else {` still attach", () => {
    const v1 = handlerValue("{ if (@n > 0) f(1); else f(2)\n f(3) }");
    expect(v1.handlerBlock.stmts[0].alternate).toHaveLength(1);
    const r = compileSource(prog("<button onclick={ if (@a) { @r = 1 } else { @r = 2 } }>x</button>"));
    expect(codesOf(r)).toEqual([]);
  });
});

describe("§9b #1 — a ONE-statement handler continued onto another line lowers from its parsed statement", () => {
  const cases = [
    ["leading `+` line", "{ @r = @n\n    + 1 }", /reactive_set\("r", _scrml_\w*reactive_get\("n"\) \+ 1\)/],
    ["leading `?` line", "{ @r = @n\n    ? 1 : 2 }", /reactive_set\("r", _scrml_\w*reactive_get\("n"\) \? 1 : 2\)/],
    ["trailing `?`", "{ @r = @n ?\n    1 : 2 }", /reactive_set\("r", _scrml_\w*reactive_get\("n"\) \? 1 : 2\)/],
    ["trailing `*`", "{ @r = @n *\n    2 }", /reactive_set\("r", _scrml_\w*reactive_get\("n"\) \* 2\)/],
    ["`${…}` form, leading `+` line", "${ @r = @n\n    + 1 }", /reactive_set\("r", _scrml_\w*reactive_get\("n"\) \+ 1\)/],
  ];
  for (const [name, handler, rx] of cases) {
    test(name, () => {
      const r = compileSource(prog(`<button onclick=${handler}>x</button>`));
      expect(codesOf(r)).toEqual([]);
      const line = r.clientJs.split("\n").find((l) => l.includes('"_scrml_attr_onclick_1"')) ?? "";
      expect(line).toMatch(rx);
      // exactly one statement: no orphaned `+ 1;` / `? 1 : 2;` / `* 2;` fragment
      expect(line).not.toMatch(/;\s*[+?*]/);
    });
  }
  test("single-LINE single statements keep the existing path (byte-identical to base)", () => {
    expect(stmtKinds(handlerValue("{ h() }"))).toBe(null);
    expect(stmtKinds(handlerValue("{ @r = @n + 1 }"))).toBe(null);
  });
  test("callables keep the existing path whatever their length (installed/invoked, not dead statements)", () => {
    expect(stmtKinds(handlerValue("${() => h()}"))).toBe(null);
    expect(stmtKinds(handlerValue("${() => {\n    h()\n    @r = 2\n}}"))).toBe(null);
  });
});

describe("§9c #2 — a statement SEQUENCE the statement parser rejects is reported, never silently truncated", () => {
  const cases = [
    ["`${ () => @r = 1; @r2 = 2 }`", "${ () => @r = 1; @r2 = 2 }", "E-STMT-MISSING-SEMICOLON"],
    ["`${ (e) => { @r = 1 }; @r2 = 2 }`", "${ (e) => { @r = 1 }; @r2 = 2 }", "E-SYNTAX-043"],
    ["`{ () => @r = 1; @r2 = 2 }`", "{ () => @r = 1; @r2 = 2 }", "E-STMT-MISSING-SEMICOLON"],
    ["`{ try {…} catch (e) {…}; h() }` → E-TRY-NOT-IN-SCRML", "{ try { h() } catch (e) { h() }; h() }", "E-TRY-NOT-IN-SCRML"],
  ];
  for (const [name, handler, code] of cases) {
    test(name, () => {
      expect(codesOf(compileSource(prog(`<button onclick=${handler}>x</button>`)))).toContain(code);
    });
    test(`${name} — also inside an <each> row (the error-discarding sub-build forwards it)`, () => {
      const r = compileSource(prog(`<ul><each in=[1] as it><li><button onclick=${handler}>x</button></li></each></ul>`));
      expect(codesOf(r)).toContain(code);
    });
  }
  test("control: ONE arrow `${() => @n = @n + 1}` (no top-level `;`) is not reported", () => {
    expect(codesOf(compileSource(prog("<button onclick=${() => @n = @n + 1}>x</button>")))).toEqual([]);
  });
});

describe("§9d #3 — statements 2..n get the same scope / state checks as a function body", () => {
  test("`{ @n = 2; nope2(1) }` → E-SCOPE-001", () => {
    expect(codesOf(compileSource(prog("<button onclick={ @n = 2; nope2(1) }>x</button>")))).toContain("E-SCOPE-001");
  });
  test("`{ @n = 1; @zz = 3 }` → E-STATE-UNDECLARED", () => {
    expect(codesOf(compileSource(prog("<button onclick={ @n = 1; @zz = 3 }>x</button>")))).toContain("E-STATE-UNDECLARED");
  });
  test("each row `{ @n = it; nope3(it) }` → E-SCOPE-001 (it used to RUN unchecked)", () => {
    const r = compileSource(prog("<ul><each in=[1] as it><li><button onclick={ @n = it; nope3(it) }>x</button></li></each></ul>"));
    expect(codesOf(r)).toContain("E-SCOPE-001");
  });
  test("each row `{ @n = 1; @zz = 3 }` → E-STATE-UNDECLARED (SYM never walks each bodies; TS does)", () => {
    const r = compileSource(prog("<ul><each in=[1] as it><li><button onclick={ @n = 1; @zz = 3 }>x</button></li></each></ul>"));
    expect(codesOf(r)).toContain("E-STATE-UNDECLARED");
  });
  // (s457 3a — `event` left this list: an inline block does not bind it, so a
  // free `event` there is E-EVENT-UNBOUND; pinned in
  // s457-unquoted-values-and-event.test.js.)
  test("no false positives: the row alias, `@.`, declared cells, locals", () => {
    const r = compileSource(prog(`<ul><each in=[1] as it><li><button onclick={ @n = it; console.log(it) }>x</button><button onclick={ @n = @.; const k = @n + 1\n @r = k }>y</button></li></each></ul>`));
    expect(codesOf(r)).toEqual([]);
  });
});

describe("§9e #5 — no 'statement boundary not detected' warning when the statements ARE handled", () => {
  test("a multi-line multi-statement handler prints no such warning", () => {
    const seen = [];
    const orig = console.warn;
    console.warn = (...a) => { seen.push(a.join(" ")); };
    try {
      // `h(); h()⏎ h()`: the value's expression view parses up to the `;` and
      // finds trailing statements across a newline — the shape that printed the
      // warning on the round-3 code (measured), although all three statements
      // are lowered from the parsed statement list.
      compileSource(prog('<button onclick={ h(); h()\n    h() }>x</button>'));
    } finally {
      console.warn = orig;
    }
    expect(seen.filter((w) => w.includes("statement boundary not detected"))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// §10 — S437 round 5 (review F1–F4)
// ---------------------------------------------------------------------------

describe("§10a F1 — a COMMENT between a braced `}` and `else` is whitespace (only `;` ends the if)", () => {
  const fb = (body) => `<program>\n<a> = true\n<r> = 0\n\${ function f() {\n${body}\n} }\n<button onclick=f()>x</button>\n</program>\n`;
  const ok = [
    ["function body `} // c⏎ else {`", fb("  if (@a) { @r = 1 } // c\n  else { @r = 2 }")],
    ["function body `} /* c */ else {`", fb("  if (@a) { @r = 1 } /* c */ else { @r = 2 }")],
    ["function body own-line comment before `else`", fb("  if (@a) { @r = 1 }\n  // c\n  else { @r = 2 }")],
    ["function body own-line comments in an `else if` chain", fb("  if (@a) { @r = 1 }\n  // c\n  else if (@r > 5) { @r = 2 }\n  // d\n  else { @r = 3 }")],
    ["top-level logic `} // c⏎ else {`", "<program>\n<a> = true\n<r> = 0\n${\n  if (@a) { @r = 1 } // c\n  else { @r = 2 }\n}\n</program>\n"],
    ["value-form `${ if @a {\"A\"} // x⏎ else {\"B\"} }`", "<program>\n<a> = true\n<p>${ if @a {\"A\"} // x\n else {\"B\"} }</p>\n</program>\n"],
    ["handler `{ if (@a) { … } // c⏎ else { … } }`", "<program>\n<a> = true\n<r> = 0\n<button onclick={ if (@a) { @r = 1 } // c\n else { @r = 2 } }>x</button>\n</program>\n"],
  ];
  for (const [name, src] of ok) {
    test(name, () => {
      const r = compileSource(src);
      expect(codesOf(r)).toEqual([]);
      expect(r.clientJs).toMatch(/\}\s*else\s*\{/);
    });
  }
  test("`} ; // c⏎ else` is still rejected (round 4 #4) and the message names the `;`", () => {
    const r = compileSource(fb("  if (@a) { @r = 1 }; // c\n  else { @r = 2 }"));
    const e = r.errors.find((x) => x.code === "E-STMT-UNEXPECTED-TOKEN");
    expect(e).toBeDefined();
    expect(e.message).toContain("The `;` before it ends the `if` statement");
  });
  test("the parsed if-stmt carries the alternate across the comment", () => {
    const v = handlerValue("{ if (@n > 0) { f(1) } // c\n else { f(2) }\n f(3) }");
    expect(stmtKinds(v)).toEqual(["if-stmt", "bare-expr"]);
    expect(v.handlerBlock.stmts[0].alternate).toHaveLength(1);
  });
});

// §10b F2 — REMOVED FROM THIS CHANGE at landing (S437). Round 5 lowered
// `${@cell}` inside client template literals by re-scanning template text; the
// review found that scanner silently miscompiles (a quote in a regex / comment
// inside `${…}` truncates the interior; nested templates lose `\` escapes). The
// client template path is back to base, and the work is its own arc:
// g-client-template-interpolation-lowering-needs-a-structural-emitter
// (docs/known-gaps.md). The template-in-handler regression it leaves is pinned
// as XFAIL in conformance (markup-handler/s437-r5-template-cell-read-*,
// reactive/s437-r5-template-cell-read-*). Only the base-true control stays here.
describe("§10b the client template path is unchanged (base behaviour)", () => {
  test("a template with no cell is emitted unchanged", () => {
    const r = compileSource(`<program>\n<s> = ""\n\${ function f() { const k = 2\n @s = \`k=\${k + 1}\` } }\n<button onclick=f()>x</button>\n</program>\n`);
    expect(codesOf(r)).toEqual([]);
    expect(r.clientJs).toContain("`k=${k + 1}`");
  });
});

describe("§10c F3 — a non-fatal notice does not disqualify the statement list", () => {
  test("`{ @r = 7; @m = [\"DAL\": 3, \"DAL\": 5] }` compiles, runs both, surfaces the notice once", () => {
    const r = compileSource(`<program>\n<r> = 0\n<m> = [:]\n<button onclick={ @r = 7; @m = [ "DAL": 3, "DAL": 5 ] }>x</button>\n</program>\n`);
    expect(codesOf(r)).toEqual([]);
    const line = r.clientJs.split("\n").find((l) => l.includes('"_scrml_attr_onclick_1"')) ?? "";
    expect(line).toMatch(/reactive_set\("r", 7\).*reactive_set\("m", _scrml_map_from_entries/);
    const dir = mkdtempSync(join(tmpdir(), "scrml-s437-f3-"));
    try {
      const f = join(dir, "app.scrml");
      writeFileSync(f, `<program>\n<r> = 0\n<m> = [:]\n<button onclick={ @r = 7; @m = [ "DAL": 3, "DAL": 5 ] }>x</button>\n</program>\n`);
      const res = compileScrml({ inputFiles: [f], write: false });
      const all = [...(res.errors ?? []), ...(res.warnings ?? [])].filter((d) => d.code === "W-MAP-DUPLICATE-LITERAL-KEY");
      expect(all).toHaveLength(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("§10d F4 — no boundary warning for a <match>-arm handler whose statements are handled", () => {
  test("`t(1) // one⏎ t(2)` in a match arm prints no 'statement boundary not detected'", () => {
    const seen = [];
    const orig = console.warn;
    console.warn = (...a) => { seen.push(a.join(" ")); };
    let r;
    try {
      r = compileSource(`<program>
type Phase:enum = { Idle, Busy }
<ph>: Phase = .Idle
<log> = ""
\${ function t(x) { @log = @log + x + "," } }
<match on=@ph>
    <Idle><button onclick={ t(1) // one
        t(2) }>m</button></>
    <Busy><p>b</p></>
</>
</program>
`);
    } finally {
      console.warn = orig;
    }
    expect(seen.filter((w) => w.includes("statement boundary not detected"))).toEqual([]);
    expect(codesOf(r)).toEqual([]);
    const line = r.clientJs.split("\n").find((l) => l.includes('"_scrml_attr_onclick_1"')) ?? "";
    expect(line).toMatch(/_t_\d+\(1\);\s*_scrml_t_\d+\(2\)/);
  });
});
