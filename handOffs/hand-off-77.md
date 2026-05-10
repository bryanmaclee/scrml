# scrmlTS — Session 77 (CLOSE — A5 computed-delay family CLOSED · A5-6 Feature 2 SHIPPED · memory-leak deep-dive REFRESHED · 7 SHIPs + 2 chore + 1 SPEC docs commits · +82 tests · 0 regressions)

**Date opened:** 2026-05-10
**Date closed:** 2026-05-10 (single-day session, ~heavy throughput)
**Previous:** `handOffs/hand-off-76.md` (S76 close — body-split min-viable v0.2.0 SHIPPED · A8 family CLOSED · C15 follow-up family CLOSED · 2 Insight-28 OQs RESOLVED · 4 SHIPs + 8 chore/record · +116 tests · 0 regressions)
**This file:** rotates to `handOffs/hand-off-77.md` at S78 open
**Tests at open (S76 close baseline):** 10,879 pass / 60 skip / 1 todo / 0 fail (508 files)
**Tests at S77 close:** **10,961 pass / 64 skip / 1 todo / 6 fail** (513 files; 6 fails ALL environmental on this machine — 3 self-host artifacts not built; 3 test-bind A6-5 with hard-coded `/home/bryan-maclee/` cwd. Net delta from open baseline: **+82 pass**.)

---

## S77 open — caught up

**Cross-machine sync (session-start protocol):** scrmlTS 0/0 origin (clean). scrml-support 0/0 origin (5 untracked voice/articles drafts + tools/ — voice-author work, no conflict). Both repos clean working tree.

**S76 wrap state inherited:** large 4-SHIP session combining one major background-agent dispatch (A9 Ext 5 ~50h budget) with parallel PA-direct closures of two long-standing follow-up families. Six items from S75's "open questions" menu were closed in S76: A9 Ext 5 (body-split min-viable v0.2.0 — closes A9 family entirely with Ext 4 from S72), §C15.11/§C15.12, §C15.13 (closes C15 follow-up family), A8 A6-5 (closes A8 family A6-1+A6-2+A6-3+A6-4+A6-5), Insight-28 OQ-bridge-3, OQ-bridge-4 (Insight-28 standing OQs reduced 5→1; only bridge-5 remains).

**Inbox state:** scrmlTS `handOffs/incoming/` empty (only `read/` archive). No pending action items.

**Master inbox carry-overs (3 legacy/superseded — safe-to-ignore unless sweep requested):**
- `2026-04-22-scrmlTS-to-master-insight-25-multi-meta.md` (UNREAD legacy, S30s era)
- `2026-05-08-S72-scrmlTS-to-master-needs-push-SUPERSEDED.md` (renamed at master-push retirement)
- `2026-05-08-S71-scrmlTS-to-master-stage-scrml-dev-pipeline.md` (UNREAD; pipeline-substitution clean across 30+ dispatches in S73-S76)

**User-voice state:** last contentful session entries are at S72 (2026-05-08). S73-S76 produced no new user-voice entries; this is consistent with those sessions being primarily implementation/SHIP work without new durable user statements. The S77 PA should append normally if any durable user statements arise.

**Worktree branches retained:** 10 (9 from S75 + 1 new from S76). Forensic per S67; not cleanup priority.

---

## Next priority — menu (substantial S76-residual items)

Carrying the S76-close menu forward (S77 selection awaits user direction):

1. **A5 family follow-on (S67-ratified engine extensions, deferred A5-5/A5-6/A5-7):**
   - A5-5 computed-delay impl (~1.5-2.5h smallest)
   - A5-6 Item G B-shakeable timer extensions (~5-10h optional)
   - A5-7 tests + samples (~12-18h)

2. **A9 Ext 5 follow-ups (3 in-scope-but-thin, deferred from S76 dispatch):**
   - D1 export-synth modifier propagation — `export function foo().idempotent()` synthesized shadow node doesn't carry `idempotentModifier` flag through; modifier text preserved in raw export emission so no production breakage today; surface if friction.
   - D3 pure-fn-call detection in classifier — over-emits keys (sound but wasteful); needs threading `functionIndex` through analyzer.
   - D5 Redis backend inlining — stubbed in `runtime/idempotency.js`; SQL backend covers default-resolution; add when adopter explicitly uses `idempotency-store="redis"`.

3. **A6-6 optional API alignment** — LSP/CG API design dive (TBD).

