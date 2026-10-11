/**
 * markup-text-in-logic-body-s462 — the TEXT of a markup element written at
 * statement position in a logic body is text, not statements.
 *
 * SPEC §4.18.1: a plain-markup element body is a free-text body — "In a free-text
 * body a bare run is **display text**, literal by default, left only by the exit
 * sequences of §4.18.1b" — and "Body modes nest. A plain-markup element opened
 * *inside* a code-default body … opens a **free-text-mode** body".
 *
 * Pre-fix (s462-given-body-text-as-code): in `${ given @u :> { <p>${@u.name} - ${@n}</p> } }`
 * the ` - ` between the two interpolations parsed as a STATEMENT (`-;` in the
 * client JS, E-CODEGEN-INVALID-LOGIC), and display text `track(@n)` parsed as a
 * call that RAN. The executed-DOM half of this pin is
 * compiler/tests/browser/browser-markup-text-not-code-s462.browser.test.js.
 */

import { describe, test, expect } from "bun:test";
import { splitBlocks } from "../../src/block-splitter.js";
import { buildAST } from "../../src/ast-builder.js";

function build(src) {
  const bs = splitBlocks("/test/app.scrml", src);
  return buildAST(bs);
}

/** Every node of `kind` anywhere in the tree. */
function findAll(root, kind) {
  const out = [];
  const seen = new Set();
  const walk = (n) => {
    if (!n || typeof n !== "object" || seen.has(n)) return;
    seen.add(n);
    if (n.kind === kind) out.push(n);
    for (const v of Object.values(n)) if (v && typeof v === "object") walk(v);
  };
  walk(root);
  return out;
}

const PRE = "<program>\n@u = { name: \"bob\" }\n@n = 3\n";
const POST = "\n</program>\n";

describe("markup text in a logic body is text (s462-given-body-text-as-code)", () => {
  test("`${@u.name} - ${@n}` in a given guard body: the ` - ` is an html-fragment, not a statement", () => {
    const { ast } = build(PRE + "<div>${ given @u :> { <p>${@u.name} - ${@n}</p> } }</div>" + POST);
    const [guard] = findAll(ast, "given-guard");
    expect(guard).toBeDefined();
    expect(guard.body.map((n) => n.kind)).toEqual(["html-fragment", "logic", "html-fragment", "logic", "html-fragment"]);
    expect(guard.body[2].content.trim()).toBe("-");
    expect(guard.body.some((n) => n.kind === "bare-expr")).toBe(false);
  });

  test("display text with calls, `;`, `(`, `)` and keywords stays one text run — no statement nodes", () => {
    const { ast } = build(PRE + "<div>${ given @u :> { <p>${@u.name} track(@n) a + b; if (x) return; const z = 1; while (true) {} ${@n}</p> } }</div>" + POST);
    const [guard] = findAll(ast, "given-guard");
    const kinds = guard.body.map((n) => n.kind);
    expect(kinds).toEqual(["html-fragment", "logic", "html-fragment", "logic", "html-fragment"]);
    const text = guard.body[2].content;
    for (const piece of ["track", "(", "@n", ")", "a", "+", "b", ";", "if", "return", "const", "z", "while", "true", "{", "}"]) {
      expect(text).toContain(piece);
    }
    // The only statements anywhere in the guard are the two interpolations' own reads.
    const bare = findAll(guard, "bare-expr").map((n) => n.expr);
    expect(bare).toEqual(["@u.name", "@n"]);
    for (const k of ["if-stmt", "return-stmt", "const-decl", "let-decl", "while-stmt"]) {
      expect(findAll(guard, k)).toEqual([]);
    }
  });

  test("the canonical `if (@u is given) { … }` body is read the same way", () => {
    const { ast } = build(PRE + "<div>${ if (@u is given) { <p>${@u.name} track(@n) ${@n}</p> } }</div>" + POST);
    const [ifs] = findAll(ast, "if-stmt");
    expect(ifs.consequent.map((n) => n.kind)).toEqual(["html-fragment", "logic", "html-fragment", "logic", "html-fragment"]);
    expect(findAll(ifs, "bare-expr").filter((n) => /track/.test(n.expr ?? ""))).toEqual([]);
  });

  test("nested tags and text between them inside the element are one markup run each", () => {
    const { ast } = build(PRE + "<div>${ given @u :> { <div><b>${@u.name}</b> track(@n) <i>${@n}</i> - x</div> } }</div>" + POST);
    const [guard] = findAll(ast, "given-guard");
    expect(guard.body.every((n) => n.kind === "html-fragment" || n.kind === "logic")).toBe(true);
    expect(guard.body.filter((n) => n.kind === "logic").length).toBe(2);
  });

  test("a top-level `${ <p>${a} … ${b}</p> }`: no statement is made of the text", () => {
    const { ast } = build(PRE + "<div>${ <p>${@u.name} track(@n) ${@n}</p> }</div>" + POST);
    expect(findAll(ast, "bare-expr").filter((n) => /track/.test(String(n.expr ?? "")))).toEqual([]);
  });

  test("a markup element on the line after a statement is a new statement, not part of the value", () => {
    const { ast } = build(PRE + "<div>${ given @u :> { let k = 1\n  <p>${@u.name} track(@n) ${@n}</p> } }</div>" + POST);
    const [guard] = findAll(ast, "given-guard");
    const [decl] = findAll(guard, "let-decl");
    expect(decl).toBeDefined();
    expect(String(decl.init ?? "")).not.toContain("<");
    expect(guard.body.slice(1).map((n) => n.kind)).toEqual(["html-fragment", "logic", "html-fragment", "logic", "html-fragment"]);
  });

  test("a `<` comparison continued on the next line is unaffected", () => {
    const { ast } = build("<program>\n${\n  let a = 1\n  let ok = a\n    < 5\n}\n</program>\n");
    const decls = findAll(ast, "let-decl");
    const ok = decls.find((d) => d.name === "ok");
    expect(ok).toBeDefined();
    expect(String(ok.init ?? "")).toMatch(/a\s*<\s*5/);
  });

  test("an element with no interpolation is unchanged (one html-fragment)", () => {
    const { ast } = build(PRE + "<div>${ given @u :> { <p>track(@n) a + b</p> } }</div>" + POST);
    const [guard] = findAll(ast, "given-guard");
    expect(guard.body.map((n) => n.kind)).toEqual(["html-fragment"]);
  });

  test("a `<script>` opener in a text run is still refused (§4.17)", () => {
    const { errors } = build(PRE + "<div>${ given @u :> { <p>${@u.name} <script>x</script> ${@n}</p> } }</div>" + POST);
    expect((errors ?? []).some((e) => /SCRIPT|RAW|E-MARKUP|E-SCRIPT/i.test(String(e.code)))).toBe(true);
  });
});
