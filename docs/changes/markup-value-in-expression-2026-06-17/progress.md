# markup-value-in-expression-2026-06-17 — progress

Bug: g-markup-value-ternary-fnreturn-codegen (HIGH). Markup-as-first-class-value
(Pillar 1, SPEC §1.4/§7.4, PRIMER §6.4/§6.6.17) fails to codegen in 3 forms.

## 2026-06-17 — Phase 0 findings (verified empirically)

Repro dir: /tmp/mv-repro/{a-inline,b-derived,c-fnreturn,d-control}.scrml
All 3 forms reproduce E-CODEGEN-INVALID-JS; control (d) compiles + renders.

LAYER DIAGNOSIS (different per form):

(b) DERIVED TERNARY `const <badge> = @n > 0 ? <span>pos</span> : <span>neg</span>`
  - ROOT: block-splitter (block-splitter.js). At top level it gobbles the decl
    via scanShape12DeclEnd(); the expression-RHS branch (line ~1474) returns -1
    (markup not at RHS-head), so legacy per-char accumulation runs and STOPS at
    the first `<span` markup-opener -> the ternary arms are split into SEPARATE
    top-level markup blocks. ast-builder sees only text `const <badge> = @n > 0 ?`
    -> initExpr = escape-hatch raw `@n > 0 ?` (arms DROPPED).
  - FIX LAYER: block-splitter scanShape12DeclEnd expression-RHS branch must scan
    the FULL RHS (balancing markup elements within ternary arms) so the whole
    decl stays one text block, then emit-logic's derived-ternary path lowers the
    markup arms to node-producing exprs.

(c) FN-RETURN `fn label(n:int)->markup { return <span>${n}</span> }`
  - ROOT: ast-builder `return` parser (line ~6966) has hooks for SQL/match but
    NOT markup. `return <span>...` falls to collectExpr -> markup parsed as a
    JS expr -> acorn escape-hatch raw `< span >` (mangled) + orphaned `${n}`.
  - FIX LAYER: add a markup hook to the `return` parser mirroring `lift`'s inline
    markup parse (line ~6749): `<`+IDENT/KEYWORD -> parseLiftTag -> store
    markupNode on return-stmt; emit-logic return-stmt renders via
    emitCreateElementFromMarkup.

(a) INLINE TERNARY `<div>${ @n>0 ? <span>pos</span> : <span>neg</span> }</div>`
  - ROOT: markup stays inside the interpolation (block-splitter keeps the whole
    `<div>${...}</div>` as one markup block). Emit path: reactive-display wiring
    emits `el.textContent = _scrml_reactive_get("n") > 0 ? < span > pos < / span >`
    -- markup arms emitted RAW (rewriteExpr string-path preserves raw text but
    never lowers markup to nodes). Same expression-with-markup family as (b).
  - FIX LAYER: emit layer (interpolation lowering) — markup in expression
    position must lower to a node-producing expression (markup factory / inline
    createElement), routed through emitCreateElementFromMarkup.

CONTROL (d) `const <x> = <span>${@n}</span>`: bare-markup RHS -> renderSpec.element
  -> _scrml_markup_factory_x_2() via emitCreateElementFromMarkup. WORKS. The
  factory pattern is the lowering target for all three broken forms.

## Next
- [ ] Fix (c) fn-return markup hook (parse + emit) — smallest, self-contained.
- [ ] Fix (b) block-splitter RHS scan so markup-in-expr stays one block; emit lowering.
- [ ] Fix (a) interpolation emit lowering for markup in ternary arms.
- [ ] R26 verify all 3 + control; full suite; regression test.

## 2026-06-17 — RE-DISPATCH: forms (a)+(b) finished

Base main 268a27c5 (has form (c) primitive emitMarkupValueExpr + the salvage diff).

- Applied SALVAGE-form-ab-uncommitted.diff CLEANLY (git apply --check passed, no
  --3way needed): block-splitter.js scanShape12DeclEnd full-RHS markup scan +
  ast-builder.js sawTernaryAtRoot guard + parseExprWithMarkupValues +
  safeParseExprToNode markup-first dispatch.
- FIX 1 (declaration): added `let _inMarkupValueParse = false;` at the TOP of
  parseLogicBody (line ~2859, right after `let i = 0;`) — the re-entry guard the
  salvaged code referenced but never declared. Chose declare-not-strip: the guard
  IS needed (parseExprWithMarkupValues re-enters safeParseExprToNode on the
  placeholder skeleton; without the guard the skeleton's `__scrml_mv_N__` idents
  are markup-free so no infinite loop, but the guard is the documented contract
  and matches the `_tildeActive` closure-flag pattern already in the function).