4. **Codegen tightening — consecutive-let in `~{}` body** (filed S76 via A6-5 integration testing). `~{}` test-block body codegen joins tokens with single spaces but doesn't insert separators between consecutive `let` statements (`let a = f(); let b = g();` emits as one line, fails to parse as JS). Same root cause as test-bind RHS string-quote-strip artifact (raw token-join in test-block body codegen). Documented inline in `compiler/tests/integration/test-bind-end-to-end.test.js` docblock. ~30min-1h fast fix once located in `emit-test.ts` token-joiner.

5. **Insight 28 OQ-bridge-5** — compile-time WARNING when bridged validator on schema-column field — defer to compiler-diagnostics audit pass (per S76 hand-off).

6. **Insight 28 OQ-bridge-2** — passive (re-debate trigger on ≥3 adopter friction reports).

**Articles thread (5 in-flight drafts at scrml-support/voice/articles/):** Per pa.md Rule 1, no PA-volunteered marketing work; await user-raised threads.

---

## Background dispatches (both LANDED)

**A5-4 + A5-5 bundled** — LANDED at `7b5744d` (no push — user authorized "Commit, no push" pending review).
- Worktree branch retained for forensic per S67: `worktree-agent-a07c10f3c25603c26` at `a6cfb30` (7 incremental commits)
- 18 files / +2480 LOC / 73 new tests / 0 SCOPE-§3 deviations

**Memory-leak deep-dive refresh** — LANDED on scrml-support at `1f71ef3` (no push — user authorized "Commit, no push").
- New dated successor: `docs/deep-dives/memory-leak-detection-2026-05-10.md`
- Original frontmatter flipped `status: active` → `superseded`, pointer added
- Headline: 1 NEW leak surface (W-LEAK-010 idempotency unbounded growth); 2 categories shifted to structural prevention (timers via `<timer>`, WS via `<channel>`); LC pass slot moved Stage 7.5 → Stage 7.6 (BP took 7.5)

---

## Open questions to surface immediately at S78 open

1. **Push state — both repos have unpushed commits.** scrmlTS at `7b5744d` (3 commits ahead — codegen-tightening + SCOPE doc + A5-4+5 SHIP). scrml-support at `1f71ef3` (1 commit ahead — deep-dive refresh). User authorized "Commit, no push" on both; push is at PA's discretion at wrap or on user request.

2. **A5-4 + A5-5 SHIP open questions (Q1-Q4 from agent report):**
   - **Q1 (defer):** SPEC editorial pass clarifying chained-rearm-skips-computed semantics. Spec is silent on what happens with computed delays in chains; small one-line addition could clarify. Defer as a SPEC editorial pass.
   - **Q2 (file as A5-5b):** Follow-on dispatch for legacy `<machine>` body-parser fix to preserve `${...}` text. ~1-2h chore-tier estimated. The legacy `<machine>` computed-delay codegen surface IS in place; only the BS body-parser missing. Engine `<onTimeout>` form (S67-recommended) works end-to-end without this fix.
   - **Q3 (out-of-scope, optional):** C13 tree-shake test robustness — agent scrubbed comments mentioning `_scrml_engine_direct_set` from the 'machine' chunk so the existing C13 tree-shake test continues to pass. Could regex-anchor the assertion to function declarations rather than free-text mentions. Out of A5-4/A5-5 scope.
   - **Q4 (PA-confirmed correct):** Initial-arm timing deviation from SCOPE Phase 1e — agent split `emitEngineInitialArmsForFile` into a separate helper called AFTER `emitReactiveWiring` because integration testing surfaced an ordering bug (computed-form `${@var}<unit>` would read undefined at module-init under original design). Bug-driven correction, not scope-creep — PA confirms the deviation is principled.

3. **Memory-leak deep-dive next steps (per refresh §7.2):**
   - Step 1 (lowest-cost-fastest): W-LEAK-010 SPEC §34 catalog row + cross-ref from §19.9.6 (docs-only PR; surfaces eviction gap to spec readers)
   - Step 2: `<program idempotency-store=>` background sweeper (CG/runtime dispatch) — structural fix that eliminates W-LEAK-010
   - Step 3: LC pass implementation (Stage 7.6, SCOPE-AND-DECOMPOSITION dispatch)
   - Recommendation: hold for v0.3.0+ unless W-LEAK-010 spec-amendment is fast-tracked

---

## Things S78 PA must NOT screw up (S70-S76 cumulative)

S76-close standing list (items 113-211) carries forward verbatim. **S77 NEW additions:**

