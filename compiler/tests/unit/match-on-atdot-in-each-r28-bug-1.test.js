/**
 * match-on-atdot-in-each-r28-bug-1.test.js — Bug R28-1 + R28-1b regression guard.
 *
 * R28-1 (gate-fire closure): a block-form `<match for=T on=@.field>` nested
 * inside an `<each ... as alias>` body MUST lower the `@.` contextual
 * iteration sigil to the enclosing each's current-iteration variable —
 * IDENTICAL codegen to the author-written `on=alias.field` form
 * (SPEC §17.7.3: "@.field and the as-bound name produce identical codegen").
 * Pre-R28-1 the raw `@.` survived into the dispatcher invocation
 * (`__scrml_match_match_NNN_dispatch(@.field)`) — invalid JS, gate-caught by
 * E-CODEGEN-INVALID-LOGIC (`Unexpected character '@'`).
 *
 * R28-1b (S143 — architectural closure): R28-1 lowered the sigil but the
 * dispatch was still emitted at MODULE scope (`_scrml_effect(() =>
 * dispatch(article.status))`), where `article` is the per-item factory param —
 * UNDEFINED at module scope. R28-1b renders the block-form match PER ITEM
 * inside the `<each>` factory:
 *   - emit-match.ts emits an ITEM-SCOPED dispatch fn
 *     `__scrml_match_match_<id>_dispatch(_mount, _v)` (mount passed in, NO
 *     module-scope trigger) when the match-block's `enclosingEachIterVar` is
 *     stamped (it sits inside an each).
 *   - emit-each.ts (`renderTemplateChildToJs` match-block case) creates an
 *     item-local mount element and calls the dispatch fn with the live
 *     per-item discriminant (`@.status` -> `<iterVar>.status`) IN THE FACTORY
 *     SCOPE where the iter var IS bound.
 *
 * Consequently the `@.` -> iter-var lowering invariant this suite guards now
 * lives in the EACH consumer's per-item dispatch call (the `<iterVar>.field`
 * argument), NOT in the match consumer's module-scope trigger (which no longer
 * exists for match-in-each). The assertions below inspect the COMBINED
 * match+each body-render output (mirroring the real emit-client.ts ordering:
 * emitMatchBodyRenderForFile FIRST so `enclosingEachIterVar` is stamped, then
 * emitEachBodyRenderForFile).
 *
 * The harness drives the REAL parse path (block-splitter + ast-builder),
 * NOT a synthesized AST — per R26: a synthetic AST can pass while the real
 * BS/ast-builder path stays broken.
 *
 * Coverage:
 *   §1  `<match on=@.status>` inside `<each as article>` -> `article.status`
 *   §2  identical codegen: `on=@.status` === `on=article.status`
 *   §3  bare `@.` (no member) -> bare iter var
 *   §4  no `as`-alias -> synthetic `_scrml_each_item` iter var
 *   §5  emitted code passes JS syntax validity (no raw `@.`)
 *   §6  multi-match in same each (context-dependence) -> each lowers
 *   §7  nested `<each>` -> innermost iter var wins
 *   §8  match in `<empty>` body is NOT iter-scoped (no spurious lowering)
 *   §9  regression — match NOT inside any each: `@cell` Shape A unchanged
 *  §10  regression — match NOT inside any each: `@.` does not get rewritten
 *  §11  R28-1b — match-in-each dispatch fn is ITEM-SCOPED (no module trigger)
 */

import { describe, test, expect } from "bun:test";
import { splitBlocks } from "../../src/block-splitter.js";
import { buildAST } from "../../src/ast-builder.js";
import { emitMatchBodyRenderForFile } from "../../src/codegen/emit-match.ts";
import { emitEachBodyRenderForFile } from "../../src/codegen/emit-each.ts";

function parse(src) {
  const bs = splitBlocks("/tmp/r28-1-test.scrml", src);
  const tab = buildAST(bs, null);
  return tab.ast;
}

