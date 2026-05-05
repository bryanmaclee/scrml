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
