/**
 * Kickstarter v2 §3 smoke tests — Phase A1a Step 11
 *
 * Smoke-tests the canonical scrml example corpus from
 * `docs/articles/llm-kickstarter-v2-2026-05-04.md` §3 (V5-strict access model)
 * + §3.1 (the three RHS shapes), exercising:
 *
 *   - Shape 1 plain reactive cell                       (`<count> = 0`)
 *   - Shape 2 decl-coupled-with-render-spec             (`<userName req length(>=2)> = <input/>`)
 *   - Shape 3 derived (`const <derived> = expr`)        (numeric, string, markup-typed)
 *   - `default=` attribute (Step 6)                     (`<startTime default=null> = ...`)
 *   - V5-strict access cluster (decl + read + write)    (`@count = @count + 1` in fns)
 *   - Render-by-tag use site                            (`<userName/>` in markup)
 *   - Compound field-write inside fns                   (`@formRes.error = msg`)
 *
 * **Step 11 is verification + tests only — no source changes.** All positive
 * tests assert the AST shape contract from Steps 4-10. Every positive test
 * also fires the `assertNoHtmlFragmentMatching` anti-test guard (the
 * deceptive-success pattern from PARSER-AUDIT §C.1 / §G.1).
 *
 * **Step 11 survey divergences — status updates:**
 *
 *   §K11.1A — Variant C compound RECOGNIZED (resolved by Step 11.0a). Prior
 *     to 11.0a the form `<formRes><name>=""<email>=""</>` collapsed to
 *     `html-fragment`; the recognizer extension produces a compound state-decl
 *     parent with `children: [...child state-decls]` per AST-CONTRACTS §1.1.
 *     The two anti-test memorials previously marked TODO[step-11.0a] are
 *     flipped to positive assertions in §K11.1A.
 *
 *   §K11.2A — Multi-decl using newlines as separators RECOGNIZED (resolved by
 *     Step 11.0b). Prior to 11.0b the form `<a>=0\n<b>=1` parsed as a single
 *     state-decl with the second decl eaten as raw text in `init`. The
 *     `collectExpr` ASI-NEWLINE branch was extended to detect a state-decl
 *     shape opener (`<` PUNCT + IDENT + state-decl lookahead) at the start
 *     of a new line as a statement boundary. The 1 anti-test memorial
 *     previously marked TODO[step-11.0b] is flipped to positive assertion in
 *     §K11.2A.
 *
 *   §K11.3A — Typed-decl `<x>: T = expr` and Tier 3 positional
 *     `<userInfo>: UserInfo = (...)` RECOGNIZED (resolved by Step 11.0c).
 *     `scanStructuralDeclLookahead` was extended to fire on `>` followed
 *     by `:`; `tryParseStructuralDecl` consumes the type expression via
 *     the existing `collectTypeAnnotation` helper, then proceeds with
 *     standard markup-RHS / expression-RHS dispatch. The resulting
 *     state-decl carries `typeAnnotation: string`. The 2 anti-test
 *     memorials previously marked TODO[step-11.0c] are flipped to
 *     positive assertions in §K11.3A + §K11.3A-b.
 *
 * **Render-by-tag (BRIEF §1.2) WORKS today.** Parser produces a markup AST
 * node tagged with the cell name. The actual render-spec EXPANSION (rewriting
 * `<userName/>` → `<input bind:value=...>`) is A1c work — out of scope here.
 *
 * **Spec authority:**
 *   §6.1 / §6.2 / §6.3 / §6.4   — V5-strict, RHS shapes, compound, render-by-tag
 *   §AST-CONTRACTS-AND-DECOMPOSITION §1.1 / §1.2 — state-decl + render-spec
 *   §kickstarter-v2 §3 / §3.1   — canonical example corpus
 */

import { describe, test, expect } from "bun:test";
import { splitBlocks } from "../../src/block-splitter.js";
import { buildAST } from "../../src/ast-builder.js";

function parse(source) {
  const bs = splitBlocks("test.scrml", source);
  return buildAST(bs);
}