- FIX 2 (emit integration): added MarkupValueExpr interface to types/ast.ts
  ExprNode union + `case "markup-value"` to emit-expr.ts emitExpr dispatch →
  `emitMarkupValueExpr(node.node)` (form-(c) primitive). This was the never-written
  EMIT layer.

R26 (all four, exit 0 / node --check PASS / real createElement / no raw `< span >`):
  (a) `<div>${ @n>0 ? <span>pos</span> : <span>neg</span> }</div>` — both arms emit
      IIFE-wrapped createElement markup-value in the ternary. PASS.
  (b) `const <badge> = @n>0 ? <span>pos</span> : <span>neg</span>` — derived factory
      `() => ternary-of-markup-value-IIFEs`; display wiring identical to control (d). PASS.
  (c) fn-return markup — regression, STILL passes (unchanged). PASS.
  (d) control bare-markup derived — STILL passes. PASS.

Regression test g-markup-value-in-expression.test.js: un-skipped (a)/(b), added
createTextNode pos+neg assertions (proves no dropped alternate arm). 4 pass / 0 fail.

NOTE (out of scope, pre-existing): forms (a)/(c)/(d) all emit `el.textContent =
<DOM node>` in the shared reactive-display wiring + a free-standing dead top-level
statement. Both artifacts are present in the ALREADY-LANDED form (c) and the
brief-designated control (d) — NOT introduced here. textContent-of-a-node coercion
is a display-wiring concern affecting all markup-valued interpolations equally;
form (b)'s derived-cell path is the clean shape. Surfaced for PA, not fixed here.

## 2026-06-17 — REGRESSION caught + fixed (full-suite gate)

The salvaged block-splitter markup-gobble was TOO BROAD: it diverted from the
legacy path on ANY markup in the expression RHS — including a SIBLING markup
element after a complete primary value. The stress-ghost-pattern-coverage harness
(35/0 at base) regressed to 31/4 with the raw salvage:
  - `<x> = 1<div>${@x === 1 ? …}</div>`  (=== strict-equality fixture)
  - `<x> = null<div>${@x}</div>`          (null-literal fixture)
  - `<x> = true<div class:active=@x>x</div>`  (class: directive regression-guard)
  - `<name> = ""<input bind:value=@name />` (bind:value regression-guard)
All four are SINGLE-LINE `<program>…</program>` files where the RHS value (1 /
null / true / "") completes and the following `<div>`/`<input>` is a SEPARATE
top-level element. Gobbling swallowed `</program>` into the decl text → E-CTX-003.