212. **A5-4 + A5-5 SHIPPED at `7b5744d` (S77).** Engine `<onTimeout>` codegen + computed-delay relaxation across both temporal surfaces. 18 files / +2480 LOC / 73 new tests / 0 regressions. Legacy `<machine>` body-parser `${...}` preservation is the deferred follow-on (filed as Q2 A5-5b chore-tier ~1-2h); engine `<onTimeout>` works end-to-end. Computed-form rules opt out of JSON-encoded chained re-arm (single-step works, multi-step computed→computed chains require user-driven writes — documented inline + tests). Worktree branch retained: `worktree-agent-a07c10f3c25603c26` at `a6cfb30`.

213. **Codegen-tightening fix (consecutive-`let` in `~{}` body) shipped S77 at `8379b92`.** Test-body collector now splits on depth-0 `;` PUNCT and on depth-0 statement-keyword tokens beginning on a new source line. Both KEYWORD and IDENT token kinds accepted. Brace depth fully respected. Closes S76 A6-5 follow-up. +11 unit tests.

214. **Memory-leak deep-dive refreshed S77 at scrml-support `1f71ef3`.** New dated successor `memory-leak-detection-2026-05-10.md`; original frontmatter flipped to superseded. **One NEW leak surface confirmed:** A9 Ext 5 idempotency-key shadow tables grow unbounded (24h TTL but **lazy-eviction-only**; documented inline at `compiler/runtime/idempotency.js:74-77`). **W-LEAK-010 recommended (info-level).** Two leak categories shifted to structural prevention (timers via `<timer>`, WS via `<channel>`). LC pass placement moves Stage 7.5 → Stage 7.6 (BP took 7.5). 8 other NEW post-2026-03-28 surfaces audited and verified clean. Recommendation: hold for v0.3.0+ unless W-LEAK-010 spec-amendment is fast-tracked.