/** Walk an AST recursively and collect every node with `kind === target`. */
function findKind(ast, target) {
  const out = [];
  const seen = new WeakSet();
  function walk(n) {
    if (!n || typeof n !== "object" || seen.has(n)) return;
    seen.add(n);
    if (Array.isArray(n)) { n.forEach(walk); return; }
    if (n.kind === target) out.push(n);
    for (const k of Object.keys(n)) {
      if (k === "span" || k === "parent" || k === "block") continue;
      walk(n[k]);
    }
  }
  walk(ast);
  return out;
}

/**
 * Anti-test helper: assert no html-fragment node's `content` matches the
 * given regex. Catches the deceptive-success pattern where `<count>=0`
 * compiles clean but parses as raw text.
 */
function assertNoHtmlFragmentMatching(ast, regex) {
  const fragments = findKind(ast, "html-fragment");
  for (const f of fragments) {
    expect(f.content || "").not.toMatch(regex);
  }
}

// =============================================================================
// §K11.1 — V5-strict access model cluster (kickstarter v2 §3 lines 145-164)
// =============================================================================
//
// Distilled cluster: `<count> = 0` declaration + `inc`/`clear` functions
// reading and writing `@count`. Step 11.0b extended newline-as-separator
// to sibling state-decls; the original kickstarter v2 §3 multi-decl form
// is now exercised positively in §K11.2A.
//
// We exercise the working semicolon-separated form here for ALL three
// statements + an extra `function describe()` body that includes a `let count`
// local (which today does NOT trigger E-NAME-COLLIDES-STATE — A1b territory).
// The function name `reset` from the kickstarter source is paraphrased to
// `clear` to dodge E-RESERVED-IDENTIFIER (the kickstarter intentionally
// shows that error firing; we test parser-shape, not error firing).
// =============================================================================

describe("Kickstarter v2 §3 K11.1 — V5-strict access cluster", () => {
  test("§K11.1: <count>=0 + 3 functions all parse to correct shapes (semicolon-separated)", () => {
    const src = `<program>\${ <count> = 0; function inc() { @count = @count + 1 }; function clear() { @count = 0 }; function describe() { let count = "five" } }</program>`;
    const { ast, errors } = parse(src);
    expect(errors.length).toBe(0);

    const stateDecls = findKind(ast, "state-decl");
    const fns = findKind(ast, "function-decl");
    const lets = findKind(ast, "let-decl");

    // The structural <count>=0 outer decl + the two inner @-form re-assigns
    // (`@count = @count + 1` and `@count = 0`) are all ALSO captured as
    // state-decl nodes in inc()/clear() body — because the legacy @-form
    // recognition produces state-decl too (Step 2 progress confirmed this).
    // So we expect: 1 outer (struct) + 2 inner (legacy @-form) = 3 state-decls.
    expect(stateDecls.length).toBe(3);
    const outer = stateDecls.find((d) => d.structuralForm === true);
    expect(outer).toBeDefined();
    expect(outer.name).toBe("count");
    expect(outer.shape).toBe("plain");
    expect(outer.isConst).toBe(false);

    // Three function declarations: inc, clear, describe
    expect(fns.length).toBe(3);
    const fnNames = fns.map((f) => f.name).sort();
    expect(fnNames).toEqual(["clear", "describe", "inc"]);

    // describe() has `let count = "five"` — the local. A1b will fire
    // E-NAME-COLLIDES-STATE here later; for parser-shape we just check
    // the let-decl exists.
    const localCount = lets.find((l) => l.name === "count");
    expect(localCount).toBeDefined();
    expect(localCount.init).toContain("five");

    // Anti-test: the entire source must NOT collapse to html-fragment
    assertNoHtmlFragmentMatching(ast, /<\s*count\s*>/);
  });
});

// =============================================================================
// §K11.2 — Three RHS shapes triplet (kickstarter v2 §3.1 lines 203-220)
// =============================================================================
//
// kickstarter v2 §3.1 shows the three RHS shapes side-by-side. We split into
// per-shape single-decl probes for clarity. Step 11.0b enables newline-only
// multi-decl separation; §K11.2A exercises the positive form.
// =============================================================================

