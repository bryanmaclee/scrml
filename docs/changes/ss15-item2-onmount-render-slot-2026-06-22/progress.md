# ss15 item-2 — fix g-on-mount-bare-call-render-slot

pwd: /home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-ae67432fc5a22d439
branch: worktree-agent-ae67432fc5a22d439

## 2026-06-22 Phase 0 — SCOPE-FIRST (done)

Root cause confirmed: `emit-html.ts` logic-node branch (~2181) cannot tell its
enclosing context. `emitNode` threads NO parent/mode flag. `on mount { body }`
desugars (ast-builder.js:8573 + 11968) to a plain `bare-expr` with NO lifecycle
marker — structurally identical to a markup-interpolation bare-expr.

### Discriminator chosen: ENCLOSING MARKUP PARENT TAG (positional)
SPEC.md:10347 (normative): "the §40.8 default-logic auto-lift fires only at
`<program>`/`<page>`/`<channel>` direct-child roots, never inside nested markup".
SPEC §17.3 + §6.7.1a: a bare-expr in a logic context is an EFFECT at mount; it
does NOT render its return.

Rule:
  - logic node whose enclosing markup parent ∈ {program,page,channel} OR at
    file top-level (no markup parent) => DEFAULT-LOGIC mode => bare-expr is an
    effect; emit NO `data-scrml-logic` span, NO addLogicBinding (the file-scope
    / mount effect emission already happens downstream).
  - logic node nested inside any OTHER markup element (<div>, <span>, component
    root, etc.) => MARKUP-INTERPOLATION => UNCHANGED (renders).

AST evidence (probes): `on mount { val() }` at program body => synthetic `logic`
node child of `<program markup>`, body=[state-decl, fn-decl, bare-expr]. Markup
interp `<div>${val()}</div>` => `logic` node child of `<div markup>`,
body=[bare-expr]. Both bare-exprs byte-identical; only the parent tag differs.

Implementation: closure-level `markupParentStack` in generateHtml; pushed at the
generic markup-element children walk; the logic-node branch keys on
top-of-stack ∈ DEFAULT_LOGIC_MODE_TAGS (or empty stack = file top-level).

### Blast radius (to measure during full-suite run)
Expect client.js/html snapshot shifts on corpus samples with program-body /
lifecycle bare-exprs (each loses one spurious `<span data-scrml-logic>` +
`_scrml_render_value`). Markup-interp samples UNCHANGED (regression guard).

## 2026-06-22 Implementation + verification

- emit-html.ts: DEFAULT_LOGIC_MODE_TAGS {program,page,channel} + closure-level
  markupParentStack; pushed at generic markup walk + <program>/<page> transparent
  walks + errorBoundary/compound/state-block walks. Default-logic-mode guard at
  the logic-node branch: skip render slot + addLogicBinding for default-logic
  bare-expr. OVER-FIX GUARD: lift-expr (stmtContainsLiftExpr) is NOT suppressed
  (Tier-0 `${ for/lift }` renders in any context, §17.4).
- nestedMarkupContext param on generateHtml: seeds the stack for engine/match arm
  bodies (emit-variant-guard.ts passes true) so arm-body interpolations render.
- R26 matrix verified (HTML + client.js): 4 default-logic = 0 slots / effect call,
  no _scrml_render_value; 3 markup-interp = 1 slot + _scrml_render_value; program-
  body lift KEEPS slot + lift wiring.
- Tests: g-on-mount-bare-call-render-slot.test.js (11 tests, all pass).
- Re-baselined emit-html-meta.test.js §10 (2 tests): the synthetic top-level logic
  node was asserting the OLD spurious slot; wrapped in <div> to preserve the
  logic-vs-meta ROUTING intent under corrected default-logic semantics.
- Engine/match arm-body regression caught + fixed (nestedMarkupContext); lift-5
  regression caught + fixed (lift-expr guard).