215. **6 environmental fails on this machine carried forward.** 3 self-host artifacts not built (Bootstrap L3 timeout; tokenizer parity needs `compiler/self-host/dist/tab.js` which doesn't exist on this machine); 3 test-bind A6-5 integration tests with hard-coded `/home/bryan-maclee/` cwd (works on the other machine where username matches; fails here where username is `bryan`). Pre-existing, NOT caused by S77 work.

216. **String-token quote-preservation across all test-block parsers shipped S77 at `6075a81`.** New `tokenToSourceText(tok)` helper in `parseTestBody` re-wraps STRING tokens (JSON.stringify for plain, backticks for `isTemplate`) before joining tokens back into source-text expressions. Applied to all 4 collectors (collectBody, collectAssertTokens, parseTestBindDecl RHS, non-assert test body). Same root-cause family as the consecutive-`let` fix. +5 unit tests covering RHS / asserts / body / before-block / backtick template.

217. **A5-5b SHIPPED S77 at `b22c6d3`** — legacy `<machine>` body-parser `${...}` preservation. Phase 0 finding revised the SCOPE doc's hypothesis: BS preserves `${...}` correctly in logic-child `.raw`; the bug was a spurious `\n` in ast-builder.js's `rulesRaw` concat (line 9086) fragmenting multi-child rules. **One-line fix.** Both temporal surfaces (engine `<onTimeout>` + legacy `<machine>` arrow rules) now end-to-end with bit-identical runtime semantics. **A5 computed-delay family fully CLOSED.** Computed-form rules opt out of JSON-encoded chained auto-rearm per §51.12.4 S77 amendment. +3 unit tests in computed-delay.test.js §A5-5.5b.

---

## File modification inventory (S77)

| Commit | Repo | Files | Topic |
|---|---|---|---|
| `8379b92` | scrmlTS | compiler/src/ast-builder.js (test-body collector), compiler/tests/unit/test-body-statement-split.test.js (NEW, 11 tests), hand-off.md (S77 open), handOffs/hand-off-76.md (S76 rotation) | Codegen tightening: multi-statement test-block bodies |
| `4f66976` | scrmlTS | docs/changes/phase-a7-step-a5-4-5-ontimeout-codegen-and-computed-delay/SCOPE-AND-DECOMPOSITION.md (NEW, 277 LOC) | A5-4 + A5-5 dispatch SCOPE doc |
| `7b5744d` | scrmlTS | 18 files: parse-after-duration.ts (NEW, 138 LOC), emit-engine.ts (+289), runtime-template.js (+125), emit-machines.ts (+97), type-system.ts (+72), 7 smaller orchestration touches, 3 NEW test files (73 tests), PA-SCRML-PRIMER.md (+6), IMPLEMENTATION-ROADMAP.md (+4), progress.md (NEW, 151 LOC) | A5-4 + A5-5 SHIP — `<onTimeout>` codegen + computed-delay across both temporal surfaces |
| `1f71ef3` | scrml-support | docs/deep-dives/memory-leak-detection-2026-05-10.md (NEW, ~565 LOC), docs/deep-dives/memory-leak-detection.md (frontmatter flip + supersedes banner) | Memory-leak deep-dive refresh |
| `7d8de4a` | scrmlTS | compiler/SPEC.md (W-LEAK-010 row in §34 summary + full catalog + cross-ref from §19.9.6; §51.12.4 chained-rearm-skips-computed amendment) | Tier-1 SPEC items 1+2 |
| `6075a81` | scrmlTS | compiler/src/ast-builder.js (tokenToSourceText helper + 4 collector applications), compiler/tests/unit/test-body-statement-split.test.js (+5 tests §6.5), docs/changes/phase-a7-step-a5-5b-machine-body-dollar-brace-preservation/SCOPE-AND-DECOMPOSITION.md (NEW) | Tier-1 SPEC items 3+4: A5-5b SCOPE doc + STRING-token quote-preservation fix |
| `b22c6d3` | scrmlTS | compiler/src/ast-builder.js (1-line rulesRaw concat fix at line 9086), compiler/tests/unit/computed-delay.test.js (+3 tests §A5-5.5b), docs/PA-SCRML-PRIMER.md + IMPLEMENTATION-ROADMAP.md (limitation note → SHIPPED marker) | A5-5b SHIP — legacy `<machine>` body-parser `${...}` preservation |

---

## S77 commit chain (in order)

scrmlTS:
1. `8379b92` **feat(s77): SHIP — codegen tightening, multi-statement test-block bodies** (pushed)
2. `4f66976` chore(s77): SCOPE doc for A5-4 + A5-5 bundled dispatch (pushed)
3. `7b5744d` **feat(a5-4-5): SHIP — `<onTimeout>` codegen + computed-delay across both temporal surfaces** (push pending)
4. `7d8de4a` docs(spec): W-LEAK-010 catalog row + §51.12.4 chained-rearm-skips-computed note (push pending)
5. `6075a81` **feat(s77): SHIP — string-literal preservation in test-block parsers + A5-5b SCOPE doc** (push pending)
6. `b22c6d3` **feat(a5-5b): SHIP — legacy `<machine>` body-parser `${...}` preservation** (push pending)

scrml-support:
1. `1f71ef3` docs(s77): refresh memory-leak-detection deep-dive (supersedes 2026-03-28) (push pending)

---

## A5 computed-delay family — CLOSED

| Item | Topic | Status |
|---|---|---|
| A5-4 | `<onTimeout>` codegen — engine state-child timer-config tables, arm/clear wiring, initial-arm | SHIPPED S77 (`7b5744d`) |
| A5-5 (engine) | computed-delay form on `<onTimeout>` — msExpr arrow-fn in timer-config table | SHIPPED S77 (`7b5744d`) |
| A5-5 (legacy machine helper layer) | parseAfterDuration + parseMachineRules afterExpr branch + emitDurationLiteral + emit-logic.ts inline arm | SHIPPED S77 (`7b5744d`) |
| **A5-5b** | legacy `<machine>` body-parser `${...}` preservation (BS/ast-builder concat fix) | **SHIPPED S77 (`b22c6d3`)** |
| §51.12.4 amendment | chained-rearm-skips-computed semantics documented | SHIPPED S77 (`7d8de4a`) |

A5 family is structurally complete from `<onTimeout>` + computed-delay perspective. **A5-6 (Item G B-shakeable timer extensions) and A5-7 (tests + samples)** remain on the menu as optional follow-ons.

---

## Push state

scrmlTS: **4 ahead of origin** (commits 8379b92 + 4f66976 are PUSHED; 7b5744d + 7d8de4a + 6075a81 + b22c6d3 push-pending per user "Commit, no push" auth).
scrml-support: **1 ahead of origin** (1f71ef3 push-pending per user "Commit, no push" auth).

---

## Tags

#session-77 #in-progress #6-ships #a5-computed-delay-family-closed #codegen-tightening-shipped #a5-4-a5-5-shipped #a5-5b-shipped #memory-leak-deep-dive-refreshed #w-leak-010-spec-row-landed #chained-rearm-spec-amended #string-token-quote-preservation-shipped #5-pushes-pending
