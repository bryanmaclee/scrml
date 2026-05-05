# Progress: D4 — Cleanup + PIPELINE.md + SPEC-INDEX final regen

**Branch:** `changes/v0next-spec-impact-d4`
**Started from HEAD:** `acdd9b9` (S58 mid hand-off + primer)
**Worktree:** `/home/bryan-maclee/scrmlMaster/scrmlTS/.claude/worktrees/agent-a3219027b50e48f08`
**Brief:** `docs/changes/v0next-spec-impact/DISPATCH-4-BRIEF-cleanup-pipeline-index.md`
**Scope:** Tiers 8-12 of IMPACT-ASSESSMENT.md §6 — small SPEC.md edits + 4 reviews + §34 consolidation + PIPELINE.md ~30-40% rewrite + SPEC-INDEX final regen.

## Plan / order

Tier 8 small SPEC edits:
1. §4 Block Grammar (M15 :-shorthand, register `<errors>`/`<onTransition>`/`<engine>`/`<match>` structural elements; M7 negative-space verify)
2. §5 Attribute Quoting (L17 bind-dispatch table; L19 event-handler bare-form rule)
3. §7 Logic Contexts (L1 reframe, V5-strict + hoisting + pinned, M8 logic-markup interleaving)
4. §10 lift (L1 reframe — small)
5. §13 Async Model (§13.5 RemoteData → engine cross-ref)
6. §14 Type System (M9 bare-variant inference; M10 positional binding for predefined-shape)
7. §15 Component System (M20 components-vs-engines, E-COMPONENT-ENGINE-SCOPE, V5-strict reactive scope)
8. §16 Component Slots (L1 reaffirm)
9. §21 Module/Import (M18 cross-file engine import; pinned imports)
10. §24 HTML Spec Awareness (register scrml structural elements)
11. §31 Dependency Graph (L14 validator predicate-arg tracking; L15+L20 derived-state)
12. §41 Import System (L12 `scrml:data` registerMessages)
13. §50 Assignment as Expression (L1 + L19 cross-refs)

Tier 10 reviews:
14. §22 Metaprogramming
15. §28 Compiler Settings
16. §47 Output Name Encoding
17. §52 State Authority

Tier 9 §34 consolidation:
18. §34 audit + tables update

Tier 11 PIPELINE.md (~30-40%):
19. Tokenizer / TAB stage updates
20. Parser stage updates (within TAB)
21. NR / Resolver stage updates (3.05)
22. TS stage updates
23. CG stage updates

Tier 12 SPEC-INDEX final regen:
24. Run script + manual line-number verification
25. Quick Lookup additions

## Timeline (append-only)

- [START] Worktree verified, brief read in full, primer + IMPACT-ASSESSMENT + kickstarter §7 + anti-patterns + current PIPELINE.md surveyed. Branch `changes/v0next-spec-impact-d4` created off `acdd9b9`. Beginning Tier 8 work.
- [Tier 8] §4.14-§4.16 (`:`-shorthand body, structural elements registry, M7 negative-space). Commit 4303b71.
- [Tier 8] §5.2.3 + §5.4.1 (bare-form event handler L19; bind-dispatch L17). Commit 5d33c1c.
- [Tier 8] §7.4.1 + §7.6.1 + §7.7 (markup-as-value pillar reframe; V5-strict file scope + pinned; logic-markup interleaving M8). Commit dcd26a0.
- [Tier 8] §10.1.1 (lift under L1 reframe). Commit f21e448.
- [Tier 8] §13.5 (RemoteData → engine cross-ref). Commit d413d9e.
- [Tier 8] §14.10 + §14.11 (bare-variant inference M9; positional binding M10). Commit 6432683.
- [Tier 8] §15.13.5 + §15.13.6 (components-vs-engines M20; V5-strict reaffirmation). Commit c705108.
- [Tier 8] §16 (markup-as-value reaffirmation for slots). Commit d2b12d7.
- [Tier 8] §21.8 (cross-file engine import M18; pinned imports). Commit d4da3a0.
- [Tier 8] §24.4 (register scrml structural elements). Commit bc3681d.
- [Tier 8] §31.4 + §31.5 (validator predicate-arg dep tracking L14; derived-state dep tracking L15+L20). Commit 4b7df25.
- [Tier 8] §41.12 (scrml:data registerMessages L12). Commit 92e5ea2.
- [Tier 8] §50.14 + §50.15 (assignment-as-expr composition with L1 + L19). Commit 788a122.

Tier 8 COMPLETE. Beginning Tier 10 reviews (§22, §28, §47, §52).
- [Tier 10] §22 / §28 / §47 / §52 v0.next-consistency notes; §28 +4 lint-suppression configs (`lint.lifecycle-candidate`, `lint.match-rule-inert`, `lint.engine-initial-missing`, `lint.deprecated-machine`). Commit fc5349b.

Tier 10 COMPLETE.

