# Bug 5 SCOPING — progress

## 2026-05-19 (S107) — SCOPING.md authored

- Verified Bug 5 reproduces at HEAD `0534c18` (S106 close) via minimal reproducer at `/tmp/bug-5-repro/app.scrml`.
- New finding beyond side-session report: phantom `_scrml_logic_1` placeholder rendered OUTSIDE the host element from implicit logic-wrap of the bare `const` decl. Logged as Anomaly C.
- Spec verification (pa.md Rule 4) — read §1.4, §7.4, §7.4.1, §3 context grid, §7.6 file-level-scope rule in full from `compiler/SPEC.md` directly (not PRIMER summary). Spec gap identified: no normative statement on `${expr}` in markup-body position for non-reactive cases. Surfaced as Q-BUG5-OPEN-1.
- Root cause: emit-event-wiring.ts:928 conditional has no else-branch for "non-empty body, no reactive refs, no server fn." Two structurally-related sites in emit-html.ts:1650-1690 (phantom placeholder) + emit-logic.ts file-scope statement walker (orphan no-op).
- Three fix-shape options surfaced: α (compile-time inline), β (one-shot startup binding), γ (hybrid — α where foldable, β otherwise).
- PA recommendation: Option γ. Phase 1 (~2-3h) closes HIGH-severity headline symptom via Option β only; Phase 2 (~2-3h) cleans up Anomalies B + C; Phase 3 (~3-5h) adds constant-folding optimization + SPEC §7.4.2 normative section.

**Next step:** surface SCOPING + 5 OQs to user for ratification.

## 2026-05-19 (S107, mid-session) — OQs ratified + Q-BUG5-OPEN-6 added per user surface

User ratifications via AskUserQuestion:
- **Q-BUG5-OPEN-1: Yes — add new §7.4.2** (PA recommendation accepted)
- **Q-BUG5-OPEN-2: γ hybrid** (PA recommendation accepted; three-phase sequencing)
- **Q-BUG5-OPEN-3: Emitter classifier** (PA recommendation accepted; keep implicit logic-wrap, fix downstream)

User surfaced new question: "does this affect ~ fallthrough?"

PA investigation:
- Read SPEC §32 (`~` keyword) in full from line 14285 directly per Rule 4.
- Confirmed `${~}` interpolation in markup body is BROKEN at HEAD `0534c18` with the same shape as `${VERSION}` — same code path, same fall-through.
- Reproducer: `${ "v0.3.0"; ~ }` compiles to placeholder + hoisted `_scrml_tilde_N` at file-scope + EMPTY wiring block. Identical Bug 5 symptom.
- §32.4 boundary rule preserved — cross-`${}` `~` reference is E-TILDE-001 (unchanged).
- Multi-statement concern dissolved — `~` rewriter at `emit-reactive-wiring.ts:372` already hoists, so by the time wiring path runs the body is single-reference.

Disposition: `~` fallthrough rides Bug 5's fix automatically. No new code path. Test coverage SHALL include `~` regression cases. Logged as Q-BUG5-OPEN-6 in SCOPING.

**Next step:** Phase 1 dispatch decision (PA-direct now vs queue for next session vs delegate).
