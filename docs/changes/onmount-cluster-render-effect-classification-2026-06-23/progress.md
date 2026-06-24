# Progress — onmount-cluster-render-effect-classification-2026-06-23

Two on-mount codegen bugs sharing the on-mount-handling locus.

## 2026-06-23 — Startup
- Worktree verified under .claude/worktrees/agent-aa0c93ee1e95a2f15; base merged from main (f5f15009); bun install + pretest OK.
- Read primary.map.md Task-Shape Routing (codegen shape). Load-bearing: S214 ss15 item-2 fix (DEFAULT_LOGIC_MODE_TAGS + markupParentStack in emit-html.ts) covers the small-file path; g-on-mount-bare-call-render-slot.test.js is the sibling test.
- Routing → emit-html.ts logic-node classification branch (~2317) + the SSR-template emit path (TBD where the small/large path diverges).

## Next
- Phase 0 Bug 1 (g-onmount-async): bisect small→large to hit the SSR-template path that flips on-mount to a display slot.
- Phase 0 Bug 2 (GITI-029): reproduce the `//`-comment-before-on-mount literal-text bug.

## 2026-06-23 — Bug 2 (GITI-029) DONE
- Phase 0: reproduced. `//` comment before `on mount {}` → BS flushes preceding text via the `comment` child → on-mount line becomes a STANDALONE text block → matches no default-logic lift gate → ships RAW into DOM as literal text.
- Root cause: ast-builder.js liftBareDeclarations — no lift gate for a text block whose leading token is `on mount {` / `on dismount {`. Control (blank line) worked because the on-mount shared the `<a> = 0\n...` text block lifted by TOPLEVEL_STATE_DECL_RE.
- Fix: NEW TOPLEVEL_ON_LIFECYCLE_RE (ast-builder.js ~577) + lift gate (~1606) gated on isDefaultLogicBody. Mirrors the @-write / tilde lifts.
- Verified: literal `on mount {` GONE from HTML; client.js runs `_scrml_reactive_set("a", _scrml_f_2())` at mount; `${@a}` slot intact. 5 new unit tests pass; on-mount.test.js + g-on-mount + control-flow-in-markup-reject all green.

## Next
- Bug 1 (g-onmount-async): bisect to the SSR-template emit path.

## 2026-06-23 — Bug 1 (g-onmount-async) DONE
- Phase 0: reproduced TWO ways.
  - Default-logic path: `on mount {}` as a statement in a `${...}` block that ALSO contains a lift-expr → bodyHasLift true → S214 early-return skipped → placeholder allocated for the lift → the per-child binding loop registered the on-mount bare-expr as a render binding → emit-event-wiring emitted `_scrml_render_value(el, boot())` (+ a re-running `_scrml_effect` when the body reads a reactive cell). Repro: _b1-blockwithlift{,-reactive}.scrml.
  - State-context path (the flogence adopter root): `<program db=>` body parses to `program > state(db) > logic(body) > bare-expr(on-mount)`. The enclosing markup tag is "state" (emit-html:776 push) so inDefaultLogicMode is FALSE → neither the early-return nor the default-logic binding-skip fires → wrong slot. flogence/src/app.scrml emitted `_scrml_render_value(el, _scrml_boot_188())` + the effect re-run — the EXACT smoking gun.
- Root cause: emit-html.ts treats on-mount classification POSITIONALLY (enclosing tag). SPEC §6.7.1a/b is UNCONDITIONAL: `on mount {}` / `on dismount {}` is always a fire-and-forget effect that NEVER renders, in any context.
- Fix: mark the 4 desugar sites (ast-builder.js on-mount/on-dismount, parseOneStatement + top-level loop) with `_onMountEffect: true`. emit-html binding loop skips any `_onMountEffect` bare-expr (context-independent) + keeps the default-logic skip. STRIP_KEYS += _onMountEffect/_onLifecycleLift (LIVE-only, native-parity).
- Verified: synthetic repros wrong-slot 0 / effect present / lift wiring intact; flogence wrong-slot 0 + boot_188(); 36 on-mount tests pass; within-node M6.5.b.0 re-baselined for rust-dev-debate-dashboard (FIELD-SHAPE 46->47, MISSING-FIELD 206->212 — the comment-before-on-mount at L158-160 now lifts via GITI-029; live does this, native lags).
- Shared root? Both bugs are on-mount handling but DISTINCT loci: GITI-029 is a PARSER recognition/lift gap (ast-builder liftBareDeclarations); g-onmount-async is a CODEGEN classification gap (emit-html effect-vs-slot). The _onMountEffect marker is added by the same desugar sites and serves the codegen fix.

## 2026-06-23 — Bug 1: spec-divergent locked test corrected
- request-tag-and-server-fn-reactive.test.js §6 "GITI-001 wrap is context-aware" was LOCKING the bug shape. Its fixture is `on mount { @data = loadValue() }` in a `<program db=>` body; the test author even noted (comment) "the on mount block SOMEHOW generates a reactive-display wiring" — that "somehow" WAS the bug. The line-262 assertion expected `el.textContent = await ((async () => _scrml_reactive_set(...)))` — a bug-only emit shape unreachable through any legitimate path (genuine markup-interp assignment routes to _scrml_init_set; genuine server-fn interp routes to the try/catch one-shot).
- Corrected per SPEC §6.7.1a (Rule 4 — locked test was locking spec-divergent behavior): assert the on-mount is now a file-scope mount effect `(async () => _scrml_reactive_set("data", await ...))();` (statement-context, well-formed, GITI-001 `;)`-invariant preserved), NO render slot / no el.textContent of the on-mount, and the genuine `${@data}` display binding still renders. 12/12 pass.
