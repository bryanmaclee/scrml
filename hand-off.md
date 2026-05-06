# scrmlTS — Session 62 (OPEN — A1a complete; A1b/B1 IN FLIGHT)

**Date opened:** 2026-05-05
**Previous:** `handOffs/hand-off-61.md` (S61 close — Phase A1a (lex+parse) COMPLETE; 20/20 sub-steps; +184 tests; 76 dirs dereffed; 3 stream-timeout salvages)
**This file:** rotates to `handOffs/hand-off-62.md` at S62 close

**Baseline entering S62 (verified at session-open):**
- scrmlTS HEAD: `4b7e27d` (`compile(a1a-COMPLETE): Phase A1a lex+parse done — 20 sub-steps, +184 tests`)
- scrml-support HEAD: `269d401`
- Both repos: clean working tree, 0 ahead / 0 behind origin
- Inbox: empty (`handOffs/incoming/` has only `dist/` + `read/` subdirs)
- Tests as of S61 close (per hand-off): 8,902 pass / 44 skip / 1 todo / 0 fail / 8,947 total / 439 files

---

## Session-open status (S62 PA caught up)

**What just happened (S61 close):** Massive single-day session. Phase A1a moved from 14/17 (S60 close) to **20/20 DONE** including 3 newly-discovered P-FUPs (Steps 11.0d/e/f). Plus full curation pass (10 batches, 76 dirs dereffed to scrml-support archive). Plus SPEC head broken-path cleanup. Plus salvage from 3 agent stream-timeout failures (Steps 11.0d original, 13 original, 11.0d-finisher).

**Where we are:** Phase A1a (lex+parse) is COMPLETE. The implementation phase is in full flight. Next is Phase A1b (resolve+type) — 22 steps B1-B22 in 5 waves, fully RATIFIED at S60. Then A1c (codegen+runtime) — 24 steps C0-C23, fully RATIFIED at S60. **§6.4 carry-forward Shape 3 V5-strict codegen gap** must be addressed during A1c.

**Suggested next priority (per S61 close §4):**
1. Discuss with user: dispatch B1 directly OR review A1b RATIFIED plan first.
2. Decide §S11D.5 .todo (Variant C compound at top-level) disposition — Step 11.0g (immediate before A1b) OR absorbed into A1b's resolver normalization. PA leans absorbed into A1b territory.

---

## Open questions to surface immediately at S62 open

**(carried forward from S61 §5 — these need explicit user disposition)**

1. **Push posture (resolved):** All commits pushed at S61 close. Both repos clean+pushed. No carry.
2. **Article truthfulness audit dispositions** — 15 articles classified S59; user must cross-reference public state and decide. **Carried forward.**
3. **scrml.dev v0.2.0 announce publishing** — draft at `docs/website/v0.2.0-announce-2026-05-05.md`. User-controlled timing. Could update to "A1a complete" milestone now.
4. **`tier-ladder-promotion` article** — `published: false`; gated on A2 (engines). Carried forward.
5. **§S11D.5 .todo (Variant C compound at top-level)** — see §4 of S61 close above. **User decides Step 11.0g vs A1b absorption.** PA leans A1b absorption.
6. **6 KEEP-RECENT-LANDED dirs** (s6-const-sweep, s48-close-compiler-dot-phantom, stdlib-oauth, program-documentary-attrs, ast-shape-rename, doc-e-rename) — eligible for aggressive deref to scrml-support archive. PA recommended hold until S65; user can ratify earlier.
7. **Maps refresh root cause** — agent Write-denied issue from S61. Investigate before next maps dispatch.

---

## In-flight threads

### B1 — Symbol-table extension (DISPATCHED 2026-05-05 mid-S62)

**Dispatched via `scrml-dev-pipeline` (Opus, worktree-isolated, background).** Brief at `docs/changes/phase-a1b-step-b1-symbol-table-extension/BRIEF.md`.

