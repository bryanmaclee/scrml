# scrmlTS — Session 79 (CLOSE — debounce/throttle Approach B SHIPPED · A5-6 Feature 1 SHIPPED · hardcoded-thresholds ALL 5 ITEMS SHIPPED · Batch K combined deref sweep · 88 new unit tests · 7 commits scrmlTS + 1 commit scrml-support · 0 regressions · pushed to origin)

**Date opened:** 2026-05-10
**Date closed:** 2026-05-11 (single-day session crossing midnight; substantial throughput across 4 SHIPs + 1 deref sweep + 1 dispatch landing)
**Previous:** `handOffs/hand-off-78.md` (S78 close — Phase A10 SHIPPED end-to-end · 6-deep deferral chain CLOSED · A5-6 Feature 1 UNBLOCKED · SPEC + test conformance audits BOTH COMPLETE · machine-switch wrap · 16 commits / +101 tests / 0 regressions)
**This file:** rotates to `handOffs/hand-off-79.md` at S80 open

**Tests at open (S78 close baseline):** 11,051 pass / 77 skip / 1 todo / 0 fail (530 files)
**Tests at S79 close (final commit `d860e37`):** **10,476 pass / 62 skip / 1 todo / 0 fail (506 files; pre-commit subset = unit + integration + conformance with --bail)**

> **Note on test-count delta:** the 506-file / 10,476-pass figure is the **pre-commit subset** (`bun test compiler/tests/unit compiler/tests/integration compiler/tests/conformance --bail`). The S78-close 530-file / 11,051-pass figure was the FULL suite (`bun run test` including browser + lsp + commands + self-host). Pre-commit subset is what the hook gates; full-suite delta is not measured this session (no full-suite invocation). The pre-commit subset INCREASED across S79 (+88 unit tests added across all 4 SHIPs; -6 retired pre-v0.next assertions from clean-cut). Verify full-suite count at S80 open if needed.

---

## S79 close — summary

Substantial session. **4 SHIPs** (A5-6 Feature 1 · hardcoded-thresholds Bucket A · Bucket B+C · debounce/throttle Approach B) + **1 deref sweep** (Batch K, 131 file/dir moves) + **1 agent dispatch landing** (debounce/throttle via worktree-as-scratch / file-delta). All under explicit user authorization. Zero regressions.

### S79 commit chain (in order — 7 commits on scrmlTS + 1 on scrml-support)

**scrmlTS commits (7):**
1. `130b7d0` deref(s79): Batch K combined deref to scrml-support — 268 deletions + 22 meta-doc updates
2. `1547e78` feat(s79-a5-6): SHIP — A5-6 Feature 1 (named timer + cancelTimer builtin) per SPEC sec 51.0.M.1
3. `fcb45df` feat(s79-thresholds): SHIP Bucket A — MAX_RUNS overridable + EncodingContext.seqCap injectable
4. `5ac54de` feat(s79-thresholds): SHIP Bucket B + C — serve-client timeouts + idempotency-ttl + batch-in-list-cap
5. `3446989` feat(s79-debounce-throttle): SHIP — Approach B (clean-cut) per SPEC §6.13
6. `d860e37` chore(s79): gitignore runtime test fixtures
7. (this wrap commit)

**scrml-support commits (1):**
- `0c1892f` archive(s79): Batch K combined deref from scrmlTS — 130 file/dir adds

### Counts at close

- **scrmlTS:** 7 commits ahead of origin at wrap-commit time (pushed at wrap close per "wrap" definition)
- **scrml-support:** 1 commit ahead of origin at wrap (pushed at wrap close)
- **Pre-commit test subset:** 10,476 pass / 62 skip / 1 todo / 0 fail (506 files)
- **New unit tests added across S79:** 28 (A5-6 Feature 1) + 11 (Bucket A) + 21 (Bucket B+C) + 28 (debounce/throttle) = **88 new tests** + 6 retired pre-v0.next assertions = +82 net
- **SPEC amendments:** §51.0.M.1 NEW (A5-6) + §6.13 NEW (debounce/throttle) + §6.8 amend (reset-cancel) + §19.9.6 amend (idempotency TTL) + §8.10.6 amend (batch-IN-list cap) + 6 new §34 catalog codes
- **Files moved (Batch K):** 131 individual file/dir moves to scrml-support archive
- **`docs/changes/` count:** 99 → 4 (KEEP-LIVE: predicate-gaps-deep-dive-prep, promotion-ergonomics, v0next-audit, v0next-inventory) + 1 new (`debounce-throttle-approach-b/`) = 5
- **`docs/audits/` count:** 22 → 3 (scope-c-findings-tracker, compiler-forgotten-surface-2026-05-06, hardcoded-thresholds-2026-05-10)
- **`docs/{recon,experiments,deep-dives}/`:** REMOVED entirely from scrmlTS (per Batch K)