describe("Kickstarter v2 §3.1 K11.2 — three RHS shapes", () => {
  // Shape 1 — plain reactive cells. Each is a separate single-decl block.
  test("§K11.2a Shape 1 plain numeric: <count> = 0", () => {
    const src = `<program>\${ <count> = 0 }</program>`;
    const { ast, errors } = parse(src);
    expect(errors.length).toBe(0);
    const decls = findKind(ast, "state-decl");
    expect(decls.length).toBe(1);
    expect(decls[0].name).toBe("count");
    expect(decls[0].shape).toBe("plain");
    expect(decls[0].structuralForm).toBe(true);
    expect(decls[0].isConst).toBe(false);
    assertNoHtmlFragmentMatching(ast, /<\s*count\s*>/);
  });

  test("§K11.2b Shape 1 plain string: <name> = \"\"", () => {
    const src = `<program>\${ <name> = "" }</program>`;
    const { ast, errors } = parse(src);
    expect(errors.length).toBe(0);
    const decls = findKind(ast, "state-decl");
    expect(decls.length).toBe(1);
    expect(decls[0].name).toBe("name");
    expect(decls[0].shape).toBe("plain");
    assertNoHtmlFragmentMatching(ast, /<\s*name\s*>/);
  });

  test("§K11.2c Shape 1 plain array: <items> = []", () => {
    const src = `<program>\${ <items> = [] }</program>`;
    const { ast, errors } = parse(src);
    expect(errors.length).toBe(0);
    const decls = findKind(ast, "state-decl");
    expect(decls.length).toBe(1);
    expect(decls[0].name).toBe("items");
    expect(decls[0].shape).toBe("plain");
    assertNoHtmlFragmentMatching(ast, /<\s*items\s*>/);
  });

  // Shape 2 — decl-coupled-with-render-spec
  test("§K11.2d Shape 2: <userName req length(>=2)> = <input type=\"text\"/>", () => {
    const src = `<program>\${ <userName req length(>=2)> = <input type="text"/> }</program>`;
    const { ast, errors } = parse(src);
    expect(errors.length).toBe(0);
    const decls = findKind(ast, "state-decl");
    expect(decls.length).toBe(1);
    const d = decls[0];
    expect(d.name).toBe("userName");
    expect(d.shape).toBe("decl-with-spec");
    expect(d.structuralForm).toBe(true);
    expect(d.isConst).toBe(false);
    expect(d.initExpr).toBeNull();
    expect(d.renderSpec).toBeDefined();
    expect(d.renderSpec.kind).toBe("render-spec");
    expect(d.renderSpec.element.kind).toBe("markup");
    expect(d.renderSpec.element.tag).toBe("input");
    // Validators: req (bareword) + length(>=2) (call-form)
    expect(Array.isArray(d.validators)).toBe(true);
    expect(d.validators.length).toBe(2);
    const reqV = d.validators.find((v) => v.name === "req");
    const lenV = d.validators.find((v) => v.name === "length");
    expect(reqV).toBeDefined();
    expect(reqV.args).toBeNull();
    expect(lenV).toBeDefined();
    expect(Array.isArray(lenV.args)).toBe(true);
    expect(lenV.args.length).toBe(1);
    // Phase A1b Step B9: args[0] is a RelationalPredicateNode (not raw text).
    expect(lenV.args[0].kind).toBe("relational-predicate");
    expect(lenV.args[0].op).toBe(">=");
    expect(lenV.args[0].value.kind).toBe("lit");
    expect(lenV.args[0].value.value).toBe(2);
    assertNoHtmlFragmentMatching(ast, /<\s*userName/);
  });

  test("§K11.2e Shape 2 checkbox: <agree req> = <input type=\"checkbox\"/>", () => {
    const src = `<program>\${ <agree req> = <input type="checkbox"/> }</program>`;
    const { ast, errors } = parse(src);
    expect(errors.length).toBe(0);
    const decls = findKind(ast, "state-decl");
    expect(decls.length).toBe(1);
    const d = decls[0];
    expect(d.name).toBe("agree");
    expect(d.shape).toBe("decl-with-spec");
    expect(d.validators.length).toBe(1);
    expect(d.validators[0].name).toBe("req");
    expect(d.renderSpec.element.tag).toBe("input");
    assertNoHtmlFragmentMatching(ast, /<\s*agree/);
  });

  // Shape 3 — derived (read-only)
  test("§K11.2f Shape 3 numeric derived: const <doubled> = @count * 2", () => {
    const src = `<program>\${ <count> = 0; const <doubled> = @count * 2 }</program>`;
    const { ast, errors } = parse(src);
    expect(errors.length).toBe(0);
    const decls = findKind(ast, "state-decl");
    expect(decls.length).toBe(2);
    const doubled = decls.find((d) => d.name === "doubled");
    expect(doubled).toBeDefined();
    expect(doubled.shape).toBe("derived");
    expect(doubled.structuralForm).toBe(true);
    expect(doubled.isConst).toBe(true);
    expect(doubled.init).toContain("@count");
    assertNoHtmlFragmentMatching(ast, /<\s*doubled\s*>/);
  });

  test("§K11.2g Shape 3 string derived: const <greeting> = \"Hello, \" + @userName", () => {
    const src = `<program>\${ <userName> = ""; const <greeting> = "Hello, " + @userName }</program>`;
    const { ast, errors } = parse(src);
    expect(errors.length).toBe(0);
    const decls = findKind(ast, "state-decl");
    expect(decls.length).toBe(2);
    const greeting = decls.find((d) => d.name === "greeting");
    expect(greeting).toBeDefined();
    expect(greeting.shape).toBe("derived");
    expect(greeting.isConst).toBe(true);
    expect(greeting.init).toContain("Hello");
    expect(greeting.init).toContain("@userName");
    assertNoHtmlFragmentMatching(ast, /<\s*greeting\s*>/);
  });

  test("§K11.2h Shape 3 markup-typed derived: const <badge> = <span class=\"badge\">${@userName}</span>", () => {
    const src = `<program>\${ <userName> = <input type="text"/>; const <badge> = <span class="badge">\${@userName}</span> }</program>`;
    const { ast, errors } = parse(src);
    expect(errors.length).toBe(0);
    const decls = findKind(ast, "state-decl");
    expect(decls.length).toBe(2);
    const badge = decls.find((d) => d.name === "badge");
    expect(badge).toBeDefined();
    // Markup-typed derived: parser routes it to shape:"decl-with-spec" today
    // (renderSpec wraps the markup). This is consistent with how Step 5's
    // Shape 2 routes any markup-RHS form. The semantic distinction between
    // "Shape 2 decl-coupled-with-render-spec" (bindable input markup) and
    // "Shape 3 markup-typed derived" (display markup) is A1b's job — A1b
    // checks for `isConst` to discriminate. Today both share the same kind.
    expect(["decl-with-spec", "derived"]).toContain(badge.shape);
    expect(badge.isConst).toBe(true);
    expect(badge.structuralForm).toBe(true);
    assertNoHtmlFragmentMatching(ast, /<\s*badge\s*>/);
  });
});

