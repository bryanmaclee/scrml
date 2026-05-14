# scrmlTS — Session 90 (CLOSE — landmark 17-commit A-track-momentum session)

**Date:** 2026-05-13 → 2026-05-14 (S90 spanned midnight)
**Previous:** `handOffs/hand-off-89.md` (S89 CLOSE — 36-commit landmark; HEAD `71305fe`)
**This file:** rotates to `handOffs/hand-off-90.md` at S91 open

**Tests at S90 CLOSE:** **12,275 pass / 117 skip / 1 todo / 0 fail / 617 files** at HEAD `d52a7a2` (full `bun test` — unit + integration + conformance + browser + lsp + commands + self-host). +210 vs S89 close baseline 12,065 / 604.

**Cumulative S89 → S90 delta:** +210 tests / +13 files / 0 fail / 0 regressions across 17 PA-authored commits.

**Semver state:** unchanged — v0.2.6 `efbd1e8` still the shipped baseline.

**Cross-machine sync state at S90 close:**
- scrmlTS: HEAD `d52a7a2`; 0 ahead / 0 behind origin/main (push of A-3.3 happens at wrap step 7).
- scrml-support: 0 ahead / 0 behind origin/main ✅ (synced from S90 user-voice append earlier in session).

**Worktree state at S90 close:** clean. Only main checkout.

**Inbox state at S90 close:** no unread `.md` messages in either repo's `handOffs/incoming/`.

---

## S90 — what happened (full session ledger)

---

### Phase 1 — Session-open hygiene (closed clean)
- Rotated S89 hand-off → `handOffs/hand-off-89.md`; opened S90 hand-off.
- Appended S89 verbatim user-voice (4 directives: null/undefined absolute, self-host from-scratch, skinny-arrow lifecycle, "1 all" dispatch authorization) to `../scrml-support/user-voice-scrmlTS.md`.
- FULL_COLD_START map refresh via project-mapper: 11 maps regenerated; HEAD bumped `9b98118 → 71305fe`; test count `11,912/590 → 12,065/604`; Key Facts narrative S88 → S89 close.
- Commits + pushes: scrml-support `52d5650..7a3fbea`; scrmlTS `71305fe..e4c4863` (pre-push gate clean: 12,065 pass / 0 fail / 117 skip + TodoMVC gauntlet PASS).

### Phase 2 — M-7C-D-12 OQ dispositions (ALL 9 RATIFIED)

S89 SCOPING `docs/changes/m-7c-d-12-runtime-sentinel-scoping/SCOPING.md` had 9 OQs. S89 already ratified OQ-1 (Option ε). S90 ratifies the remaining 8:

**Explicit user disposition (3 substantive OQs):**
- **OQ-2 wire-envelope JSON shape** → **(b) `{"__scrml_absent": true}`** — forward-compat with β; mirrors `__scrml_error` canonical precedent (emit-server.ts L952).
- **OQ-5 `?? "undefined"` fallback** → **(a) replace with `"null"`** — preserves existing semantics per §42.5/§42.8; 16 sites (emit-server.ts ×3, emit-logic.ts ×10, scheduling.ts ×3).
- **OQ-6 error-code rename** → **(a) `E-DERIVED-ENGINE-INITIAL-UNDEFINED-RT` → `E-DERIVED-ENGINE-INITIAL-ABSENT-RT`** — breaking-change to error catalog accepted at v0.3 cut window.

**Batch-ratified on agent recommendation (5 OQs):**
- **OQ-3 sequencing** → **Parallel-aggressive variant** (T4 + T1 + T3 NOW; T2 after T4 lands; T5 last). OQ-2/5/6 ratifications already lock the design; saves ~14-22h walltime vs strict spec-first.
- **OQ-4 backwards-compat** → **(b) dual-decoder for scaffold; (a) clean break at v1.0** — T2 decoder accepts both raw `null` (legacy) and `{__scrml_absent:true}` (canonical).
- **OQ-7 DevTools experience** → **(a) accept + document** — §12.5.1 / §42.8 "Runtime Representation" subsection clarifies DevTools shows JS bit-pattern; scrml predicates classify correctly.
- **OQ-8 schema-differ M-7C-D-15** → **DEFER** — §42.9 interop boundary already covers SQL `NULL`; no SQL DDL changes.
- **OQ-9 spec-amend timeline** → **AFTER Wave 4 T+D (closed S89); concurrent with Wave 4 A+R (remaining tracks)** — spec changes are file-disjoint from adopter-content work.

### Phase 3 — Dispatch (in flight, retry round)

Parallel dispatch of 3 of 5 tracks per OQ-3 ratification:
- **T1 — AST internal cleanup** (10-14h, agent `a72b73107987faddd`): types/ast.ts LitExpr discriminator migration; parser stops manufacturing `"null"`/`"undefined"` litTypes; gauntlet-phase3 detector migration; component-expander; type-system whitelists.
- **T3 — `?? "undefined"` fix** (7-8h, agent `acb3b94dfdfe860c6`): 16-site mechanical replace `"undefined"` → `"null"` + new CG-level lint forbidding literal `undefined` JS-keyword interpolation as regression guard.
- **T4 — SPEC amendments** (4-7h, agent `adb60dde9579cd067`): §12.5.1 + new §50.x + §51.0.J + §34 catalog row + SPEC-INDEX refresh.

T2 (wire envelope, 10-12h) fires after T4 lands. T5 (audit closure docs, 2-4h) last.

#### Sub-phase 3.A — First dispatch routing finding (BLOCKED then RECOVERED)

**Symptom.** First-attempt dispatch (T1=`aaa100cd3664eec90`, T3=`a8aacdceef607dff9`, T4=`ad2cc4be28dcc7e5a`) — all three agents reported BLOCKED at startup-verification: harness provisioned their `isolation: "worktree"` worktrees under `/home/bryan-maclee/scrmlMaster/scrml-support/.claude/worktrees/agent-<id>/` instead of `scrmlTS/.claude/worktrees/`. Agents correctly refused to write per F4 + pa.md path-discipline rules.