- [Tier 9] §34 +7 codes — E-CLOSER-001, E-NAME-COLLIDES-RESERVED, E-STRUCTURAL-ELEMENT-MISPLACED, E-MULTI-STATEMENT-HANDLER, E-IMPORT-PINNED-INVALID, E-DERIVED-CIRCULAR-DEP, E-USE-INVALID-CTX. (Codes already documented in §34: E-VARIANT-AMBIGUOUS, E-COMPONENT-ENGINE-SCOPE, E-VALIDATOR-CIRCULAR-DEP, E-DERIVED-ENGINE-CIRCULAR — D2.8 contributions.) Commit 7b5d618.

Tier 9 COMPLETE.

- [Tier 11] PIPELINE.md v0.7.0 — version bump + change log entry summarising the v0.next surface. Commit 65cd3b8.
- [Tier 11] PIPELINE.md Stage 3 TAB v0.next addendum — new tokens (`pinned`, `is some`, `is not`, `default=`), structural-element recognition, V5-strict declaration AST shape, render-spec validation, bare-variant inference parsing, positional binding, multi-statement-handler restriction, render-by-tag handoff to NR. Commit 65cd3b8.
- [Tier 11] PIPELINE.md Stage 3.05 NR + Stage 3.1 MOD addenda — auto-declared engine variable resolution (lowercase first letter, strip "Machine"); category routing for new structural elements; pinned forward-ref detection; exportRegistry category extension (engine, user-state-type); pinned import validation. Commit e2f605f.
- [Tier 11] PIPELINE.md Stage 3.3 UVB + Stage 6 TS addenda — VP-1 attribute-allowlist additions for the four structural elements; VP-2 invariants extended; ResolvedType extensions for engine / engine-state-child / match-block / validity-surface; auto-synthesised validity surface type-checking; ValidationError enum + .Custom(tag); render-spec validity classification; engine derived=expr type compatibility; bare-variant inference type completion; positional binding; validators on derived cells rejected. Commit 949b6ff.
- [Tier 11] PIPELINE.md Stage 7 DG + Stage 8 CG addenda — DGNode kinds + DGEdge kinds for v0.next; validator predicate-arg dependency edges; derived-state expression dependency edges; cycle detection; engine state-child rule edges; <onTransition>/effect= edges; <x/> render-by-tag expansion; engine state-child rendering; auto-synthesised validity property emission; <errors of=expr/> rendering with messageFor; reset(@cell) keyword expansion; default= capture; auto-name encoding for synthesised props + auto-declared engine vars. Commit d4c272f.
- [Tier 11] PIPELINE.md Integration Failure Mode Catalog +11 v0.next failure modes (validator-circular-dep, derived-cell-circular-dep, derived-engine-circular-dep, engine-state-child-outside-engine, onTransition-outside-engine, synthesised-property-write, engine-variable-shadow, bare-variant-ambiguity, render-spec-non-bindable, multi-statement-bare-form-handler, engine-in-component-body). Commit 08fd302.

PIPELINE.md final size: 2380 lines (was 1941; +439 lines / +22.6%). Slightly under the 30-40% target; per the brief, addendum-style additions to affected stages preserve unchanged stages verbatim — that is the cleanest path. All seven affected stages received v0.next addenda (TAB, NR, MOD, UVB, TS, DG, CG); RI / META / BP / PA stages unchanged.

Tier 11 COMPLETE.

- [Tier 12] SPEC-INDEX final regen — D4 line numbers across all sections, Quick Lookup additions for the 22 new D4 subsections, plus consolidated D4 list at bottom (commit 40ff087). SPEC.md ended at 24,382 lines; SPEC-INDEX 237 → 498 lines (~2.1x growth from richer Quick Lookup coverage).

Tier 12 COMPLETE.

Final cross-reference sweep findings (per brief §4.1):
- `<machine>` references: 17 occurrences, ALL documenting deprecation (W-DEPRECATED-001), preserving §51.1+ legacy framing, or noting backwards-compat. None are live v0.next examples. PASS.
- `@shared` references: 10 occurrences, ALL in deprecation documentation (E-CHANNEL-002 retired, E-CHANNEL-SHARED-MODIFIER, §38 migration table). None are live examples. PASS.
- `const @x` reactive declarations in examples: 99 occurrences vs 27 `const <x>`. **FINDING for PA:** §6 Shape 3 (Dispatch 1 territory, NOT in D4 scope per brief §5) still uses `const @doubled = ...` form rather than the L15-aligned `const <doubled> = ...` structural form. Per brief §5, D4 MUST NOT modify §6 — this is a D1-territory cleanup deferred to a future dispatch. NOT a D4 regression; pre-D4 state is preserved.
- Cross-references (`§N.X`): D4 added cross-refs all resolve to existing or D4-added sections.
- Error codes referenced in body text exist in §34: PASS for D4-added codes.

Test posture verification (per brief §4.2):
- `bun test compiler/tests/unit compiler/tests/integration compiler/tests/conformance`: 7991 pass / 37 skip / 0 fail. UNCHANGED from D4 baseline. Confirms spec-ahead-of-compiler posture: D4 introduced no compiler-source changes, and the existing test suite remains green at the baseline level. v0.next features (validity surface, engine state-children, render-by-tag dispatch, etc.) require Phase A1+ implementation work to land in the compiler.

STATUS: COMPLETE.