// =============================================================================
// §K11.2i — Plain JS const vs reactive derived (kickstarter v2 §3.1 lines 234-237)
// =============================================================================
//
// Kickstarter v2 §3.1 explicitly contrasts the two forms side-by-side:
//   const items = [{name: "apple"}]                // plain JS const, bare-name
//   const <filteredItems> = items.filter(...)      // reactive derived cell, @-access
//
// Single-decl-per-block is illustrated; Step 11.0b also enables the
// newline-separated multi-decl form (see §K11.2A).
// =============================================================================

describe("Kickstarter v2 §3.1 K11.2i — plain JS const vs reactive derived", () => {
  test("§K11.2i-a: `const items = [...]` produces const-decl (NOT state-decl)", () => {
    const src = `<program>\${ const items = [{name: "apple"}, {name: "banana"}] }</program>`;
    const { ast, errors } = parse(src);
    expect(errors.length).toBe(0);
    const stateDecls = findKind(ast, "state-decl");
    const constDecls = findKind(ast, "const-decl");
    expect(stateDecls.length).toBe(0);
    expect(constDecls.length).toBe(1);
    expect(constDecls[0].name).toBe("items");
    // Plain const: shape field NOT set (it's not a state-decl)
    expect(constDecls[0].shape).toBeUndefined();
  });

  test("§K11.2i-b: const items + const <filteredItems> coexist as different kinds", () => {
    const src = `<program>\${ const items = [1,2,3]; const <filteredItems> = items.filter(x => x > 1) }</program>`;
    const { ast, errors } = parse(src);
    expect(errors.length).toBe(0);
    const stateDecls = findKind(ast, "state-decl");
    const constDecls = findKind(ast, "const-decl");
    // Plain const → const-decl
    expect(constDecls.length).toBe(1);
    expect(constDecls[0].name).toBe("items");
    // Reactive derived → state-decl shape:"derived" isConst:true
    expect(stateDecls.length).toBe(1);
    const filtered = stateDecls[0];
    expect(filtered.name).toBe("filteredItems");
    expect(filtered.shape).toBe("derived");
    expect(filtered.structuralForm).toBe(true);
    expect(filtered.isConst).toBe(true);
    // init is whitespace-normalized post-tokenizer (`a.b` → `a . b`)
    expect(filtered.init.replace(/\s+/g, "")).toContain("items.filter");
    assertNoHtmlFragmentMatching(ast, /<\s*filteredItems\s*>/);
  });
});