**Root cause.** The Agent tool's `isolation: "worktree"` provisions worktrees based on the **Bash shell's current CWD**. PA's earlier user-voice commit chain (`cd /home/bryan-maclee/scrmlMaster/scrml-support && git add ... && git commit ... && git push ...`) persisted the shell CWD in scrml-support. Subsequent `git -C /home/bryan-maclee/scrmlMaster/scrmlTS <cmd>` calls do NOT change CWD — only `cd` does. When PA dispatched the three agents, the harness inherited scrml-support as the active CWD and routed worktrees there.

**Recovery.** Zero work-lost — F4 startup-verification block in each brief caught the wrong-repo `pwd` output, agents stopped before any writes. PA:
1. Ran `TaskStop` on T4 (still in flight; T1 + T3 had already returned BLOCKED).
2. Cleaned up the orphaned scrml-support locked worktree (`agent-ad2cc4be28dcc7e5a`).
3. Ran `cd /home/bryan-maclee/scrmlMaster/scrmlTS && pwd` to reset CWD.
4. Re-dispatched all 3 agents with the same briefs + an added "RETRY DISPATCH" note instructing the F4 verification to enforce the `scrmlTS/.claude/worktrees/` path-prefix check.
5. Verified post-dispatch: all 3 retry worktrees correctly under `scrmlTS/.claude/worktrees/` at base `725e07c`.

**Memory rule saved.** `feedback_agent_isolation_cwd_routing.md` captures the finding — added to MEMORY.md index. Operational rule for future PA: **after any Bash chain that includes `cd <sibling-repo>` during a session, run an explicit `cd /home/bryan-maclee/scrmlMaster/scrmlTS && pwd` BEFORE the next `Agent({isolation: "worktree"})` dispatch sequence.** Equivalent prevention: never `cd` into sibling repos — use `git -C <path>` for all sibling-repo git operations to keep CWD locked to scrmlTS throughout the session.

**Defense-in-depth confirmed.** This incident validates the F4 + path-discipline brief mandates (pa.md S58 + S88 layers). When the harness routing is broken, the F4 block + "STOP if check fails" is the protective gate. Without it, agents would have written compiler-source changes into scrml-support worktrees and tried to commit/push them — the work would have been lost or polluted. Keep F4 blocks mandatory in every dev-agent brief.

**Defensive brief amendment.** The retry briefs now explicitly require the worktree path to start with `/home/bryan-maclee/scrmlMaster/scrmlTS/.claude/worktrees/`. This sharpens the F4 check from "is this a worktree?" to "is this a worktree IN THE EXPECTED REPO?" — the standing pa.md F4 template should be updated to include this check in S91 maintenance.

### Phase 4 — Track landings (3 of 5 tracks LANDED in main)

All three retry agents completed cleanly. PA file-delta'd each into main, then unified `progress.md` from the three branches.

| Track | Agent | Agent FINAL_SHA | PA landing commit | Lines | Tests delta |
|---|---|---|---|---|---|
| **T1** AST cleanup | `a72b73107987faddd` | `46ec263` (5 commits) | `850a298` | +485/-52 | +23 |
| **T3** codegen + lint | `acb3b94dfdfe860c6` | `16185f5` (6 commits) | `887f420` | +705/-21 | +28 |
| **T4** SPEC amendments | `adb60dde9579cd067` | `7d76e20` (4 commits) | `8cef7f5` | +173/-58 | 0 |
| (PA progress unified) | — | — | `e3b1624` | +65/-0 | 0 |

**Tests at S90 progress merge HEAD `e3b1624`:** **11,374 pass / 88 skip / 1 todo / 0 fail / 578 files** (pre-commit gate subset; full-suite count to verify via pre-push hook on next push). Baseline pre-commit was 11,323 / 575 — delta +51 pass / +3 files matches T1 (+23) + T3 (+28).

**T1 substantive findings:**
- Discriminator strategy: `raw` field discriminates user-source `null`/`undefined` from synthetic/canonical absence. User `null` → `litType:"not", raw:"null"`; canonical `not` keyword → `litType:"not", raw:"not"`; synthetic absence (array hole, reset-RHS, is-* RHS) → `litType:"not", raw:"not"`. `emitStringFromTree` round-trip preserves source-token via `raw`.
- **Semantic refinement (intentional):** array holes `[1,,3]` now emit JS `null` (was JS `undefined` via `litType:"undefined"` fallback to `node.raw`). Aligned with §42.5/§42.8.
- Scope-notes (NOT migrated, defensible): `route-inference.ts` JS_KEYWORDS defensive filter; `tokenizer.ts` + `ast-builder.js` VALUE_KEYWORDS lexer-level classifications; `type-system.ts` `tPrimitive("null")` JS-host DOM ref type.
- **Pre-existing gap surfaced (NOT closed, follow-up):** component PropDecl `defaultValue:"null"` raw-attribute-string bypasses GCP3 walker. Track 1 preserves current behavior. Separate dispatch needed.

**T3 substantive findings:**
- 16-site migration confirmed (emit-server.ts ×3 / emit-logic.ts ×10 / scheduling.ts ×3).
- **Lockstep migration** of 3 consumer guards in emit-logic.ts (L612 `=== "undefined"` → `=== "null"`; L1906/L1921 `!== "undefined"` → `!== "null"`) — per SCOPING risk register; the fallback default + consumer guards are a coupled sentinel-pair.
- **Semantic cascade (intentional, OQ-5 (a)):** `fail E.Variant` (no args) now produces `data: null` instead of `data: undefined`. Pre-existing test migrated.
- New lint `W-CG-UNDEFINED-INTERPOLATION` (W-CG-* family). Idiom-aware exemptions: paired `null && undefined` (§42.5/§42.8); `typeof X !== "undefined"`; comments; string literals; template-literal text; embedded runtime block (M-7C-D-14 scope) masked.
- Corpus sanity sweep at agent: 289 samples + 45 stdlib = 334 files compiled, **0 W-CG-UNDEFINED-INTERPOLATION findings**.