---

## S79 thread-by-thread

### Thread 1 — Project-mapper refresh (early-session)

User asked "project-mapper refresh first" at session open. Full cold-start regenerated `.claude/maps/`. 10 maps written (primary, structure, dependencies, schema, config, build, error, test, domain, events) + non-compliance report (165 lines) + 9 maps skipped as not-applicable. Surfaced **14 confirmed + 7 uncertain non-compliance items**, including the 97-dispatch-dir SHIPPED batch ready for archive.

### Thread 2 — Batch K combined deref sweep (`130b7d0` + scrml-support `0c1892f`)

User authorized "Full sweep now". **131 individual file/dir moves** in one batch (cumulative S61+S79: 207):

- 93 SHIPPED dispatch dirs → `scrml-support/archive/changes/` (flat, S61 precedent)
- 19 historical audits → NEW `scrml-support/archive/audits/`
- 8 recon docs → NEW `scrml-support/archive/recon/`
- 5 experiments → NEW `scrml-support/docs/experiments/`
- 3 deep-dives → `scrml-support/docs/deep-dives/` (location-correction)
- 2 article drafts → `scrml-support/archive/articles-skipped/`
- 1 stray `benchmarks/fullstack-react/CLAUDE.md` deleted

**KEEP-LIVE in scrmlTS:**
- `docs/changes/{predicate-gaps-deep-dive-prep, promotion-ergonomics, v0next-audit, v0next-inventory}/`
- `docs/audits/{scope-c-findings-tracker, compiler-forgotten-surface-2026-05-06, hardcoded-thresholds-2026-05-10}.md`

**Cross-refs fixed (load-bearing live docs):** pa.md (audit refs in dispatch-brief instructions) · PA-SCRML-PRIMER.md (7 refs) · master-list.md (~10 refs via bulk perl) · v0next-inventory + v0next-audit + promotion-ergonomics. Changelog historical entries left as snapshots-at-time-of-landing.

**Drive-by:** pre-commit hook caught hardcoded `cwd: "/home/bryan/..."` (note: NOT `/home/bryan-maclee/`) in `compiler/tests/unit/test-body-statement-split.test.js:294` — same class as S78 audit's hardcoded-cwd sweep but missed. Fixed inline to `cwd: process.cwd()` per S78 pattern.

### Thread 3 — Per-machine pre-commit hook installation

User authorized `git config core.hooksPath scripts/git-hooks` per pa.md S78 directive on session-open verification. Hook firing on every commit afterward (caught the test-body-split bug + verified all subsequent commits).

### Thread 4 — A5-6 Feature 1 SHIPPED (`1547e78`) — `<onTimeout name=IDENT>` + `cancelTimer("X")` builtin

User picked "PA-direct" for dispatch shape. Closes the original target of the 6-deep deferral chain that Phase A10 unblocked at S78.

**SPEC:** NEW §51.0.M.1 amendment + 2 §34 codes (E-TIMER-NAME-DUPLICATE, E-TIMER-NAME-INVALID).

**Implementation:**
- `OnTimeoutEntry.name?: string` field in symbol-table.ts
- `engine-statechild-parser.ts:scanForOnTimeoutEntries` extended (quoted + unquoted + order-independent)
- `walkValidateEngineA5Extensions` PASS 16 fires per-state-child name-seen-Set diagnostics
- `emit-engine.ts:emitEngineTimersTable` emits `name: "X"` field
- NEW exported helper `maybeLowerCancelTimerCallRef(handlerName, handlerArgs, engineArm)` consumed by emit-event-wiring.ts (delegated path) + emit-variant-guard.ts:emitArmWireFunction (non-delegable path)
- `BindingRegistry.currentArmContext` getter NEW (forward-compat for v2 expression-form lowering)
- Runtime `_scrml_engine_clear_named_timer(varName, stateName, name)` NEW; arm/clear paths switch keying to `n:NAME` suffix vs index