// =============================================================================
// §K11.3 — `default=` attribute (kickstarter v2 §3.1 lines 242-244 + Step 6)
// =============================================================================

describe("Kickstarter v2 §3.1 K11.3 — default= attribute", () => {
  test("§K11.3a <startTime default=null> = 0 carries defaultExpr", () => {
    const src = `<program>\${ <startTime default=null> = 0 }</program>`;
    const { ast, errors } = parse(src);
    expect(errors.length).toBe(0);
    const decls = findKind(ast, "state-decl");
    expect(decls.length).toBe(1);
    const d = decls[0];
    expect(d.name).toBe("startTime");
    expect(d.shape).toBe("plain");
    expect(d.structuralForm).toBe(true);
    // Step 6 contract: defaultExpr field on the decl
    expect(d.defaultExpr).toBeDefined();
    expect(d.defaultExpr).not.toBeNull();
    assertNoHtmlFragmentMatching(ast, /<\s*startTime/);
  });

  test("§K11.3b <retries default=0> = 0 carries defaultExpr", () => {
    const src = `<program>\${ <retries default=0> = 0 }</program>`;
    const { ast, errors } = parse(src);
    expect(errors.length).toBe(0);
    const decls = findKind(ast, "state-decl");
    expect(decls.length).toBe(1);
    expect(decls[0].name).toBe("retries");
    expect(decls[0].defaultExpr).toBeDefined();
    assertNoHtmlFragmentMatching(ast, /<\s*retries/);
  });
});

// =============================================================================
// §K11.4 — Render-by-tag use site (BRIEF §1.2 + SPEC §6.4)
// =============================================================================
//
// **WORKS today.** `<userName/>` in markup parses to a markup AST node with
// tag matching the cell name. The render-spec EXPANSION (`<userName/>` →
// `<input bind:value=@userName ...>`) is A1c work — out of scope here.
// =============================================================================

