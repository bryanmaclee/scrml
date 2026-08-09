<!-- ============================================================= -->
<!-- hand-off.md — live session state. Prior wraps: handOffs/hand-off-s332.md -->
<!-- (S277–S332) + handOffs/hand-off-s276.md etc. Mechanical stream: delta-log. -->
<!-- ============================================================= -->

# scrml — Session 334 (peter · Windows) — WRAP

**Date:** 2026-08-09. `/boot` Profile A FULL. **2 PRs landed** (#484 codegen · #485 tooling). main `05787a42` → **`ef23a4d0`**, coherence 0/0 both repos. Conformance **877/877**. Cloud gate GREEN incl. Windows. Delta-log **[1286]–[1294]**.

## 🔴 READ FIRST

1. **S331-bryan is LIVE** (falsified S333's "presumed-DONE" — he's actively landing: #482 match-block-arm HIGH, #483 dpa-024 bank, user-voice updates). I wrapped as SUCCESSOR on disjoint surface; his session continues. All my shared-surface edits rode gate-serialized PRs (conflict→rebase, never silent clobber — witnessed: #484 rebased over his #482).
2. **⛔ HELD for bryan (his lane — do NOT take as compute):**
   - **if-value fork RULED B** (adopt §18.5 tail-lift). I **pushed his held build** `worktree-agent-ad7fea65da10675c1` @ `5fc00afa54f97cf40136a028d01678d0b72555c7` to origin (branch on remote now; worktree RETAINED). **bryan lands the §17.6 SPEC amendment off it** — NOT yet landed. Routed + SHA in his inbox.
   - **g-263 cross-file-const** (S332) — his §14.8 lane; branch `fix/g263-cross-file-const-attr-value-seed`@`b9d68190` pushed, unmerged.
   - **`g-implicit-cell-double-write-clobbers-reset-init` (§6.8) — ROUTED this session as a SEMANTICS FORK** (not a codegen fix). Reset target of a multi-write implicit cell is author intent, not structure (`@x=0;@x=@x+1`→0 vs `@config=base();@config=merge()`→merged are AST-identical). 4 fork options in `incoming/…implicit-multiwrite-reset-is-a-semantics-fork.md`. Reverted clean; 2 builds + 3 S239 rounds proved it. [[feedback-structurally-identical-opposite-output-is-semantics-lane]].

## 🎯 WHAT LANDED

- **#484** (`93388e3c`) — `g-request-is-some-in-value-bool-class-attr`. A `<#request>.data is some` in a value/bool/class attribute emitted malformed `input_state_registry.get("r").(data !== null…)` → E-CODEGEN/silent-drop (build-integrity floor). Fix: shared `reparseRequestRefEscapeHatch` (mirrors S312) + a `gateToRegisteredRequests` flag — value/bool/class gated (typo/input-state drop-safe), if=/show= UNGATED (S312 input-state toggles preserved). **3 S239 rounds** (R1 drop→crash; R2 an if=/show= input-state REGRESSION the satellite's self-check missed — I ground-truthed it; R3 fixed). +1 RT conformance case. Filed 2 siblings sharing the escape-hatch substrate: `g-request-is-some-in-each-loop-attr-misroute` (emit-each.ts:1893, SILENT) · `g-request-is-some-in-mixed-text-attr-template-misroute` (emit-bindings.ts:423, LOUD).
- **#485** (`ef23a4d0`) — state.ts ledger-integrity trio: dedup-by-id (throw on conflict) · maps-staleness ancestry guard · heading/marker drift detection (WARN-only; found 13 live drifts). **BONUS ROOT FIX:** a marker carrying a code-literal `<msg> = ""` was truncating the `[^>]` parser → state.ts was THROWING on main AND undercounting the §0 table; `[\s\S]*?` restored correct counts (**HIGH 23→25, MED 124→125, LOW 54→55**, independently verified). 6 gate-discoverable unit tests.

## 🧭 CENSUS — 66 open MEDs repro-gated vs HEAD (4 satellites; Peter authorized broad spend). Full breakdown in `../scrml-support/handOffs/active-sessions/S334-peter.md`.
- **16 STALE-RESOLVED** (cheap ledger closes) · 42 STILL-OPEN · 2 RULING · 6 CANT-REPRO. ~24% of the broad ledger is dead weight (targeted stale-hunt hit 53%).
- **~9 live Peter-lane GROUPABLE clusters** (one-fix-many; trio already = #485): show=first-paint pair · attr-writer-conflict trio · value-attr-component-root pair · gated-each pair · **SSR-each arc** · emit-each content-model pair · landmark/outlet pair · lift-if inline · on-mount pair.
- **Path/coordinate "cluster" hypothesis DISPROVEN** by repro (mostly already-landed; 2 survivors distinct). Biggest mechanical lever = CPS-scheduler root (~11 auto-await gaps) but that's bryan's §13.2 axis.

## ⭐ NEXT PRIORITY (aM-relevance-ranked, data-driven from aM's 19 .scrml sources)
**The SSR-each prerender arc is the #1 adopter-value pickup** — `g-ssr-each-row-template-subset-blocks-all-prerender` (+ sibling `g-ssr-each-multi-root-client-only-fallback`, same `emit-ssr-render.ts` module). aM = **132 `<each>` + 295 computed-class interps (`class="…${…}"`) + SSR pages** → the SSR each-renderer refuses non-literal-attr / non-field-read-interp rows, so ~every aM data list loses SSR first paint (client-only fallback). ⚠️ CAREFUL arc — widening prerender must not create hydration mismatches (the gap's own body flags this); NOT a one-liner. Cheapest groupable (`show=` pair) is N/A to aM (aM uses 0 `show=`). Secondary aM signal: 13 `on mount`s (on-mount pair).

## 🧷 STATE / DEFERRED (recorded, execute next session or as batch PRs)
- **16 census stale-close ledger flips** (open→resolved + 2 symptom-text updates; g-e-eq-001 HOLD-for-bundle) — full list + compile-evidence in board S334. Deferred (bryan live + cleaner as a dedicated ledger-hygiene PR than bundling into this wrap).
- **Still to file:** the incidental **base64-`=`-in-server-fn-template-literal → false E-FN-003** (census-1 find). (The 2 request-attr siblings are already filed under #484.)
- **Review floor:** cleared to zero by bryan's #482. #484/#485 are new MERGED PRs → re-check `bun scripts/review-debt.ts` at next boot (likely 2 newly-owed).
- **Worktrees (6b):** PRUNED `agent-a6545371456b05890` (#484 landed). RETAINED `agent-ad7fea65da10675c1` (if-value, bryan's amendment pending) + `scrml-pinned` (leave).
- **Maps (6c):** in-file changes only this session (emit-* attr lowering; scripts/state.ts); no new modules. project-mapper refresh owed (watermark `35d4d32e`, 16 behind) — LOW urgency, deferred.

## 🔑 METHOD NOTES THAT OUTLAST
- **S239 caught real bugs the satellite self-reports missed, EVERY fix** (#484: 3 rounds incl. a regression its "byte-identical" self-check got WRONG — ground-truth the claim, never trust the self-report). Recurred from S333's six catches.
- **Repro-gate BEFORE building** disproved a whole cluster hypothesis (path/coordinate mostly already-landed) and caught the implicit-reset gap as a semantics fork after a full build. Cheapest bulk win = the stale-hunt (~50% hit).
- **aM-relevance reranks cheapness:** the cheapest groupable (`show=`) helps aM zero; the SSR-each arc (mid-cost) helps aM most. Adopter usage is the real priority signal — grep the aM clone (`../assetManagement`).