**v1 limitation:** call-ref form only (`onclick=cancelTimer("X")`). Expression-form (`${cancelTimer("X")}`) + function-body calls deferred to v2 (would require threading arm context through emit-expr).

**Tests:** 28 new tests / 47 expect() calls. Drive-by fixed runtime-template.js JSDoc backticks (terminated surrounding template literal).

### Thread 5 — Hardcoded-thresholds Bucket A SHIPPED (`fcb45df`)

User picked "threshold sweep, top 2 Bucket-A items".

**A.1 — `MAX_RUNS = 100`:** runtime-template.js `_scrml_meta_effect` now reads `globalThis.__scrml_max_meta_runs ?? 100` (type-guarded). Tests: 5-cycle override + 6-cycle bail. Adopters tune higher for complex derived graphs.

**A.2 — `seq > 1331` (E-CG-014):** EncodingContext gains `seqCap` field + constructor opt `__testOnly_typeEncodingSeqCap`. Plumbed through codegen/index.ts via existing `encoding` option object. Diagnostic message dynamic.

**Tests:** 11 new / 24 expect(). Regression: type-encoding + meta-effect tests 60/60.

### Thread 6 — Hardcoded-thresholds Bucket B + C SHIPPED (`5ac54de`)

User said "all go" → executed all remaining audit items (B.1 + C.1 + C.2).

**B.1 — serve-client AbortSignal timeouts:** `DEFAULT_TIMEOUTS` table + `resolveTimeouts(override)` helper. All 4 `AbortSignal.timeout(...)` sites now call `t.<key>`. Per-call override via `__testOnly_serverTimeouts` OR `globalThis.__scrml_test_server_timeouts` hook.

**C.1 — `<program idempotency-ttl=>`:** NEW `parseIdempotencyTtl` helper accepts bare millis + `Nms`/`Ns`/`Nm`/`Nh`/`Nd` units. `middlewareConfig.idempotencyTTL` field added. SPEC §19.9.6 amended.

**C.2 — `<program batch-in-list-cap=N>`:** Module-level `setBatchInListCap()` + `getBatchInListCap()` in emit-control-flow.ts. Cap value substituted into BOTH the runtime check AND the diagnostic message text. SPEC §8.10.6 amended.

**TS interface extension:** `MiddlewareConfig` gained `idempotencyStore?` (was inline-only) + `idempotencyTTL?` + `batchInListCap?`.

**Tests:** 21 new / 53 expect() calls.

**Audit doc closed:** `docs/audits/hardcoded-thresholds-2026-05-10.md` §6 — "**All 5 items shipped. Total actual cost: ~3.5 hours across S79 (vs ~4h estimate).**"

### Thread 7 — Debounce/throttle Approach B SHIPPED via agent dispatch (`3446989` + `d860e37`)

User picked "scrml-dev-pipeline agent (worktree)". scrml-dev-pipeline not staged on this machine → dispatched via `general-purpose` with the same brief shape per pa.md fallback.

**Agent dispatch:** `worktree-agent-ab656f3dcdd0f1638`. 6 WIP commits (`1bb6d47` → `5748bbf`) covering Phase 1 SPEC + Phase 2 AST/parser/typer/codegen/runtime + Phase 3 clean-cut deletion + Phase 4 tests + Phase 5 docs.

**Landed via squash-merge** (NOT cherry-pick — single PA-authored commit per S67):
- `git merge --squash --no-commit worktree-agent-...` auto-3-way-merged 7 overlap files cleanly
- 2 conflict files (PA-SCRML-PRIMER.md + master-list.md) had section-level conflicts where my S79 main edits collided with agent's same-section additions
- Conflicts resolved manually — kept agent's authoritative text + bridged cross-refs to my Batch K paths
- **Final delta: exactly 29 files matching agent's reported FILES_TOUCHED. Zero agent-side-stale-view files leaked into main.**