FIX (commit 7cadacab): at a top-level (bd===0 ad===0) markup opener, inspect the
nearest preceding non-ws char. Value-terminator (alphanumeric / _ / ) ] } /
quote) ⇒ RHS value already complete ⇒ sibling element ⇒ return -1 (legacy path).
Only gobble when the markup is in operand position (RHS head or after an operator
like ? : ( , = & |) — a genuine ternary arm. Verified:
  - stress-ghost-pattern-coverage: 35/0 restored.
  - markup-value (a)/(b)/(c)/(d): 4/0; R26 re-confirmed both ternary forms lower
    (createElement span + textNode pos/neg, node --check PASS, exit 0).
  - TodoMVC benchmark client.js: BYTE-IDENTICAL base-vs-mine (zero effect on
    existing non-markup-value code).

Pre-commit gate (unit+integration+conformance): 17137 pass / 0 fail / 90 skip.
Full `bun run test`: 24395 pass / 2 fail — both fails are the TodoMVC
dist-presence browser assertions (environmental: benchmarks/todomvc/dist not
built by pretest; pass 39/0 once compiled). within-node canary: NO OVER-BUDGET
line (corpus aggregate printed, no re-baseline needed).

Salvage applied CLEANLY (git apply --check passed; no --3way / no hand-reapply).

## 2026-06-17 — RENDER layer dispatch (markup-value display wiring)

pwd: /home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-a78fccd56adff7793

STEP 0 FF-merge of codegen commit 2b4ea4d8: SUCCEEDED (268a27c5..2b4ea4d8
fast-forward). greps confirm codegen present: emit-expr.ts `case "markup-value"`=1,
emit-lift.js emitMarkupValueExpr=1.

Phase 0 — emit-site location (CONFIRMED):
  The `${...}` interpolation display wiring lives in
  compiler/src/codegen/emit-event-wiring.ts. The bug `el.textContent = <node>`
  appears at THREE sites in the default-text logic-binding loop:
    - reactive path (varRefs>0, non-async): lines 1228-1229
        `el.textContent = <expr>;` + `_scrml_effect(fn(){ el.textContent = <expr>; })`
        ← all 4 brief forms (a/b/c/d) hit here (each has @n/@badge/@x ref).
    - static one-shot path (no varRefs, default-kind): line 1275
        `el.textContent = <expr>;` ← no-ref interpolations.
  (errorBoundary 1168, server-fn async 1197/1225-1226 are out of scope —
   error envelopes + Promise coercion, not markup nodes.)

LAYER 1 (runtime helper) — DONE:
  Added `_scrml_render_value(el, v)` to runtime-template.js right after
  `_scrml_reactive_get` (in the always-included `core` chunk; first boundary
  marker is `wire` at template line ~985, well after the insertion point).
  Shape: `if (v instanceof Node) el.replaceChildren(v); else el.textContent =
  (v == null ? "" : String(v));`. String path stays textContent (byte-identical
  intent). NOTE: the runtime body is a backtick template literal (opens at
  runtime-template.js:425) — the helper comment must NOT contain backticks or
  ${} (the S167 collision class); authored comment plain-text accordingly.
  Verified: template node --check PASS; emitted runtime (fresh hash 01gbisgl)
  contains _scrml_render_value exactly once.

LAYER 2 (emit sites) — DONE:
  compiler/src/codegen/emit-event-wiring.ts — the `${...}` interpolation display
  wiring. Changed the bare `el.textContent = <expr>` writes to node-aware
  `_scrml_render_value(el, <expr>)` at the TWO in-scope sites:
    - reactive non-async path (was lines 1228-1229): the one-shot + the
      `_scrml_effect` re-bind both route through the helper.
    - static one-shot default-text path (was line 1275).
  Left UNCHANGED (out of scope — values are awaited Promises/strings, never a
  live DOM node on the client): the server-fn async paths (1197/1225-1226) and
  the errorBoundary text render (1168, error-envelope dispatch).
  String path: a primitive value flows through the helper's `else` branch →
  `el.textContent = (v == null ? "" : String(v))`, observable-identical to the
  old `el.textContent = v` for every defined scrml value (null/undefined do not
  exist in scrml; "" stays "").

CHUNK-DETECTION FIX (pre-existing tree-shake gap — REQUIRED for form (d) render):
  Root-caused via a temporary probe on detectFromNode's state-decl case. The
  markup-typed derived `const <x> = <markup>` (§6.6.17 markup-as-value derived)
  carries `shape: "decl-with-spec"` + `_cellKind: "markup-typed"`, NOT
  `shape: "derived"`. emit-logic.ts emits `_scrml_derived_declare("x", factory)`
  for it, but emit-client.ts detectRuntimeChunks gated the `derived` chunk ONLY
  on `shape === "derived"` → the chunk was tree-shaken → form (d) threw
  `_scrml_derived_declare is not defined` at mount (the SAME class as Bug 57).
  This is PRE-EXISTING (independent of the display wiring; reproduces with only
  the committed runtime helper present, and with/without a <program> root).
  Fix: added `if (node._cellKind === "markup-typed") chunks.add("derived")` to
  the state-decl chunk gate. Confirmed: form (d) runtime now defines
  _scrml_derived_declare; all 6 render tests pass.

RENDER R26 (happy-dom, all 6 in compiler/tests/browser/markup-value-render.browser.test.js):
  (a) inline ternary  — renders <span>neg</span> (@n=0) then <span>pos</span>
      (@n=1); textContent NOT "[object...]". PASS.
  (b) derived ternary — `${@badge}` renders the chosen <span>; reactive flip. PASS.
  (c) fn-return markup — `${label(@n)}` renders <span>7</span> then <span>42</span>. PASS.
  (d) plain markup-typed derived (control) — `${@x}` renders <span>3</span>. PASS.
  string regression `${@count}` — renders "5"→"99", NO node child, NOT "[object". PASS.
  string regression literal — renders "hello world" verbatim. PASS.
  6 pass / 0 fail / 40 expect() calls.

## 2026-06-17 — FULL-SUITE + CANARY + TodoMVC VERIFICATION (RENDER dispatch DONE)

COUPLED TEST UPDATES (8 assertions / 7 files) — the interpolation-display emit
changed `el.textContent = expr` → `_scrml_render_value(el, expr)`. These tests
asserted the old literal shape; updated to the new helper-call shape (each test's
load-bearing property preserved: reactive _scrml_effect subscription, sync-not-
async, member-access read shape, no coalesce wrap):
  - bug-5-const-interpolation.test.js (reactive effect wiring)
  - server-fn-markup-interpolation.test.js (§3 sync-not-async)
  - gauntlet-s22/derived-machines.test.js (§51.9 projected-var display)
  - giti-019-lift-loop-coalesce-parens.test.js (direct interp no-coalesce)
  - engine-var-markup-binding.test.js (§2.1 + §2.2 engine-var display)
  - derived-reactive-markup-wiring.test.js (Bug 4 derived effect wrap)
  - conf-compound-rollup-read-bug-61.test.js (member-access read shape)

PRE-COMMIT GATE (unit+integration+conformance):
  BEFORE my emit change: 17137 pass / 0 fail / 90 skip (baseline)
  AFTER emit (pre test-update): 8 fail (the literal-shape assertions above)
  AFTER test-update: 17137 pass / 0 fail / 90 skip — baseline restored.

FULL `bun run test`: 24402 pass / 0 fail / 225 skip / 1 todo (1015 files).
  (prior base was 24395 pass / 2 fail — the 2 fails were TodoMVC dist-presence,
   environmental; gone now that the dist is built. +6 render tests + +1 string
   regression net the pass-count delta.)
  ("error: boom" in the tail is an INTENTIONAL subscriber-throw test fixture in
   value-indexed-subscribers.test.js — final tally 0 fail.)

WITHIN-NODE CANARY (M6.5.b.0 parity gate): 1012 pass / 0 fail; allowlist JSON
  UNMODIFIED; PARSE-FAILURE: 0. The within-node gate measures NATIVE-vs-LIVE
  PARSER AST divergence, NOT runtime-emit byte-count — my change is runtime-
  template + codegen-emit + chunk-detection only (parser untouched), so NO
  OVER-BUDGET fired and NO re-baseline was needed. (The brief's "string
  interpolations over-budget" hypothesis does not apply: the canary is parser-
  shape, not emit-size.)

TodoMVC: dist rebuilt with the new runtime (app.client.js uses
  _scrml_render_value 5×; node --check PASS for client + runtime). Browser gate:
  49 pass / 0 fail / 8 skip.

STRING-PATH BYTE-IDENTICAL — CLARIFICATION:
  The GENERATED JS LINE changed (`el.textContent = X` → `_scrml_render_value(el, X)`)
  — so it is NOT byte-identical at the source-line level (the change is by design;
  node-aware dispatch can't live anywhere else). The RENDERING BEHAVIOR for every
  DEFINED scrml value is observable-identical: the helper's else-branch does
  `el.textContent = (v == null ? "" : String(v))`, and `el.textContent = x` vs
  `el.textContent = String(x)` produce identical DOM for strings/numbers/bools.
  null/undefined don't exist in scrml (both → absence → ""), so no real string
  interpolation can hit the only divergent input. Two happy-dom string-regression
  tests assert the text renders unchanged ("5"→"99"; "hello world" verbatim).

EMIT SITES CHANGED (exact):
  compiler/src/codegen/emit-event-wiring.ts
    - reactive non-async default-text path (was 1228-1229) → 2 _scrml_render_value lines
    - static one-shot default-text path (was 1275)         → 1 _scrml_render_value line
  UNCHANGED: server-fn async (1197/1225-1226 — awaited Promise/string),
             errorBoundary text render (1168 — error-envelope dispatch).

DEFERRED FORKS: none triggered (no keyed reconciliation, no multiple-node/mixed
  text+node interpolation, no SSR-of-node). The markup-typed-derived `derived`-
  chunk tree-shake gap was IN-SCOPE-adjacent (required for the brief-mandated form
  (d) render; Bug 57 class) — fixed, not deferred.

GAP g-markup-value-ternary-fnreturn-codegen: RESOLVED (codegen was the prior
  layer; render now works for all 4 forms in happy-dom).