describe("Kickstarter v2 BRIEF §1.2 K11.4 — render-by-tag use site", () => {
  test("§K11.4a <userName/> in markup produces markup node with tag=userName", () => {
    const src = `<program>\${ <userName req length(>=2)> = <input type="text"/> }<form><userName/></form></program>`;
    const { ast, errors } = parse(src);
    expect(errors.length).toBe(0);
    // Decl side: the Shape 2 cell is recognized
    const decls = findKind(ast, "state-decl");
    expect(decls.length).toBe(1);
    expect(decls[0].name).toBe("userName");
    expect(decls[0].shape).toBe("decl-with-spec");
    // Use side: a markup node with tag="userName" appears inside <form>
    const markups = findKind(ast, "markup");
    const userNameUseSite = markups.filter((m) => m.tag === "userName");
    // One markup tag (from <userName/> use site) + the <input> in renderSpec
    // also has tag='input'. We just confirm at least one userName-tagged
    // markup node exists (the use-site one).
    expect(userNameUseSite.length).toBeGreaterThanOrEqual(1);
    // Confirm a <form> wraps it (use-site context)
    const forms = markups.filter((m) => m.tag === "form");
    expect(forms.length).toBe(1);
    assertNoHtmlFragmentMatching(ast, /<\s*userName/);
  });

  test("§K11.4b bare <userName/> in markup produces markup node (no decl needed)", () => {
    // Render-by-tag at parse level doesn't require the decl to exist;
    // A1b/A1c will validate. Step 11 only confirms parse-shape.
    const src = `<program><userName/></program>`;
    const { ast, errors } = parse(src);
    expect(errors.length).toBe(0);
    const markups = findKind(ast, "markup");
    const userNameMarkup = markups.find((m) => m.tag === "userName");
    expect(userNameMarkup).toBeDefined();
    expect(userNameMarkup.kind).toBe("markup");
  });
});

// =============================================================================
// §K11.5 — Compound field-write inside fn (kickstarter v2 §3 lines 184-187)
// =============================================================================
//
// `@formRes.error = msg` inside a function body parses correctly because
// it's the "MemberAssignment" shape (Step 10's `reactive-nested-assign`
// specialization). Doesn't depend on the Variant C compound parent being
// recognized — the @-form access is what the parser sees.
// =============================================================================

describe("Kickstarter v2 §3 K11.5 — compound field-write", () => {
  test("§K11.5: function setError(msg) { @formRes.error = msg } parses cleanly", () => {
    const src = `<program>\${ function setError(msg) { @formRes.error = msg } }</program>`;
    const { ast, errors } = parse(src);
    expect(errors.length).toBe(0);
    const fns = findKind(ast, "function-decl");
    expect(fns.length).toBe(1);
    expect(fns[0].name).toBe("setError");
    // Body should contain the @formRes.error assignment — Step 10 confirmed
    // this lowers to `kind: "reactive-nested-assign"`.
    const nestedAssigns = findKind(ast, "reactive-nested-assign");
    expect(nestedAssigns.length).toBe(1);
    expect(nestedAssigns[0].target).toBe("formRes");
    expect(Array.isArray(nestedAssigns[0].path)).toBe(true);
    expect(nestedAssigns[0].path).toEqual(["error"]);
  });
});

// =============================================================================
// §K11.1A — Variant C compound recognized (Step 11.0a — kickstarter v2 §3)
// =============================================================================
//
// The flagship kickstarter v2 §3 example `<formRes><name>=""<email>=""</>` is
// a Variant C compound declaration (SPEC §6.3.2 Tier 2). Step 11.0a extended
// `tryParseStructuralDecl` to recognize this form: parent state-decl with
// `children: [...child state-decl nodes]`, parent `shape:"plain"`,
// `initExpr:null`, `structuralForm:true`, `isConst:false`.
//
// History: prior to Step 11.0a these two tests were anti-test memorials of
// today's broken html-fragment fallback. With the recognizer extension landed,
// they assert the positive AST shape per AST-CONTRACTS-AND-DECOMPOSITION §1.1.
// =============================================================================