**SPEC:**
- NEW §6.13 "Reactivity Attributes" — canonical `<name debounced=Nms> = expr` / `<name throttled=Nms> = expr`
- §6.8 amended — `reset()` cancels pending timed writes
- §34 +3 codes: E-DEBOUNCED-WITH-DERIVED · E-DEBOUNCED-WITH-SERVER · E-REACTIVITY-ATTR-CONFLICT

**Implementation:**
- `ReactiveDeclNode.reactivity?: { debounced?: AfterDurationResult; throttled?: AfterDurationResult }`
- Reuses `parseAfterDuration` (literal + computed-form `${expr}<unit>`)
- `_emitReactivitySidecar` emits `_scrml_reactivity_register("name", kind, ms)` (literal numeric OR arrow-fn for computed)
- Runtime: `_scrml_reactive_throttled` NEW; `_scrml_reactive_debounced` rewritten (was partial pre-S79); `_scrml_reset` cancels pending timers
- LSP `lsp/handlers.js` migrated to surface canonical form

**Clean-cut deletion:**
- `reactive-debounced-decl` AST kind retired across 8 source files (types/ast.ts, ast-builder.js, type-system.ts, emit-logic.ts, emit-client.ts, route-inference.ts, component-expander.ts, usage-analyzer.ts)
- 6 existing test files cleaned of pre-v0.next assertions
- 2 probe sample fixtures migrated (`.expected.json` flipped error → clean)

**OQ closures (in-dispatch):** OQ-3 (reset-cancel) + OQ-4 (parseAfterDuration reuse) + OQ-5 (channel client-side, doc-only) + OQ-6 (validity-on-debounced-write, doc-only) + OQ-8 (throttled= parallel) + OQ-9 (computed-form).

**OQ deferrals:** OQ-1 N/A (clean cut, no migrator needed) · OQ-2 imperative `debounce-call`/`throttle-call` AST kind retirement (orthogonal surface; separate dispatch when `scrml:time` stdlib alternative solidifies) · OQ-7 server-fn cancellation when debounced calls overlap (separate deep-dive).

**Tests:** 28 new tests in `compiler/tests/unit/debounce-throttle-attribute.test.js` (parser/typer/codegen/computed-form/runtime/migrated-samples/regression).

**Gitignore cleanup (`d860e37`):** test creates runtime fixture files in `compiler/tests/unit/__fixtures__/s79-debounce-throttle/` via `compileInline()`. Added to .gitignore.

---

## S79 audit-thread outcomes

### Hardcoded-thresholds audit — ALL 5 ITEMS CLOSED

Per `docs/audits/hardcoded-thresholds-2026-05-10.md` §6. Total actual ~3.5h vs ~4h estimate.

### S78 audit doc cross-machine state

The 19 historical audits (a1b-b7..b22, a1c-roadmap, item-c-temporal, kickstarter-v0-verification-matrix, scope-c-stage-1 ×2, spec-conformance-2026-05-10, test-conformance-2026-05-10) all moved to `scrml-support/archive/audits/`. KEEP in scrmlTS: scope-c-findings-tracker (active tracking), compiler-forgotten-surface-2026-05-06 (compliant), hardcoded-thresholds-2026-05-10 (drives next-priority items + status now ALL SHIPPED).

### SPEC audit drift items closed at S79