**Scope:** per-scope state-cell symbol table; registers every `state-decl` (both `structuralForm:true` and `false`); compound (Variant C) parents register parent + recursively register children with qualified-paths. **§S11D.5 .todo absorbed** (B1 is compound-aware via `state-decl.children`). Foundational infrastructure for B2-B22 — fires NO diagnostics.

**Survey-first mandated** — 8 questions in BRIEF §3 covering: existing scope concept extent, NR's state-decl handling, Variant C walking infra, function/engine/component body walking, AST decoration convention, pipeline insertion-point (Stage 3.06 SYM vs NR-extension), test infrastructure, `@`-prefix preservation.

**Estimate:** 5-7h focused per A1b SCOPE-AND-DECOMPOSITION §4.1; depth-of-survey discount has fired 9× in A1a — could be much less.

**Per-step branch:** `phase-a1b-step-b1-symbol-table-extension` parented from `4b7e27d`.

**Open-on-completion checklist:**
- Cherry-pick to main needs explicit user authorization at landing.
- Confirm tests stable post-cherry-pick (target: ~8914-8917 / 44 / 1 / 0 / 8959-8962 / 440).
- Update master-list §0.1 + §0.5 (new B-series row table; or extend existing).
- Update hand-off + CHANGELOG.
- B1 design decisions inform B2 brief (E-NAME-COLLIDES-STATE depends on B1's symbol-table API).

---

## Things S62 PA needs to NOT screw up

(Standing list carried from S61 §6 — keep accessible; these are A1a-acquired knowledge that S62 must respect)

1. **PA-SCRML-PRIMER §12 depth-of-survey discount** — 9× confirmed. Three shape variants. APPLY mitigations on every audit.
2. **AST kind is `state-decl`, NOT `reactive-decl`. AND `reactive-derived-decl` IS RETIRED** (Step 11.5 fold). Discriminator: `kind === "state-decl" && shape === "derived"`. 6+ self-host files still reference old kind; catches up at next bootstrap regen.
3. **Validator args are `string[]` for now** (Step 5 deferral). A1b B9 owns conversion to ExprNode[].
4. **Variant C compound (Step 11.0a)**: state-decl parents have `children: [...]`; assert `shape:"plain"` AND `initExpr:null` AND no `isConst:true`. Both `</>` and `</NAME>` closers accepted at parse time (A1b enforces name-match).
5. **Newline-as-separator (Step 11.0b)**: lives in `collectExpr` ASI-NEWLINE branch L1985-2030. Universal benefit. Steps 11.0e + 11.0f extend the same predicate.
6. **Typed-decl (Step 11.0c)**: state-decl carries `typeAnnotation?: string`. `collectTypeAnnotation()` is canonical type-form collector.
7. **`reset-expr` AST kind (Step 9)**: full tree walker `forEachResetExprInExprNode`.
8. **MemberCall/MemberAssignment/UnaryDelete (Step 10)**: dual-path discrimination — specialized kinds AND `bare-expr.exprNode` structural walk. **B8 walker MUST handle BOTH.**
9. **`@`-prefix discrimination (Step 10)**: `ident.name` preserves `@` prefix verbatim. Pure string-shape inspection.
10. **Step 11.5 hidden-coupling fix at emit-logic.ts (S61)**: derived-cell emit gated on `shape === "derived" && isConst === true && structuralForm === false`. **Pre-existing Shape 3 V5-strict gap (`structuralForm:true`) deferred to A1c §6.4.**
11. **Step 11.5 dep-graph dedup fix (S61)**: `collectAllReactiveDecls` carries `isFoldedDerived` exclusion filter so folded-derived state-decls are walked once.
12. **Step 11.0e fix at ast-builder.js L1970**: `"not"` added to `VALUE_KEYWORDS` Set. Universal pattern.
13. **Step 11.0f fix at ast-builder.js L1985**: BLOCK_REF added to `lastEndsValue` predicate disjunct list. Universal pattern. Coverage exhaustive (no P-FUP-4).
14. **Step 11.0d fix at ast-builder.js + block-splitter.js**: `peekTopLevelStateDeclSignal` peek; top-level `<x> = init` falls through as TEXT then synthetic `${...}` wrap. Top-level Variant C compound deferred (§S11D.5 .todo).
15. **Path-discipline regression risk** — for cross-tree git ops, USE `git -C <abs-path>` form. Bash CWD can drift. **F4 leaks confirmed multiple times in S61** — Step 11.0d-finisher had self-corrected near-misses + 1 PA-recovered leak.
16. **Stream-timeout salvage protocol established** — when an agent stalls with stream watchdog timeout, PA can salvage committed work via cherry-pick + commit any uncommitted work (preserving agent's intent) + re-dispatch finisher OR PA-direct completion for trivial tail-end work.
17. **Test invariant — anti-html-fragment guard** is non-negotiable on every Shape-1/2/3 positive test. Continue applying.
18. **Tests baseline at S62 open: 8,902 / 44 / 1 / 0 / 8,947 / 439** (verification commit yet to run; cf. §"Test baseline confirmation").
19. **A1b SCOPE FULLY RATIFIED.** 22 steps. Don't re-litigate.
20. **A1c SCOPE FULLY RATIFIED.** 24 steps incl. C0 feature-usage analyzer. Plus §6.4 carry-forward Shape 3 codegen gap.
21. **Curation pass DONE.** All 10 batches executed. `docs/changes/` 103 → 30 (23 KEEP-LIVE + 6 KEEP-RECENT-LANDED + 1 ADR). `scrml-support/archive/changes/` is the live archive.

---

## Test baseline confirmation (PENDING)

Test baseline 8,902 / 44 / 1 / 0 / 8,947 not yet re-run at S62 open — pending user authorization for the run (typical S6X pattern). The confirmation should happen before the first dispatch of substantive A1b work, so any regression is caught at session-open rather than after partial work lands.

---

## State as of S62 open (verified)

- **scrmlTS HEAD:** `4b7e27d` (A1a-COMPLETE marker)
- **scrml-support HEAD:** `269d401` (last cross-repo write was Batch J archive)
- **Tests baseline (per S61 close, not yet re-verified S62):** 8,902 pass / 44 skip / 1 todo / 0 fail / 8,947 / 439 files
- **Working tree both repos:** clean
- **Inbox:** empty
- **Worktrees:** S61 worktrees may still exist (Steps 11.5/12/11.0e/11.0f/11.0d/11.0d-finisher/13). Should auto-clean if no changes; PA may need to verify before dispatching new ones.
- **Permissions whitelist:** unchanged from S60.
- **Agent failure precedent (carry):** 3 stream-timeout failures in S61. Pattern is established + recoverable but a possible recurrence vector.

---

## Cross-references

- **S61 close ledger (this rotation):** `handOffs/hand-off-61.md`
- **S60 outcomes ledger:** `handOffs/hand-off-60.md`
- **S59 outcomes ledger:** `handOffs/hand-off-59.md`
- **PA scrml expert primer (READ FIRST):** `docs/PA-SCRML-PRIMER.md`
- **PA directives:** `pa.md`
- **Master-list dashboard (live progress):** `master-list.md` §0
- **A1b RATIFIED plan:** `docs/changes/phase-a1b-resolve-type/SCOPE-AND-DECOMPOSITION.md`
- **A1c RATIFIED plan:** `docs/changes/phase-a1c-codegen/SCOPE-AND-DECOMPOSITION.md`
- **A1a final state:** `docs/changes/phase-a1a-lex-parse/AST-CONTRACTS-AND-DECOMPOSITION.md`
- **ADR (FOLD reactive-derived-decl):** `docs/changes/reactive-derived-decl-divergence/ADR.md`

---

## Tags

#session-62 #open #post-a1a-complete #a1b-pending #a1c-pending #shape-3-codegen-gap-deferred-to-a1c #s11d5-todo-disposition-pending