describe("Kickstarter v2 §3 K11.1A — Variant C compound recognized", () => {
  test("§K11.1A: `<formRes><name>=\"\" <email>=\"\" <error>=\"\" </>` produces compound parent + 3 children", () => {
    const src = `<program>\${ <formRes><name>="" <email>="" <error>="" </> }</program>`;
    const { ast, errors } = parse(src);
    expect(errors.length).toBe(0);
    const decls = findKind(ast, "state-decl");
    // 1 parent + 3 children = 4 state-decl nodes (findKind walks recursively)
    expect(decls.length).toBe(4);
    // Locate parent — it has children populated.
    const parent = decls.find((d) => d.name === "formRes");
    expect(parent).toBeDefined();
    expect(parent.shape).toBe("plain");
    expect(parent.structuralForm).toBe(true);
    expect(parent.isConst).toBe(false);
    expect(parent.initExpr).toBe(null);
    expect(Array.isArray(parent.children)).toBe(true);
    expect(parent.children.length).toBe(3);
    const childNames = parent.children.map((c) => c.name);
    expect(childNames).toEqual(["name", "email", "error"]);
    for (const c of parent.children) {
      expect(c.kind).toBe("state-decl");
      expect(c.shape).toBe("plain");
      expect(c.structuralForm).toBe(true);
      expect(c.isConst).toBe(false);
    }
    // Anti-html-fragment guard — no fragment carries the compound source text.
    assertNoHtmlFragmentMatching(ast, /formRes/);
  });

  test("§K11.1A-b: multi-line compound `<formRes>\\n  <name>=\"\"\\n</>` produces compound parent + 1 child", () => {
    const src = `<program>\${
      <formRes>
        <name> = ""
      </>
    }</program>`;
    const { ast, errors } = parse(src);
    expect(errors.length).toBe(0);
    const decls = findKind(ast, "state-decl");
    expect(decls.length).toBe(2); // parent + 1 child
    const parent = decls.find((d) => d.name === "formRes");
    expect(parent).toBeDefined();
    expect(parent.shape).toBe("plain");
    expect(parent.children.length).toBe(1);
    expect(parent.children[0].name).toBe("name");
    expect(parent.children[0].shape).toBe("plain");
    assertNoHtmlFragmentMatching(ast, /formRes/);
  });
});

// =============================================================================
// §K11.2A — Multi-decl with newline-only separator RECOGNIZED (Step 11.0b)
// =============================================================================
//
// Step 11.0b extended `collectExpr`'s ASI-NEWLINE branch (in `ast-builder.js`)
// to recognize state-decl shape openers (`<` PUNCT + IDENT + state-decl
// lookahead) at the start of a new line as statement boundaries. Newline +
// state-decl-shape-ahead AND lastTok ends a value → break.
//
// Critical invariants preserved:
//   - Same-line `a < b` comparisons NOT broken (newline-gated).
//   - Multi-line legitimate expressions like `<x> = @a +\n@b` NOT truncated
//     (`+` is not an value-ending token, `lastEndsValue` is false).
//   - Shape 2 markup-RHS multi-line (`<x> = <input\n type="text"/>`)
//     NOT regressed (parseLiftTag handles markup, angleDepth tracking).
// =============================================================================

describe("Kickstarter v2 §3 K11.2A — multi-decl newline separator (Step 11.0b)", () => {
  test("§K11.2A: `<a>=0\\n<b>=1` (newline-only) produces TWO state-decls, no eaten sibling", () => {
    const src = `<program>\${
      <a> = 0
      <b> = 1
    }</program>`;
    const { ast, errors } = parse(src);
    expect(errors.length).toBe(0);
    const decls = findKind(ast, "state-decl");
    expect(decls.length).toBe(2);
    const names = decls.map((d) => d.name).sort();
    expect(names).toEqual(["a", "b"]);
    // Each decl carries its own init; sibling is NOT eaten.
    const aDecl = decls.find((d) => d.name === "a");
    const bDecl = decls.find((d) => d.name === "b");
    expect(aDecl.init).toBe("0");
    expect(bDecl.init).toBe("1");
    // Both should be Shape 1 plain.
    expect(aDecl.shape).toBe("plain");
    expect(bDecl.shape).toBe("plain");
    // Anti-deceptive-success: no html-fragment carrying the eaten raw text.
    assertNoHtmlFragmentMatching(ast, /<\s*a\s*>|<\s*b\s*>/);
  });

  test("§K11.2A-b: working baseline — semicolon separator DOES work today", () => {
    const src = `<program>\${ <a> = 0; <b> = 1 }</program>`;
    const { ast, errors } = parse(src);
    expect(errors.length).toBe(0);
    const decls = findKind(ast, "state-decl");
    expect(decls.length).toBe(2);
    const names = decls.map((d) => d.name).sort();
    expect(names).toEqual(["a", "b"]);
    // Semicolon mode preserved alongside newline mode.
  });

  test("§K11.2A-c: working baseline — newline separates decl-from-fn (legacy preserved)", () => {
    const src = `<program>\${
      <count> = 0
      function inc() { @count = @count + 1 }
    }</program>`;
    const { ast, errors } = parse(src);
    expect(errors.length).toBe(0);
    const decls = findKind(ast, "state-decl");
    const fns = findKind(ast, "function-decl");
    // The legacy newline-as-separator handling between a state-decl and a
    // function-decl still works (function is a keyword-anchored statement
    // start). Step 11.0b complements that for state-decl-then-state-decl.
    expect(fns.length).toBe(1);
    expect(fns[0].name).toBe("inc");
    // outer state-decl should be present and clean (no eaten sibling)
    const outer = decls.find((d) => d.structuralForm === true);
    expect(outer).toBeDefined();
    expect(outer.name).toBe("count");
    expect(outer.init).toBe("0");
  });
});