The S78 SPEC conformance audit flagged debounce/throttle AST kinds as "the only real src-ahead-of-spec finding". **RESOLVED** at S79 via §6.13 NEW (canonical form spec'd) + clean-cut deletion of pre-v0.next `reactive-debounced-decl` AST kind (the src side now matches the spec side).

---

## S79 user-voice — no new durable directives

S79 produced no new durable methodology directives that need recording in user-voice. The session was implementation-heavy under previously-ratified design verdicts (S78 audits + S77 SCOPE + ratified deep-dive). User decisions in this session:

- "Full sweep now" (Batch K disposition) — applies S61 curation precedent
- "PA-direct" (A5-6 Feature 1 dispatch shape)
- "scrml-dev-pipeline agent (worktree)" (debounce/throttle dispatch shape)
- "threshold sweep, top 2 Bucket-A items" → "all go" (Bucket B+C scope expansion)
- "debounce throttle" (next-priority pick)
- "wrap s79"

None are durable design directives. All implementation choices.

---

## Cross-machine sync state at S79 close

- **scrmlTS:** 7 commits ahead of origin/main pre-wrap-commit (130b7d0, 1547e78, fcb45df, 5ac54de, 3446989, d860e37, +wrap). PUSHED at wrap close.
- **scrml-support:** 1 commit ahead (0c1892f Batch K archive). PUSHED at wrap close.

Per pa.md "wrap" §7 default (push included unless user says "wrap, no push") + machine-switch / multi-day-session push-discipline. Both repos at 0/0 origin after push.

---

## Next priority — menu (S79 close — carry-forward)

Awaiting user direction at S80 open.

1. **Phantom-code middleware family** (E-MW-001/002/005/006, ~1 dispatch covers 4 codes). The whole middleware-attribute validation pass is missing per S78 audit + S79 audit-doc references. Big structural gap. Tier 3 dispatch candidate.

2. **Bootstrap L3 host-compiler library-mode meta-block strip bug.** Real compiler bug; `compiler/dist/self-host/ast.js:31` corrupted by host-compiler emitting `try { ^{...} } catch {}` residue. Test marked describe.skip at `compiler/tests/integration/self-compilation.test.js:513`. Fix is in library-mode meta-block strip pass.

3. **Phase A10 deferred items** (preserved from S78):
   - Payload-binding scope injection (`<Error msg>` introducing `msg` as local in body sub-scope) — body content resolves top-level + engine cells today; payload bindings surface as B3 unresolveds
   - Type-system body-walk re-enablement (gated on emission-boundary structural-element filter)

4. **A5-7 tests + samples** (~12-18h) — sample coverage across the now-complete A5 surface (A5-1 through A5-6 + S79 A5-6 Feature 1 all shipped). End-to-end fixture coverage for the engine temporal surface.

5. **Multi-token threshold deep-read** (~1-2h) — per S78 audit caveat. Per-file deep-read of `codegen/emit-*.ts` would surface 2-4 more Bucket C items in middleware-config defaults (rate-limit, CSRF, CORS Max-Age) that grep can't catch (`5 * 1000`-shape arithmetic).

6. **Debounce/throttle imperative keyword-call retirement** (OQ-2, deferred from S79 dispatch). Retire `debounce(fn, ms)` / `throttle(fn, ms)` AST kinds in favor of `scrml:time.debounce` / `scrml:time.throttle` stdlib imports. ~3-5h. Should solidify the stdlib alternative first.

7. **A6-6 optional API alignment** — LSP/CG API design dive (TBD).

8. **A9 Ext 5 follow-ups** (D1/D3/D5 from S76):
   - D1 export-synth modifier propagation
   - D3 pure-fn-call detection in classifier (over-emits keys)
   - D5 Redis backend inlining

9. **Insight 28 OQ-bridge-5** — compile-time WARNING when bridged validator on schema-column field — defer to compiler-diagnostics audit pass.

10. **Insight 28 OQ-bridge-2** — passive (re-debate trigger on ≥3 adopter friction reports).

11. **W-LEAK-010 follow-up** (per memory-leak deep-dive refresh §7.2):
    - Step 2: `<program idempotency-store=>` background sweeper (CG/runtime dispatch)
    - Step 3: LC pass implementation (Stage 7.6, SCOPE-AND-DECOMPOSITION dispatch)
    - Hold for v0.3.0+ unless W-LEAK-010 spec-amendment is fast-tracked

12. **Versioning-discipline discussion** (deferred from S78) — patch-version-as-lifecycle-stage thread. Adjacent question: should `0.2.0` be re-scoped tighter? Hold for a session of its own.

13. **SPEC-INDEX.md regeneration** — per S64 audit + S78 amendments: SPEC-INDEX.md is stale post-D4 + A5-1 + S79 additions. Generated via `bash scripts/update-spec-index.sh`. Mechanical.

**Articles thread (5 in-flight drafts at scrml-support/voice/articles/):** Per pa.md Rule 1, no PA-volunteered marketing work; await user-raised threads.

---

## Open questions to surface immediately at S80 open

1. **Push state — CLEAN at S79 close (wrap push completed both repos).** scrmlTS 0/0 origin; scrml-support 0/0 origin. S80 PA starts from clean state.

2. **Hook installed on THIS machine** — `git config core.hooksPath scripts/git-hooks` ran at S79 open. The OTHER machine still needs the same setup if not already done (per pa.md "Per-machine setup — pre-commit hook installation (S78)").

3. **All hardcoded-thresholds audit items CLOSED.** Audit doc §6 final state. No carry-forward.

4. **A5-6 Feature 1 v1 limitation** — only call-ref form supported (`onclick=cancelTimer("X")`). Expression-form (`${cancelTimer("X")}`) + function-body calls defer to v2 (would require threading arm context through emit-expr). Documented in primer §7.1 + SPEC §51.0.M.1.

5. **Debounce/throttle imperative `debounce-call` / `throttle-call` AST kinds STILL LIVE.** Per OQ-2 deferral: orthogonal surface, separate dispatch when `scrml:time` stdlib alternative solidifies. Both runtime helpers (`_scrml_debounce` / `_scrml_throttle`) still in runtime-template.js.

6. **OQ-7 server-fn cancellation when debounced calls overlap** — queued as separate deep-dive per deep-dive §7. Not blocking.

7. **Test count divergence** — pre-commit subset (~506 files / 10,476 pass) vs full suite (~530 files / ~11,063+ pass projected). S80 PA should run `bun run test` once at open to record the full-suite baseline if a regression check is needed.

8. **Worktree branches retained from S79 (forensic per S67):** `worktree-agent-ab656f3dcdd0f1638` (debounce/throttle 6 WIP commits). Plus pre-S79 retained branches from S78. Cleanup not priority.

9. **scrml-dev-pipeline agent not staged on THIS machine.** Per pa.md fallback, debounce/throttle dispatched via `general-purpose` instead. Worked fine. Future dispatches: either request master to stage `scrml-dev-pipeline` (and switch machines after) OR continue using `general-purpose` for compiler-source work. Track: which machine has which agents staged.

10. **3 legacy master inbox carry-overs** (S78 carry-forward, still safe-to-ignore unless sweep requested):
    - `2026-04-22-scrmlTS-to-master-insight-25-multi-meta.md` (UNREAD legacy)
    - `2026-05-08-S72-scrmlTS-to-master-needs-push-SUPERSEDED.md`
    - `2026-05-08-S71-scrmlTS-to-master-stage-scrml-dev-pipeline.md`

11. **Project-mapper refresh state** — full cold-start regenerated at S79 open. Maps reflect post-Phase-A10 surface but NOT the S79 ships (debounce/throttle / A5-6 / thresholds). At S80 open, run incremental refresh against the S79 touched files OR full cold-start if Phase A10/A5-6/§6.13 surface needs to be inventoried.

---

## Things S80 PA must NOT screw up (S77/S78 standing list)

S77-close + S78-close standing lists (items 1-217+) carry forward verbatim. **S79 additions:**

- **DON'T treat `@debounced(N) name = expr` as valid syntax.** Clean-cut deletion landed at S79. The form parses as an error now. Any test fixture or doc citing this form is post-S79 stale.
- **DON'T assume scrml-dev-pipeline is staged.** Check `~/.claude/agents/` at session-open; fall back to `general-purpose` per pa.md if absent.
- **DON'T forget that the S78 audit's "src-ahead-of-spec" debounce/throttle finding is now CLOSED at S79.** Audit doc references to this are historical-record.
- **Test fixture scratchpads** at `compiler/tests/unit/__fixtures__/` are gitignored per S79 `d860e37`. They regenerate on every test run; appearance in `git status` post-test is normal.

---

## Tags

#session-79 #close #4-ships #batch-k-deref #a5-6-feature-1-shipped #hardcoded-thresholds-all-5-shipped #debounce-throttle-approach-b-shipped #agent-dispatch-via-general-purpose #worktree-as-scratch-file-delta-landed #88-new-unit-tests #0-regressions #pushed