function makeCtx(fileAST) {
  return {
    fileAST,
    errors: [],
    csrfEnabled: false,
    registry: {
      logicBindings: [],
      eventBindings: [],
      pushArmContext: () => {},
      popArmContext: () => {},
      addLogicBinding(b) { this.logicBindings.push(b); },
      addEventBinding(b) { this.eventBindings.push(b); },
    },
    derivedNames: new Set(),
    encodingCtx: null,
  };
}

// Just the match consumer's output (dispatch fns + module-scope dispatchers).
function matchOutputOf(src) {
  const ast = parse(src);
  const out = emitMatchBodyRenderForFile(ast, makeCtx(ast));
  return [...out.renderFunctions, ...out.dispatchers].join("\n");
}

// COMBINED match+each output in real emit-client.ts order: match FIRST (stamps
// enclosingEachIterVar), then each (renders the per-item dispatch call). The
// per-item discriminant lowering (`@.field` -> `<iterVar>.field`) lives in the
// each render fn body, so the each output is where R28-1's invariant surfaces.
function combinedOf(src) {
  const ast = parse(src);
  const ctx = makeCtx(ast);
  const matchOut = emitMatchBodyRenderForFile(ast, ctx);
  const eachOut = emitEachBodyRenderForFile(ast, ctx);
  return [
    ...matchOut.renderFunctions,
    ...matchOut.dispatchers,
    ...eachOut.renderFunctions,
    ...eachOut.dispatchers,
  ].join("\n");
}

// Just the each consumer's render fns (where the per-item dispatch call lives).
function eachRenderOf(src) {
  const ast = parse(src);
  const ctx = makeCtx(ast);
  // Stamp enclosingEachIterVar via the match collector first, matching the
  // real pipeline ordering (emit-client.ts runs match before each).
  emitMatchBodyRenderForFile(ast, ctx);
  const eachOut = emitEachBodyRenderForFile(ast, ctx);
  return eachOut.renderFunctions.join("\n");
}

const TYPE_DECL = `\${
  type ArticleStatus:enum = { Draft, InReview, Published }
}`;

// ---------------------------------------------------------------------------
// §1: `<match on=@.status>` inside `<each as article>` -> `article.status`
// ---------------------------------------------------------------------------