// =============================================================================
// §K11.3A — Typed compound + typed Shape 1 RECOGNIZED (Step 11.0c)
// =============================================================================
//
// `<count>: number = 0` (typed Shape 1) and `<userInfo>: UserInfo = (...)`
// (Tier 3 positional sugar per §14.11) are now recognized. Step 11.0c
// extended `scanStructuralDeclLookahead` to fire on `>` followed by `:`
// and `tryParseStructuralDecl` to consume the type expression via the
// existing `collectTypeAnnotation` helper.
//
// Per AST-CONTRACTS-AND-DECOMPOSITION §1.1, the resulting state-decl
// carries `typeAnnotation: string` (raw type text). A1b owns
// type-checking + bare-variant resolution + Tier 3 positional binding;
// A1c emits runtime predicates from refinement-type forms.
//
// **§K11.X-DIVERGENCE-3 RESOLVED.** Anti-test memorials §K11.X-D3a +
// §K11.X-D3b flipped to positive assertions §K11.3A + §K11.3A-b.
// =============================================================================

describe("Kickstarter v2 §3 K11.3A — typed compound + typed Shape 1 (RECOGNIZED)", () => {
  test("§K11.3A: `<count>: number = 0` (typed Shape 1) → state-decl with typeAnnotation", () => {
    const src = `<program>\${ <count>: number = 0 }</program>`;
    const { ast, errors } = parse(src);
    expect(errors.length).toBe(0);
    const decls = findKind(ast, "state-decl");
    expect(decls.length).toBe(1);
    const d = decls[0];
    expect(d.name).toBe("count");
    expect(d.init).toBe("0");
    expect(d.typeAnnotation).toBe("number");
    expect(d.shape).toBe("plain");
    expect(d.structuralForm).toBe(true);
    expect(d.isConst).toBe(false);
    assertNoHtmlFragmentMatching(ast, /<\s*count\s*>/);
    assertNoHtmlFragmentMatching(ast, /:\s*number/);
  });

  test("§K11.3A-b: `<userInfo>: UserInfo = (\"alice\", 30, true)` (Tier 3 positional) → state-decl with typeAnnotation + tuple init", () => {
    const src = `<program>\${ <userInfo>: UserInfo = ("alice", 30, true) }</program>`;
    const { ast, errors } = parse(src);
    expect(errors.length).toBe(0);
    const decls = findKind(ast, "state-decl");
    expect(decls.length).toBe(1);
    const d = decls[0];
    expect(d.name).toBe("userInfo");
    // Tuple-form init — acorn parses as SequenceExpression (cross-ref §14.11
    // worked example). A1b's typed-compound resolver interprets positionally.
    expect(d.init).toContain("alice");
    expect(d.init).toContain("30");
    expect(d.init).toContain("true");
    expect(d.typeAnnotation).toBe("UserInfo");
    expect(d.shape).toBe("plain");
    expect(d.structuralForm).toBe(true);
    expect(d.isConst).toBe(false);
    assertNoHtmlFragmentMatching(ast, /<\s*userInfo\s*>/);
    assertNoHtmlFragmentMatching(ast, /:\s*UserInfo/);
  });
});