**T4 substantive findings:**
- **§57 NEW Wire Format section** (NOT §50 — that slot was occupied by Assignment-as-Expression since v0.next). 7 subsections at SPEC.md L27050-27144.
- Rename: `E-DERIVED-ENGINE-INITIAL-UNDEFINED` → `E-DERIVED-ENGINE-INITIAL-ABSENT`. Three SPEC sites updated (§34 / §51.0.J / §55 validators-summary). Note: SCOPING called it `-RT` suffix; actual SPEC code lacks suffix — surgical rename preserves shape. Runtime-emission rename in compiler/src/* is Track 2 territory.
- §42.8 "Runtime Representation" subsection added (OQ-7).
- SPEC.md grew 27,037 → 27,144 lines.

**PA-side amendment during T4 landing:** §34 catalog row for `W-CG-UNDEFINED-INTERPOLATION` added directly (both T3 and T4 punted on the row). Row sits in W-CG-* family between W-CG-001 and E-ERRORS-001.

**Process flags surfaced:**

- **T1 agent's `--no-verify` use (one commit, mid-dispatch).** Agent's per-step chain included one `--no-verify` commit (`e37d932`) on a worry about a post-commit hook regex false-positive. Subsequent agent commits ran the full pre-commit gate cleanly. PA file-delta landed only the final tree shape through PA-authored commits — **no `--no-verify` in main's history**. Surfaced for transparency per pa.md S88 rule (process violation but final-state-green). Possible mitigation for future dispatches: brief explicitly forbids `--no-verify` without explicit user authorization (matching pa.md rule). For now: noted; no action required.
- **Coordination gap between T3 and T4 on §34 W-CG row.** Each agent punted to the other. PA closed during T4 landing. Could be prevented in future briefs by assigning the row explicitly to one agent (recommend: whichever agent owns SPEC.md edits, i.e., spec-amendment Track).

### Phase 5 — Worktree cleanup + push

- All three retry worktrees cleaned per S83 retention rule (content landed in main; cross-session retention unwarranted): `agent-a72b73107987faddd`, `agent-acb3b94dfdfe860c6`, `agent-adb60dde9579cd067` removed + branches deleted. Final state: only main checkout.
- Push of 4 commits (`725e07c..e3b1624`) backgrounded through pre-push gate (~5min full-suite).

### Remaining M-7C-D-12 work (after this push lands)

- **Track 2 — Wire envelope codegen (10-12h)** — encoder in emit-server.ts that wraps `?? null` in `{"__scrml_absent": true}` envelope when return type is `T | not`; client-side dual-decoder helper (canonical envelope + legacy raw-null fallback per OQ-4); tests. Now unblocked — §57 SPEC text lives at HEAD.
- **Track 5 — Audit closure docs (2-4h)** — document audit-item closure rationale in master-list + audit appendix; re-grep compiler/src/ post-migration; update audit counts (most M-7C-D-N + M-8C-D-N items close as spec-ratified per Option ε).
- Then: bundled paired-migration packets per Wave 9.A audit §6 ordering can begin firing.

## S90 — A-track full wave summary (mid-session through close)

Beyond the M-7C-D-12 wave close documented in Phase 6/7 below, S90 fired a sustained A-track parallel-aggressive momentum wave through to wrap. Net result: **5 of 9 A-2 sub-phases CLOSED** (Components 2/3/4/5 now wired; A-2.7 outer fixpoint remaining) + **A-3 substantive wave SUBSTANTIVELY COMPLETE** (4 of 5 sub-phases CLOSED: A-3.1 enumerator + A-3.2 role-enum resolution + A-3.3 per-gate classifier + A-3.4 redirect cross-ref; only A-3.5 SPEC integration + pipeline wiring remains).

### Phase 6 — T2 + T5 dispatch (T5 landed; T2 stalled → continuation in flight)

**T5 (audit closure docs):** ✅ LANDED `956184f` + progress `e03d269`.
- Agent `aa6ff329472c0bfbb`; 5 agent commits, FINAL_SHA `7b5fca8`.
- D-12.5a: CLOSURE banners added to null-audit + undefined-audit docs; master-list §0.6 M-7C-D-12 closure summary added with 5-track dispatch ledger.
- D-12.5b: Re-grep counts (`\bnull\b` 2,777 → 2,925 +9 files; `\bundefined\b` 861 → 933 +8 files). **Increases entirely additive context** — new S89/S90 files + T1 doc-comments. **Zero new M-class drift introduced.** Classification: J-class (JS-host legit) ~480/110; I-class (TS scaffold) ~1500/590; M-class ~720/140 (all closed-as-spec-ratified under Option ε except M-7C-D-6 T2-in-flight and M-8C-D-6 T3-migrated).
- Worktree cleaned.

**T2 (wire envelope codegen):** 🟡 PARTIAL → CONTINUATION DISPATCHED.
- First agent `a4402f7f60b722082` **stalled at 600s watchdog mid-deliberation** (NOT crash). Zero commits made; high-quality scaffolding in worktree working tree:
  - NEW `compiler/src/codegen/wire-format.ts` (~228 lines) with `returnTypeAllowsAbsence` predicate + encoder/decoder helper string constants
  - `emit-server.ts` (+28/-3) type-gated envelope wrapping at CSRF + non-CSRF emit sites
  - `runtime-template.js` (+15) `_scrml_wire_decode` dual-decoder helper inlined
- **Missing:** helper-injection wiring (`_scrml_wire_encode` called but never defined in output — agent ID'd the pattern "post-emit detect via `finalEmitted.includes('_scrml_wire_encode(')`" but stalled before applying); client decoder consumption wiring (`_scrml_wire_decode` declared but unused); tests.
- **Recovery shape ratified S90:** re-dispatch continuation agent with explicit "finish-from-WIP" brief. Continuation agent `acd2647377e9e6eca` dispatched. Brief reads partial files from retained worktree (read-only source), ports into fresh worktree, completes 3 missing pieces via 5 sequential steps with S83 commit discipline + no-`--no-verify` mandate.
- Original T2 worktree `a4402f7f60b722082` retained as read-only source for continuation.

### Phase 7 — A-2.3 dispatch (in flight, parallel with T2 continuation)

User authorized continued momentum while T2 continuation runs. A-2.3 = Reachability Solver Component 2 (`reactive_dep_closure(C)` per SPEC §40.9.3). 6-10h scope.

Agent `a6c8d2f1c115e02fe` dispatched. File-disjoint from T2 (reachability/ vs codegen/). Sub-tasks:
- A-2.3.a — Forward-DFS walker over `kind === "reads"` DG edges
- A-2.3.b — markup-read edge handling (admit edge `to`, not intermediary)
- A-2.3.c — `validator-reads` + `engine-derived-reads` edge handling (OQ-A2-J disposition)
- A-2.3.d — Dynamic-key recovery semantics (`@obj[runtimeKey]` → admit entire receiver)

Files: NEW `compiler/src/reachability/component-2.ts` (mirroring A-2.2's split pattern under `reachability/`), extend `reachability-solver.ts` orchestrator, ~12 tests in `compiler/tests/unit/reachability-solver-component-2.test.ts`. Dependencies: A-2.2 closed (S89). Downstream: Components 3/4/5 parallelizable per SCOPING §A-2.3 dependency note.

### Worktree state mid-Phase-7

```
main                                       e03d269 [main]
.claude/worktrees/agent-a4402f7f60b722082  0ed8e55 [retained — T2 partial, read-only source]
.claude/worktrees/agent-a6c8d2f1c115e02fe  e03d269 [A-2.3 in flight]
.claude/worktrees/agent-acd2647377e9e6eca  72df93b [T2 continuation in flight; 1 commit ahead]
```

### Phase 8 — T2 continuation + A-2.3 landings

- **T2 continuation** (`acd2647377e9e6eca`): completed cleanly per the "finish-from-WIP" brief shape (port partial scaffolding from stalled prior agent's worktree → helper-injection wiring → client decoder consumption wiring → tests). 6 commits, +33 tests, no `--no-verify` used. Helper-injection pattern lands at `emit-server.ts` L1357-1375 (mirrors structural-eq precedent at L1320-1368). Client decoder wiring single-site at `emit-functions.ts` L268-289 covers both direct + CPS paths. **M-7C-D-12 wave FULLY CLOSED** with this landing. PA landing commit `06987dc`.
- **A-2.3 Component 2** (`a6c8d2f1c115e02fe`): completed cleanly. NEW `compiler/src/reachability/component-2.ts` (537 LOC, 8 helpers). reachability-solver.ts extended for Component 2 wire-in. 15 new tests; zero A-1 edge-emission gaps surfaced. PA landing commit `687fba1`.

### Phase 9 — A-2.4 + A-2.6 sibling parallel dispatch (orchestrator collision handled)

User authorization: "continue A-track momentum" → optimal parallel-aggressive wave chosen: A-2.4 (Component 3 server_fn_reachable_within, 10-18h) + A-2.6 (Component 5 vendor_units_used_by, 4-7h) + A-3.1 (AuthGraph wave launch, 12-20h).

- **A-2.6 Component 5** (`aa7cf8dbea21cf6d0`): returned first. 4 commits, NEW component-5.ts (451 LOC), 12 new tests. PA landing commit `4ed04f2`. Orchestrator wire-in extended `makeChunkPlan` with `vendorUnitNames` third arg.
- **A-2.4 Component 3** (`a97f0c26e2dab8dd2`): returned second. Agent based on pre-A-2.6 main (`687fba1`); its orchestrator changes REVERSED A-2.6's vendor-unit wiring. **PA-merge required** — manually combined both Components into unified `makeChunkPlan(componentNodeIds, reactiveCellNodeIds, serverFnTiers, vendorUnitNames)` signature with `differenceSet` helper for per-tier server-fn differencing. NEW component-3.ts (1023 LOC), 17 new tests. PA landing commit `ba3f75c`.
- **A-3.1 AuthGraph wave launch** (`a8d5ac2f0332334c7`): returned. NEW types/auth-graph.ts (~354 LOC), NEW auth-graph.ts (~418 LOC enumerator), `<auth>` element registered in html-elements.js + attribute-registry.js. 15 new tests. Test fixture extensions for html-elements.test.js + type-system.test.js (S87 channel-architecture precedent — when new structural elements are added, hardcoded nonDomElements sets need extension). PA landing commit `0960fd5`.

### Phase 10 — A-3 OQ batch ratification (6 OQs, 1 substantive user override)

S89 already ratified OQ-1 (Option ε). S90 dispositioned the remaining 8 OQs (3 M-7C-D-12 OQs in Phase 2 + 6 A-3 OQs in this phase):

**OQ-A3-A — `<auth role=>` predicate grammar — RATIFIED (d) FULL INTERPOLATION (user override of agent recommendation (b)).**

Agent recommended (b) single-variant + comma-OR for "scope tractable" reasoning. User pushed back: *"the idea that user defined state has full interpolation but first class compiler supported state doesn't is confusing, counter intuitive, and hints that the language is still in a 'toy' status."* Per Rule 2 (full-production-language fidelity), value-bearing attrs in scrml uniformly accept string-literal / variable-ref / `${expr}` shapes (`if=`, `bind:value=`, `class:active=`, `value=`, `href=`, etc.). The `role` attr must be no less expressive than user-defined-state-bearing attrs.

Key clarification: "closed-form predicate" is an ANALYSIS phase that operates on whatever grammar is accepted; the grammar can be open while the classifier discriminates closed-form (variant literals + literal comma-OR + const-refs to role-set values + boolean composition of statically-known operands) vs runtime-fallback (reactive reads, server-fn calls, arbitrary expressions). Negation (`!Admin`, `${!@isAdmin}`) falls out of the predicate evaluator without separate grammar.

**Remaining 5 OQs RATIFIED on-recommendation (single batch):**
- OQ-A3-B → (a) bare string for redirect cross-ref
- OQ-A3-C → (b) explicit-per-page + W-AUTH-PAGE-INFERRED info-lint
- OQ-A3-D → binary channel-auth per current spec; per-role grammar deferred v0.4+
- OQ-A3-E → (a) compile-time only AuthGraph emission
- OQ-A3-F → (b)+(c) dual rule with E-AUTH-GRAPH-002 on ambiguity

PA landing commit `3b2a79c`.

### Phase 11 — A-3.2 + A-3.4 sibling parallel dispatch (auth-graph.ts collision PA-merged)

After A-3 OQ ratifications + A-2.4 + A-3.1 landed, dispatched A-3.2 role enum resolution (4-7h) + A-3.4 redirect cross-ref (3-5h) in parallel. Both extend `compiler/src/auth-graph.ts` at different functions — sibling collision via cherry-pick OR PA-merge expected.

- **A-3.4 redirect cross-ref** (`a5b18668a6cae0fdb`): returned first. NEW `crossRefRedirects` + `collectUrlPatterns` helpers in auth-graph.ts. NEW info-severity diagnostic I-AUTH-REDIRECT-UNRESOLVED. 12 new tests. severity union extended with "info". PA landing commit `e3fa180`.
- **A-3.2 role enum resolution** (`abc701ac0f518b569`): returned second. Agent based on pre-A-3.4 main; cherry-pick attempted; **2 conflicts in auth-graph.ts** (runAuthGraph wire-in + __test_helpers export) — PA-resolved by keeping both contributions (resolveRoleEnum first → produces `roleEnum` const used in graph object; crossRefRedirects second → mutates redirectTargets + errors). NEW E-AUTH-GRAPH-002 first fire-site. 12 new tests; 2 pre-existing tests updated.
- **A-3.4 test-fix follow-on:** after PA-merge, A-3.4's tests failed because they use `<auth role='admin'>` fixtures WITHOUT declaring a `UserRole` enum. A-3.2's `resolveRoleEnum` now also runs in the pipeline and (correctly) fires E-AUTH-GRAPH-002 for these gate-references-variant-but-no-enum cases. Fix: 12 `expect(errors).toHaveLength(N)` assertions replaced with `expect(errors.filter(e => e.code === "I-AUTH-REDIRECT-UNRESOLVED")).toHaveLength(N)`. Forward-compatible: future A-3.3 / A-3.5 sub-phases adding more pipeline diagnostics won't break these tests either. PA landing commit `6fca620` (combines A-3.2 substantive + A-3.4 test fix).

### Phase 12 — A-2.5 + A-3.3 sibling parallel dispatch (clean file-disjoint landing)

After A-3.2 closed, A-2.5 Component 4 became unblocked (hard-depends on A-3.1+A-3.2). Dispatched A-2.5 + A-3.3 per-gate classifier in parallel. Brief design ensured file-disjoint: A-2.5 extends `reachability-solver.ts` + new `component-4.ts`; A-3.3 extends `auth-graph.ts` + `attribute-registry.js`. No collision.

- **A-2.5 Component 4** (`a4e77897ed369103f`): returned first. NEW `compiler/src/reachability/component-4.ts` (~558 LOC). RSInput.authGraph narrowed from `unknown` to `AuthGraph | null | undefined`. **Per-role ChunkPlan emission** lands: ChunkPlan moves from single-`_anonymous`-keyed to per-role-variant classification. **NEW W-AUTH-RUNTIME-FALLBACK + E-CLOSURE-002 first fire-sites.** 21 new tests. PA landing commit `4059532`.

  Architectural note: per-role filtering currently applies to `componentNodeIds` only because DG-id atoms (reactive cells, server-fns, vendor units) don't carry markup-tree ancestry through the present pipeline. Conservative ship-eagerly floor preserved per §40.9.5 runtime-fallback semantics. A-2.7 (outer fixpoint) and A-4 (artifact splitter) can extend per-cell/per-server-fn filtering when DG → markup back-references are added.

- **A-3.3 per-gate classifier** (`a179292f6a406c186`): returned second. EXTEND auth-graph.ts with `classifyGates` + 11 helpers (~470 LOC). REUSES META constant-folder primitive at `compiler/src/codegen/constant-folder.ts` (authored S89 A-2.2.b; OQ-A2-D shared-primitive disposition working correctly across A-2 + A-3 + Component 1). `<auth role=>` attribute-registry.js entry changed `supportsInterpolation: false → true` per OQ-A3-A (d) ratification. **NEW W-AUTH-PAGE-INFERRED first fire-site.** 21 new tests. 6 A-3.1 baseline tests updated (classification: null → populated). PA landing commit `d52a7a2`.

### Worktree state at S90 close

```
main                                       d52a7a2 [main]
(no agent worktrees)
```

All agent worktrees cleaned per S83 retention rule. Cross-session retention is dead weight; agent per-step granularity is already integrated into main via PA-authored landing commits.

---

## S90 commit ledger (chronological, 17 PA-authored commits)

| # | Commit | Description |
|---|---|---|
| 1 | `7a3fbea` | scrml-support: user-voice(s89) — 4 verbatim directives |
| 2 | `e4c4863` | docs(s90-open) — hand-off rotation + map FULL_COLD_START refresh |
| 3 | `725e07c` | docs(s90-m-7c-d-12-OQ-disposition) — all 9 OQs ratified |
| 4 | `850a298` | m7cd12 T1: AST internal cleanup — LitExpr canonical "not" |
| 5 | `887f420` | m7cd12 T3: codegen `?? "undefined"` → `?? "null"` + W-CG-UNDEFINED-INTERPOLATION |
| 6 | `8cef7f5` | m7cd12 T4: SPEC §12.5.1 + §57 wire-format + §51.0.J + §42.8 + §34 |
| 7 | `e3b1624` | unified progress.md merge for M-7C-D-12 |
| 8 | `0ed8e55` | docs(s90-hand-off) — Phase 4+5 |
| 9 | `956184f` | m7cd12 T5: audit closure docs + master-list §0.6 + re-grep |
| 10 | `e03d269` | docs(s90-m-7c-d-12) — T5 landed + T2 partial-recovery state |
| 11 | `ad17faf` | docs(s90-hand-off) — Phase 6+7 |
| 12 | `06987dc` | m7cd12 T2: wire envelope encoder + dual-decoder + 33 tests — wave CLOSED |
| 13 | `687fba1` | A-2.3: Reachability Solver Component 2 (reactive_dep_closure) — 15 tests |
| 14 | `4ed04f2` | A-2.6: Reachability Solver Component 5 (vendor_units_used_by) — 12 tests |
| 15 | `ba3f75c` | A-2.4: Component 3 (server_fn_reachable_within) + orchestrator merge with A-2.6 |
| 16 | `0960fd5` | A-3.1: AuthGraph wave launch — auth-site enumerator + `<auth>` registration |
| 17 | `3b2a79c` | docs(s90-a3-OQ-disposition) — 6 OQs ratified; OQ-A3-A → (d) per user override |
| 18 | `e3fa180` | A-3.4: AuthGraph redirect cross-ref + I-AUTH-REDIRECT-UNRESOLVED info-lint |
| 19 | `6fca620` | A-3.2: AuthGraph role-enum resolution + E-AUTH-GRAPH-002 + A-3.4 test fix |
| 20 | `4059532` | A-2.5: Reachability Solver Component 4 + per-role ChunkPlan + W-AUTH-RUNTIME-FALLBACK + E-CLOSURE-002 |
| 21 | `d52a7a2` | A-3.3: AuthGraph per-gate classifier + W-AUTH-PAGE-INFERRED + role= interpolation relaxation |

(Plus scrml-support: `7a3fbea` user-voice S89 append.)

---

## State-as-of-S90-CLOSE tables

### Tests at HEAD `d52a7a2`

**12,275 pass / 117 skip / 1 todo / 0 fail / 617 files** (full `bun test`).
- Cumulative S89→S90: **+210 pass / +13 files / 0 fail / 0 regressions** across 17 substantive PA-authored commits + 4 docs commits.

### Waves CLOSED end-to-end this session

- ✅ **M-7C-D-12 runtime sentinel wave** — all 5 tracks CLOSED:
  - T1 AST cleanup (LitExpr canonical "not" discriminator)
  - T3 codegen `?? "undefined"` → `?? "null"` fix + new W-CG-UNDEFINED-INTERPOLATION lint
  - T4 SPEC amendments (§12.5.1 + NEW §57 Wire Format + §51.0.J rename + §42.8 Runtime Representation + §34 catalog rows)
  - T5 audit closure docs + master-list §0.6 + post-S90 re-grep counts
  - T2 wire envelope encoder + dual-decoder + 33 tests (continuation after first-attempt stall)
- ✅ **All 9 M-7C-D-12 OQs ratified** (3 substantive + 5 batch + OQ-1 carried from S89)
- ✅ **All 6 A-3 OQs ratified** (1 substantive user override + 5 batch)
- ✅ **A-2 Reachability Solver Components 2, 3, 4, 5** all wired through orchestrator (Component 1 was S89; A-2.7 outer fixpoint remaining)
- ✅ **A-3 AuthGraph SUBSTANTIVELY COMPLETE** — A-3.1 enumerator + A-3.2 role-enum + A-3.3 classifier + A-3.4 redirect cross-ref all landed; only A-3.5 (SPEC §34 catalog + pipeline wiring + integration tests) remains

### NEW first fire-sites (5 new diagnostics landed S90)

- **W-CG-UNDEFINED-INTERPOLATION** (warning) — T3 codegen regression-guard lint; corpus-sweep clean (0 findings on 334-file corpus post-migration)
- **I-AUTH-REDIRECT-UNRESOLVED** (info) — A-3.4; fires when AuthGate's redirect target isn't in RouteMap.pages
- **E-AUTH-GRAPH-002** (error) — A-3.2; fires when auth-role-block gate references variant but no enum declared (ambiguous discovery)
- **W-AUTH-RUNTIME-FALLBACK** (warning) — A-2.5; fires when gate predicate cannot be statically resolved (per OQ-A2-I)
- **E-CLOSURE-002** (error) — A-2.5; fires when implicit-anonymous + auth-role-block gate (no-role-enum-with-variant-references; per OQ-A2-F)
- **W-AUTH-PAGE-INFERRED** (info) — A-3.3; fires when `<page>` lacks explicit `auth=` under `<program auth="required">` (per OQ-A3-C)

**§34 SPEC catalog rows for all 5 NEW diagnostics deferred to A-3.5 SPEC dispatch** (already-emitted code shapes preserved; SPEC text-side artifact is the deferred piece).

### Approach A wave status post-S90

| Wave | Status |
|---|---|
| A-1 markup-context edges | ✅ CLOSED (S88-S89) |
| **A-2 Reachability Solver** | 🟢 **MOSTLY CLOSED** (Components 1-5 wired; only A-2.7 outer fixpoint + A-2.8/A-2.9 polish remaining) |
| **A-3 §40 AuthGraph** | 🟢 **SUBSTANTIVELY COMPLETE** (4 of 5 sub-phases; only A-3.5 SPEC integration + pipeline wiring remains) |
| A-4 Per-Route Artifact Splitter | ⏸️ SCOPING-level only; consumes A-2 ReachabilityRecord output |
| A-5 Integration Tests | ⏸️ SCOPING-level only; depends on A-2 + A-3 + A-4 |

### Memory rules saved S90

- `feedback_agent_isolation_cwd_routing.md` (NEW) — Agent tool's `isolation: "worktree"` uses Bash shell CWD as routing root; `cd <sibling-repo>` persists across Bash calls (`git -C` does NOT change CWD); always `cd /home/bryan-maclee/scrmlMaster/scrmlTS && pwd` BEFORE Agent dispatches if a sibling-repo `cd` happened earlier. **S90 precedent: 3 agents routed to scrml-support worktrees on first dispatch attempt; F4 startup-verification saved the dispatch from silent damage (agents detected wrong-repo `pwd` and aborted without writes).**

### Insights surfaced (not yet ratified to design-insights.md)

- **OQ-A3-A user-override precedent.** The pattern "agent recommendation X / user overrides to Y on first-class-state symmetry grounds" is methodology-grade signal. Agent-recommended "scope tractable" framings can mask Rule-2 violations; PA must surface them as deliberation points, not silently ratify. User-voice S90 verbatim: *"the idea that user defined state has full interpolation but first class compiler supported state doesn't is confusing, counter intuitive, and hints that the language is still in a 'toy' status."* This is the same shape as S66 narrowing reversal — restate the precedent in user-voice + consider design-insight folding at next deliberation thread.

- **CWD-routing trap is structural, not one-off.** Three agents routed to wrong repo in a single dispatch wave because of cumulative `cd` persistence. The F4 path-prefix check is the protective gate; without it, agents would have written compiler-source changes into scrml-support worktrees. Permanent rule saved in memory; pa.md F4 template update queued for S91 (the standing template should add explicit repo-prefix check).

---

## Session-start observations (PA work product for S90)

### Map currency
- `primary.map.md` line 3: `commit: 9b98118` — stamped at S89 open (post-worktree-cleanup baseline). S89 then committed 36 commits ending at `71305fe`. The S89 wrap commit `71305fe` updated map FILE CONTENTS (per its commit body: ".claude/maps/* → reflect S89 chain closures + new files (12 map files refreshed)") but the metadata header `commit: 9b98118` was NOT bumped — looks like editor-content was rewritten without re-touching line 3.
- **Action surfaced to user (Q-OPEN-1):** propose incremental `/map` refresh at S90 open to (a) bump the metadata SHA forward and (b) catch any drift from the 36 S89 commits that the wrap-time refresh missed.

### User-voice gap from S89
- `../scrml-support/user-voice-scrmlTS.md` was NOT appended for S89. Last entry in user-voice is S88 (`## Session 88 — 2026-05-12 → 2026-05-13`).
- S89 had **4 durable verbatim directives** that should be in user-voice per pa.md "Writing to user-voice" rules (append-only, verbatim, never paraphrase):
  1. **"null does NOT EXIST IN SCRML! and never will!"** + **"yes this extends to undefined. \"\" is still defined. it is a string, it is empty but a string none the less"** — the absolute null+undefined eradication directive
  2. **Self-host is a from-scratch rewrite** (corrected PA's "TS parity is load-bearing" framing; user verbatim from S89, captured in `feedback_self_host_is_from_scratch.md`: *"look, scrml does it WAY BETTER" — not "look, scrml can do it too."*)
  3. **Skinny arrow `A -> B` semantic** — user verbatim S89: *"starts as A, can become B"* (lifecycle transition; NOT function type / union / mapping)
  4. **"1 all"** + **"1 all. concurrent where safe"** — authorization shape for parallel-dispatch batching
- Memory files captured these. user-voice did NOT. **Action surfaced to user (Q-OPEN-2):** append S89 user-voice section before further S90 work — this is the canonical verbatim log.

---

## Open questions to surface immediately (S91 pickup)

### Q-OPEN-1 — A-3.5 SPEC catalog rows + pipeline wiring (5-8h)
The 5 NEW diagnostics from S90 (W-CG-UNDEFINED-INTERPOLATION + I-AUTH-REDIRECT-UNRESOLVED + E-AUTH-GRAPH-002 + W-AUTH-RUNTIME-FALLBACK + E-CLOSURE-002 + W-AUTH-PAGE-INFERRED) need §34 SPEC catalog rows. Plus `runAuthGraph` needs wiring into `compiler/src/api.js` post-RI invocation (the A-3 module is currently uncalled by the driver; consumers are unit tests only). Plus the worked-example fixture from SPEC §40.9.9 should replay end-to-end. This is the LAST sub-phase of A-3.

### Q-OPEN-2 — A-2.7 outer fixpoint operator (8-14h)
Closes A-2 wave. Needs Components 3/4/5 all complete (✅ done S90). The outer closure operator chases the five-component union until fixpoint; emits E-CLOSURE-001 on iteration-cap overflow per SPEC §40.9.1.

### Q-OPEN-3 — A-2.8 + A-2.9 polish (7-12h)
- A-2.8 `--emit-reachability` CLI flag wiring + JSON serialization upgrade (canonical key-ordering for determinism)
- A-2.9 Performance + memory characterization + ceiling-baseline (corpus-wide measurement post-A-2)

### Q-OPEN-4 — A-4 Per-Route Artifact Splitter (60-120h)
Major next-wave work. ReachabilityRecord consumption in `codegen/index.ts` + `initial_chunk(E)` emission per role per entry point + prefetch tier 1/2 emission + tier-N on-demand machinery + content-addressing integration (§40.9.8/§47.5) + per-role chunk variance (§40.9.9). Long walltime; only starts after A-2.7 closes.

### Q-OPEN-5 — Wave 4.A remaining tracks (A + R) (carried from S89)
**A-track (scrml.dev refresh)** + **R-track (README + currency)** pending. ~6-12h aggregate. Adopter-content; v0.3.0 cut path blocker per S88 user ratification.

### Q-OPEN-6 — Paired migration packets (post-M-7C-D-12-runtime emission)
M-7C-D-12 wave landed scaffold (encoder + dual-decoder); the existing `compiler/src/runtime-template.js` + `compiler/src/codegen/emit-engine.ts` + similar still contain JS-host `null` / `undefined` interpolations that are legitimate per the J-class classification but warrant a re-grep audit post-A-3.5. Per S90 T5 audit: 2,925 null / 933 undefined sites total (M-class ~720/140 closed-as-spec-ratified). Defer until A-3.5 closes.

### Q-OPEN-7 — pa.md amendments to fold S90 memory rules
- `feedback_agent_isolation_cwd_routing.md` is arguably load-bearing for every future PA session that does cross-repo `cd` operations. Consider pa.md fold-in (operational rule under "Cross-repo messaging" section or new "CWD discipline" subsection).
- F4 brief template should be amended to explicitly require `MUST start with /home/bryan-maclee/scrmlMaster/scrmlTS/.claude/worktrees/` path-prefix check (S90 routing finding sharpening).

### Q-OPEN-8 — `default=null` audit-doc closure (carried from S89)
Still pending. Check whether `docs/audits/articles-currency-table-2026-05-13.md` needs an update note reflecting the post-S89 ruling change (null/undefined now ABSOLUTE).

### Q-OPEN-9 — `/map` refresh
HEAD is `d52a7a2`; `primary.map.md` line 3 still stamps commit `71305fe` (S89 close). All S90 landings (17 substantive commits) + 5 NEW diagnostics + 4 NEW reachability components + AuthGraph module are NOT reflected in current maps. Recommend full cold-start `/map` refresh at S91 open (similar to S90 open hygiene pattern).

---

## Things S91 PA must NOT screw up

- **DO NOT** revisit "TS parity" as a load-bearing scrml property. TS impl is scaffold; self-host is from-scratch rewrite. Per `feedback_self_host_is_from_scratch.md`.

- **DO NOT** treat `null` or `undefined` as canonical scrml tokens in ANY context. They do not exist in scrml. `""` / `0` / `false` / `[]` / `{}` ARE defined values. Per `feedback_null_does_not_exist_in_scrml.md`.

- **DO NOT** clean up agent worktree BEFORE landing its content into main. Per `feedback_land_before_cleanup.md`.

- **DO** check agent's working tree for uncommitted Step-N work when agent crashes pre-commit. Per `feedback_agent_crash_partial_recovery.md`.

- **DO** trust Rule-4 reconnaissance. S89 had 8 substantive Rule-4 findings (W-PROGRAM-SPA-INFERRED already-done; §36 70%-already-done; Wave 4 substantially-advanced; §13.2 Sub-C already-Sub-B-done; A-2 algorithm SPEC-pinned; 8.C self-host superseded; 9.A all items chain-blocked; 9.B SPEC-already-ratifies-codegen-null).

- **DO** set `isolation: "worktree"` on EVERY dev-agent / scrml-writer / codegen Agent() call. Per S88 addendum to pa.md.

### Rules permanently load-bearing
- Rule 1 — no marketing/article/tweet work unless user brings it up
- Rule 2 — full-production-language fidelity
- Rule 3 — right answer beats easy answer 99.999% of the time
- Rule 4 — spec is normative; derived planning docs are NOT
- S86 ratifications — idiomatic-examples styling rule + corpus-ouroboros warning + BS-layer over SPEC retreat
- S87 memory rules — bash-cleanup dry-run + file-delta base SHA check
- S88 memory rules — file-delta-vs-cherry-pick + stated-intent-vs-corpus migration
- S89 memory rules — land-before-cleanup + agent-crash-partial-recovery + null-does-not-exist-in-scrml + self-host-is-from-scratch
- **S90 NEW memory rule — agent-isolation-cwd-routing** (`isolation: "worktree"` uses Bash shell CWD as routing root; sibling-repo `cd` persists across Bash calls; always `cd /home/bryan-maclee/scrmlMaster/scrmlTS && pwd` BEFORE Agent dispatches if a sibling-repo `cd` happened earlier)

### Additional S90 PA discipline patterns (carry forward)

- **DO** PA-merge orchestrator collisions PA-side when sibling parallel dispatches both extend a shared file at different functions. The pattern is: file-delta NEW files cleanly + PA-author merged version of the shared file integrating both contributions. S90 precedent: A-2.4 + A-2.6 reachability-solver.ts merge (kept both makeChunkPlan extensions); A-3.2 + A-3.4 auth-graph.ts merge (kept both `runAuthGraph` wire-ins + both __test_helpers exports via git cherry-pick).

- **DO** anticipate test-fixture cascade when adding new pipeline diagnostics. S90 precedent: A-3.2's E-AUTH-GRAPH-002 broke A-3.4's tests because their fixtures used `<auth role='admin'>` without declaring `UserRole` enum. Fix shape: replace `expect(errors).toHaveLength(N)` with `expect(errors.filter(e => e.code === "SPECIFIC-CODE")).toHaveLength(N)`. Forward-compatible to future pipeline-diagnostic additions.

- **DO** surface agent recommendations as deliberation points when they invoke "scope tractable" framings on first-class-language-shape questions. S90 precedent: OQ-A3-A — agent recommended (b) "scope tractable"; user overrode to (d) on Rule-2 fidelity grounds. The agent's "smaller surface" framing concealed a first-class/user-state asymmetry. PA should surface scope-tractable recommendations explicitly rather than ratify silently.

---

## Push state at S90 close

scrmlTS: HEAD `d52a7a2`; 4 commits ahead of origin (`6fca620..d52a7a2`: A-2.5 + A-3.3 + hand-off close). **PUSH PENDING — wrap step 7 executes during this close.**

scrml-support: 0 ahead / 0 behind. Clean.

---

## Tags

#session-90 #close #LANDMARK-17-COMMITS #M-7C-D-12-wave-CLOSED-end-to-end #A-2-Components-2-3-4-5-wired #A-3-substantively-complete-4-of-5 #5-NEW-diagnostics-first-fire-sites #OQ-A3-A-user-override-d-full-interpolation #per-role-ChunkPlan-emission-landed #user-voice-S89-appended #map-refresh-S90-open #agent-isolation-cwd-routing-memory-saved #PA-merge-orchestrator-collisions-x2 #PA-merge-auth-graph-collision #post-emit-helper-injection-pattern #attribute-registry-role-supportsInterpolation-true