describe("§1: on=@.status inside <each as article> lowers to article.status", () => {
  test("per-item dispatch call receives `article.status`, NOT raw `@.status`", () => {
    const src = `${TYPE_DECL}
<each in=@articles as article>
  <match for=ArticleStatus on=@.status>
    <Draft> : "d"
    <InReview> : "r"
    <Published> : "p"
  </match>
</each>
`;
    const each = eachRenderOf(src);
    // The per-item dispatch call lowers @.status to the iter var, in factory scope.
    expect(each).toMatch(/_dispatch\([^,]+,\s*article\.status\)/);
    // Regression guard: no raw `@.` reaches the dispatch call.
    expect(each).not.toMatch(/_dispatch\([^,]*,\s*@/);
  });
});

// ---------------------------------------------------------------------------
// §2: identical codegen — `on=@.status` === `on=article.status` (SPEC §17.7.3)
// ---------------------------------------------------------------------------

describe("§2: @.status form produces identical codegen to alias.status form", () => {
  test("both lower to `article.status` in the per-item dispatch call", () => {
    const sigilSrc = `${TYPE_DECL}
<each in=@articles as article>
  <match for=ArticleStatus on=@.status>
    <Draft> : "d"
    <InReview> : "r"
    <Published> : "p"
  </match>
</each>
`;
    const aliasSrc = `${TYPE_DECL}
<each in=@articles as article>
  <match for=ArticleStatus on=article.status>
    <Draft> : "d"
    <InReview> : "r"
    <Published> : "p"
  </match>
</each>
`;
    expect(combinedOf(sigilSrc)).toBe(combinedOf(aliasSrc));
  });
});

// ---------------------------------------------------------------------------
// §3: bare `@.` (no member) -> bare iter var
// ---------------------------------------------------------------------------

describe("§3: bare on=@. inside <each as st> lowers to the bare iter var", () => {
  test("per-item dispatch call receives `st`, NOT `@.`", () => {
    const src = `${TYPE_DECL}
<each in=@statuses as st>
  <match for=ArticleStatus on=@.>
    <Draft> : "d"
    <InReview> : "r"
    <Published> : "p"
  </match>
</each>
`;
    const each = eachRenderOf(src);
    expect(each).toMatch(/_dispatch\([^,]+,\s*st\)/);
    expect(each).not.toMatch(/_dispatch\([^,]*,\s*@/);
  });
});

// ---------------------------------------------------------------------------
// §4: no `as`-alias -> synthetic `_scrml_each_item` iter var
// ---------------------------------------------------------------------------

describe("§4: on=@.status inside <each> with NO alias uses synthetic iter var", () => {
  test("per-item dispatch call receives `_scrml_each_item.status`", () => {
    const src = `${TYPE_DECL}
<each in=@articles>
  <match for=ArticleStatus on=@.status>
    <Draft> : "d"
    <InReview> : "r"
    <Published> : "p"
  </match>
</each>
`;
    const each = eachRenderOf(src);
    expect(each).toMatch(/_dispatch\([^,]+,\s*_scrml_each_item\.status\)/);
    expect(each).not.toMatch(/_dispatch\([^,]*,\s*@/);
  });
});

// ---------------------------------------------------------------------------
// §5: emitted code is syntactically valid JS (no raw `@.`)
// ---------------------------------------------------------------------------

describe("§5: emitted match+each body render passes JS syntax check", () => {
  test("the combined body render parses as valid JS", () => {
    const src = `${TYPE_DECL}
<each in=@articles as article>
  <match for=ArticleStatus on=@.status>
    <Draft> : "d"
    <InReview> : "r"
    <Published> : "p"
  </match>
</each>
`;
    const js = combinedOf(src);
    // Stub the runtime surface; if raw `@.` had leaked, new Function throws.
    const wrapped = `
      var _scrml_effect = function () {};
      var _scrml_effect_static = function () {};
      var _scrml_reactive_get = function () { return []; };
      var _scrml_reconcile_list = function () {};
      var document = { querySelector: function () { return null; }, createElement: function () { return {}; }, createDocumentFragment: function () { return {}; }, createTextNode: function () { return {}; } };
      ${js}
    `;
    expect(() => new Function(wrapped)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// §6: multi-match in the SAME each (the context-dependence the gate caught)
// ---------------------------------------------------------------------------

describe("§6: two <match on=@.field> in one <each as a> each lower independently", () => {
  test("both per-item dispatch calls use the iter var; neither leaks raw @.", () => {
    const src = `\${
  type ArticleStatus:enum = { Draft, Published }
  type Priority:enum = { Low, High }
}
<each in=@items as a>
  <match for=ArticleStatus on=@.status>
    <Draft> : "d"
    <Published> : "p"
  </match>
  <match for=Priority on=@.priority>
    <Low> : "l"
    <High> : "h"
  </match>
</each>
`;
    const each = eachRenderOf(src);
    expect(each).toMatch(/_dispatch\([^,]+,\s*a\.status\)/);
    expect(each).toMatch(/_dispatch\([^,]+,\s*a\.priority\)/);
    expect(each).not.toMatch(/_dispatch\([^,]*,\s*@/);
  });
});

// ---------------------------------------------------------------------------
// §7: nested <each> -> the INNERMOST iter var wins (SPEC §17.7.3 last bullet)
// ---------------------------------------------------------------------------

describe("§7: nested <each> resolves @. to the innermost scope", () => {
  test("match in the inner each dispatches on the inner iter var", () => {
    const src = `${TYPE_DECL}
<each in=@articles as outer>
  <each in=@tags as inner>
    <match for=ArticleStatus on=@.status>
      <Draft> : "d"
      <InReview> : "r"
      <Published> : "p"
    </match>
  </each>
</each>
`;
    const each = eachRenderOf(src);
    expect(each).toMatch(/_dispatch\([^,]+,\s*inner\.status\)/);
    expect(each).not.toMatch(/_dispatch\([^,]+,\s*outer\.status\)/);
    expect(each).not.toMatch(/_dispatch\([^,]*,\s*@/);
  });
});

// ---------------------------------------------------------------------------
// §8: an <empty> sub-element present alongside a template match does NOT
//     disturb the template match's iter-var lowering. (Guards the walker's
//     templateChildren-vs-emptyChild scope split: the iter var is threaded
//     into templateChildren only.)
// ---------------------------------------------------------------------------

describe("§8: <empty> sub-element does not disturb template-match lowering", () => {
  test("template match on @.status still lowers to the iter var when <empty> is present", () => {
    const src = `${TYPE_DECL}
<each in=@articles as article>
  <match for=ArticleStatus on=@.status>
    <Draft> : "d"
    <InReview> : "r"
    <Published> : "p"
  </match>
  <empty>
    <p>none</p>
  </empty>
</each>
`;
    const each = eachRenderOf(src);
    expect(each).toMatch(/_dispatch\([^,]+,\s*article\.status\)/);
    expect(each).not.toMatch(/_dispatch\([^,]*,\s*@/);
  });
});

// ---------------------------------------------------------------------------
// §9: regression — match NOT inside any each: @cell Shape A unchanged
// ---------------------------------------------------------------------------

describe("§9: regression — top-level match on @cell unchanged", () => {
  test("on=@phase still uses _scrml_reactive_get (Shape A subscribe) + module dispatch", () => {
    const src = `\${
  type Phase:enum = { Idle, Done }
  <phase>: Phase = .Idle
}
<match for=Phase on=@phase>
  <Idle> : "i"
  <Done> : "d"
</match>
`;
    const js = matchOutputOf(src);
    expect(js).toContain('_scrml_reactive_get("phase")');
    // Top-level match keeps the module-scope subscribe trigger.
    expect(js).toContain('_scrml_reactive_subscribe("phase"');
    expect(js).not.toMatch(/_dispatch\(@/);
  });
});

// ---------------------------------------------------------------------------
// §10: regression — match NOT inside any each: `@.` is left to upstream
//      (E-SYNTAX-064) — codegen must NOT rewrite it to a phantom iter var.
// ---------------------------------------------------------------------------

describe("§10: regression — top-level @. is NOT lowered to a phantom iter var", () => {
  test("a top-level on=@.status (illegal per §17.7.3) keeps no iter-var rewrite", () => {
    const src = `${TYPE_DECL}
<match for=ArticleStatus on=@.status>
  <Draft> : "d"
  <InReview> : "r"
  <Published> : "p"
</match>
`;
    const js = matchOutputOf(src);
    // No enclosing each => no iter var stamped => no rewrite to `something.status`.
    expect(js).not.toContain("_scrml_each_item.status");
  });
});

// ---------------------------------------------------------------------------
// §11: R28-1b — a match-in-each dispatch fn is ITEM-SCOPED. The dispatch fn
//      takes the mount element as a parameter (one mount per item) and there
//      is NO module-scope trigger referencing the per-item iter var (the exact
//      R28-1b defect). The render fns stay item-agnostic (reused per item).
// ---------------------------------------------------------------------------

describe("§11: R28-1b match-in-each dispatch is item-scoped (no module trigger)", () => {
  test("dispatch fn takes (_mount, _v); no _scrml_effect(() => dispatch(iterVar))", () => {
    const src = `${TYPE_DECL}
<each in=@articles as article>
  <match for=ArticleStatus on=@.status>
    <Draft> : "d"
    <InReview> : "r"
    <Published> : "p"
  </match>
</each>
`;
    const ast = parse(src);
    const ctx = makeCtx(ast);
    const matchOut = emitMatchBodyRenderForFile(ast, ctx);
    const matchJs = [...matchOut.renderFunctions, ...matchOut.dispatchers].join("\n");
    // Item-scoped dispatch fn signature.
    expect(matchJs).toMatch(/function __scrml_match_match_\d+_dispatch\(_mount, _v\)/);
    // No module-scope trigger that would reference `article` (undefined at top level).
    expect(matchJs).not.toMatch(/_scrml_effect\(\s*function\(\)\s*\{[\s\S]*article\.status/);
    expect(matchJs).not.toMatch(/_dispatch\(article\.status\)/);
    // Per-mount dispose isolation (sibling items must not share dispose state).
    expect(matchJs).toContain("__scrml_match_dispose_match_");
  });
});
