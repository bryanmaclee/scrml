# scrmlTS — Session 76 (CLOSE — body-split min-viable v0.2.0 SHIPPED · A8 family CLOSED · C15 follow-up family CLOSED · 2 Insight-28 OQs RESOLVED · 4 SHIPs + 8 chore/record commits · +116 tests · 0 regressions)

**Date opened:** 2026-05-09
**Date closed:** 2026-05-10 (~1.5-day session — cross-machine pickup + 1 long background dispatch + parallel PA-direct work)
**Previous:** `handOffs/hand-off-75.md` (S75 close — A1c FULLY CLOSED · A8 A6-1+A6-2+A6-3+A6-4 ✅ · Insight 28 ratified · A9-Ext-5 SURVEY ready · 14 ships · +228 tests · 0 regressions)
**This file:** rotates to `handOffs/hand-off-76.md` at S77 open
**Tests at S76 close:** **10,879 pass / 60 skip / 1 todo / 0 fail** (508 files, 36,689 expect calls; via `bun run test` ~13s)

---

## TL;DR — what S76 did

**Massive 4-SHIP session combining one major background-agent dispatch (A9 Ext 5 ~50h budget, single-agent D0-D8 protocol) with parallel PA-direct closures of two long-standing follow-up families.** Six items from the S75 hand-off's "Open questions" menu CLOSED in this single session: A9 Ext 5 (body-split min-viable v0.2.0), §C15.11/§C15.12, §C15.13, A8 A6-5, OQ-bridge-3, OQ-bridge-4.

| Cluster | What landed | Tests |
|---|---|---|
| **A9 Ext 5 (body-split min-viable v0.2.0)** | `feat(a9-ext5): SHIP` at `41b0764`. 18 files (+2,540 LOC). Single-agent D0-D8 dispatch. NEW Stage 5.5 (Monotonicity Classifier) + `idempotency-store=` `<program>` attr + `.idempotent()` modifier + 5 §34 catalog rows (3 E- + 2 D-) + ~80 LOC SPEC normative + ~62 LOC PIPELINE.md prose. All 8 OQ resolutions per S76 PA SCOPE doc honored. 3 in-scope-but-thin deferrals (D1/D3/D5). | +81 |
| **§C15.11/§C15.12** | `feat(c15.11-12): SHIP` at `2867beb`. One-line wrapper-vs-inner `_scope` fallback in `collectCrossFileEngineMounts` (root cause: SYM attaches `_scope` to inner ast; codegen wrapper-shaped fileAST). C15 suite 37/37 passing / 0 skip. | +3 (2 unskips + 1 ride-along) |
| **§C15.13** | `feat(c15.13): SHIP` at `22b6806`. Two-pass `buildExportRegistry`: pass 1 stamps + carries internal `_reExportSource`/`_localName`; pass 2 inherits source kind/category/isComponent to fixed-point with cycle-bounded iteration cap; pass 3 strips internal fields. +8 unit tests + §C15.13 unskipped. p3-follow isComponent budget 8→11. | +9 |
| **A8 A6-5 (closes A8 family)** | `feat(a6-5): SHIP` at `ff1df97`. +26 LOC api.js (testMode opt + `.test.js` writeOutput); NEW integration test (~280 LOC, 5 tests) spawning real `bun test` on emitted JS. **A8 family A6-1+A6-2+A6-3+A6-4+A6-5 fully complete.** Bonus codegen bug surfaced: consecutive-`let`-in-`~{}`-body emits without separators (filed as separate codegen tightening dispatch). | +5 |
| **OQ-bridge-3** | `docs(insight-28): mark OQ-bridge-3 RESOLVED` (scrml-support `027be7b`). §53.2.1 grammar EBNF audit: `custom` is NOT a §53 inline predicate (would fire E-CONTRACT-002 per §53.6.3). | 0 (audit only) |
| **OQ-bridge-4** | `docs(insight-28): mark OQ-bridge-4 RESOLVED` (scrml-support `72d2a75`). `validate.scrml` audit + wider stdlib sweep: zero `server { }` decorative-wrap drift (only the historical comment at `stdlib/crypto/index.scrml:140` recording the prior safeCompare fix). | 0 (audit only) |

**Cross-machine pickup at S76 open (loss-free):** This machine was 26 commits behind origin after S75 wrapped on the other machine. Local untracked `handOffs/hand-off-74.md` was byte-identical to origin's tracked version (md5 `bb1bd5…`) — stale leftover from this machine's pre-S75 partial rotate. Removed cleanly. Deleted local `hand-off.md` restored from origin via `git restore`. Fast-forward pull clean: `72d691f` → `149c1ab` (75 files, +13,659/-736).

**Cross-machine sync at S76 close (push at wrap step 7):** Both repos clean working tree at wrap-trigger. scrmlTS 12 ahead of origin (will be 13 after this wrap commit); scrml-support 2 ahead. Push authorized as part of "wrap and push" user instruction.

---

## State as of S76 close

| Field | Value |
|---|---|
| scrmlTS HEAD pre-wrap | `4af68e5` (chore record OQ-bridge-3 closure) — 12 ahead of origin |
| scrmlTS HEAD post-wrap | will be wrap commit (13 ahead → 0 after push) |
| scrml-support HEAD | `027be7b` (docs OQ-bridge-3 RESOLVED) — 2 ahead of origin |
| Tests at close | **10,879 pass / 60 skip / 1 todo / 0 fail** (508 files, 36,689 expect calls) |
| S75-baseline-on-other-machine 3 self-host parity fails | NOT present on this machine (environmental — same pattern noted at S75 close) |
| Inbox (this repo) | empty (`handOffs/incoming/` clean — only `dist` gitignored + `read/` archive) |
| Inbox (master) | empty (`/home/bryan-maclee/scrmlMaster/handOffs/incoming/` clean — only `read/`) |
| Outbox-pending | none |
| Active dispatches | none (A9 Ext 5 agent landed at D8) |
| Worktree branches retained | 9 from S75 + 1 new from S76 (`worktree-agent-aa1100371152a25fb` for A9 Ext 5) — forensic per S67 |

**Cumulative tests since S75 baseline:** S75 close 10,763 (other machine) → S76 open 10,790 baseline (this machine + C15.13 SHIP) → 10,790 (no test change for OQ-bridge-4 audit) → 10,793 (C15.11/12 SHIP +3) → 10,874 (A9 Ext 5 SHIP +81) → **10,879 (A6-5 SHIP +5).** Net S76 delta: **+116 net pass / -8 skip / -3 fail (env-only).**

---

## S76 commit chain (pre-wrap, in order)

scrmlTS:

1. `f6a63fd` chore(s76): open hand-off + A9 Ext 5 SCOPE-AND-DECOMPOSITION
2. `e7264b0` chore(s76): record OQ-bridge-4 closure in S76 hand-off
3. `22b6806` **feat(c15.13): SHIP** — MOD re-export resolution in buildExportRegistry
4. `0c550ec` chore(s76): record C15.13 closure in hand-off
5. `2867beb` **feat(c15.11-12): SHIP** — wrapper-vs-inner _scope fallback in collectCrossFileEngineMounts
6. `41b0764` **feat(a9-ext5): SHIP** — S5 replay safety / idempotency-key storage
7. `e08d6d7` chore(s76): record A9 Ext 5 SHIP + C15.11/12 SHIP in hand-off
8. `ff1df97` **feat(a6-5): SHIP** — testMode opt in compileScrml + .test.js writeOutput + end-to-end integration test
9. `e78ebc4` chore(s76): record A6-5 SHIP — A8 family fully complete
10. `4af68e5` chore(s76): record OQ-bridge-3 closure in S76 hand-off

(plus this wrap commit pending)

scrml-support:

1. `72d2a75` docs(insight-28): mark OQ-bridge-4 RESOLVED — validate.scrml audit clean
2. `027be7b` docs(insight-28): mark OQ-bridge-3 RESOLVED — §53.2.1 audit clean

---

## Open questions to surface immediately at S77 open

1. **Cross-machine pickup IF S77 opens on the other machine.** MANDATORY: `git fetch origin && git pull --rebase origin main` on BOTH repos. Verify scrmlTS at this wrap commit + scrml-support at `027be7b`. Re-run `bun run test`; expect ~10,879 / 60 / 1 / 0 (the 3 self-host parity fails on the other machine are environmental — may differ).

2. **Next priority — pick ONE (substantial S75-menu items remaining; biggest closures already done in S76):**
   - **A5 family follow-on (S67-ratified engine extensions, deferred A5-5/A5-6/A5-7):** A5-5 computed-delay impl (~1.5-2.5h smallest); A5-6 Item G B-shakeable timer extensions (~5-10h optional); A5-7 tests + samples (~12-18h).
   - **A9 Ext 5 follow-ups (3 in-scope-but-thin, deferred from S76 dispatch):**
     - D1 export-synth modifier propagation — `export function foo().idempotent()` synthesized shadow node doesn't carry `idempotentModifier` flag through; modifier text preserved in raw export emission so no production breakage today; surface if friction.
     - D3 pure-fn-call detection in classifier — over-emits keys (sound but wasteful); needs threading `functionIndex` through analyzer.
     - D5 Redis backend inlining — stubbed in `runtime/idempotency.js`; SQL backend covers default-resolution; add when adopter explicitly uses `idempotency-store="redis"`.
   - **A6-6 optional API alignment** — LSP/CG API design dive (TBD).
   - **Codegen tightening — consecutive-let in `~{}` body** (filed S76 via A6-5 integration testing). `~{}` test-block body codegen joins tokens with single spaces but doesn't insert separators between consecutive `let` statements (`let a = f(); let b = g();` emits as one line, fails to parse as JS). Same root cause as test-bind RHS string-quote-strip artifact (raw token-join in test-block body codegen). Documented inline in `compiler/tests/integration/test-bind-end-to-end.test.js` docblock. ~30min-1h fast fix once located in `emit-test.ts` token-joiner.
   - **Insight 28 OQ-bridge-5** — compile-time WARNING when bridged validator on schema-column field — defer to compiler-diagnostics audit pass (per S76 hand-off).
   - **Insight 28 OQ-bridge-2** — passive (re-debate trigger on ≥3 adopter friction reports).

3. **Articles thread (5 in-flight drafts at scrml-support/voice/articles/).** Per pa.md Rule 1, no PA-volunteered marketing work; await user-raised threads.

4. **Master inbox carry-overs (still 3 legacy/superseded — safe-to-ignore unless user wants sweep):**
   - `2026-04-22-scrmlTS-to-master-insight-25-multi-meta.md` (UNREAD legacy, S30s era)
   - `2026-05-08-S72-scrmlTS-to-master-needs-push-SUPERSEDED.md` (renamed at master-push retirement)
   - `2026-05-08-S71-scrmlTS-to-master-stage-scrml-dev-pipeline.md` (UNREAD; pipeline-substitution clean across 25+ dispatches in S73+S74+S75+S76)

5. **10 worktree branches retained** (9 from S75 + 1 new S76 `worktree-agent-aa1100371152a25fb`). Forensic per S67 protocol; not cleanup priority.

---

## Things S77 PA must NOT screw up (S70-S76 cumulative)

S75-close standing list (items 113-198) carries forward verbatim. **S76 NEW additions:**

199. **A9 Ext 5 SCOPE doc OQ resolutions are LOAD-BEARING for any v0.2.0 codegen work touching idempotency.** All 8 resolutions encoded at `docs/changes/phase-a9-ext5-idempotency-storage/SCOPE-AND-DECOMPOSITION.md` §B. Spec section anchor is **§19.9.6, NOT §47**. Attribute name is **`idempotency-store=`**. Shadow table uses INTEGER timestamps (cross-driver portability) with 24h TTL + lazy eviction. `D-CPS-MONOTONE` is verbose-only. Channel server-fns are SKIPPED (no key, no rejection). Default-resolution precedence is db-driver-shadow-table → scrml:redis → none. New Stage 5.5 placement (sibling of Stage 7.5 BP). §40.2 sub-anchor mis-numbering as §39.2.x followed (cleanup is separate doc-only commit).

200. **A9 Ext 5 dispatch deviations** (documented at landing): D5 server-side helper inliner pattern (NOT runtime-chunks.ts client-side) — idempotency helpers use Bun.SQL server-side; client never calls; followed `_scrml_structural_eq` post-hoc inliner precedent. D6 placement at api.js Stage 5.5 close (NOT type-system.ts) — diagnostics need GLOBAL resolution (closest-ancestor `<program db=>` walk + module-graph `scrml:redis` import detection). Both deviations are STRUCTURAL only — no spec-semantics divergence.

201. **A9 Ext 5 in-scope-but-thin deferrals (3 items, surface if friction):**
    - D1 export-synth modifier propagation — `export function foo().idempotent()` synthesized shadow node from rawStr (ast-builder.js ~line 5723) doesn't carry `idempotentModifier` flag through; modifier text preserved in raw export emission so no production breakage today; downstream walkers seeing the synthetic node won't see the flag.
    - D3 pure-fn-call detection — classifier treats unrecognized bare-expr shapes (e.g., function calls) as non-monotone (conservative default per §19.9.6 paragraph 1); recognizing `fn`-kind callees as monotone (rule e) requires threading `functionIndex` through analyzer; over-emits keys (sound but wasteful).
    - D5 Redis backend — stubbed in `compiler/runtime/idempotency.js`; not yet inlined into emit-server.ts; SQL backend covers default-resolution target.

202. **§C15.11/§C15.12 fix is a one-line wrapper-vs-inner `_scope` fallback** in `collectCrossFileEngineMounts` (emit-engine.ts ~line 1080-1091). Mirrors existing `nodes` fallback at ~line 1184. **DO NOT** revert this fallback chain — it makes the production-pipeline call work at all (pre-fix, `importBindings` was always `undefined`).

203. **§C15.13 fix is a two-pass + cycle-bounded `buildExportRegistry`** in module-resolver.js. Pass 1 stamps with internal `_reExportSource`/`_localName`; pass 2 inherits to fixed-point with `MAX_ITERATIONS = graph.size + 2` (cyclic re-exports stay as `kind: "re-export"`); pass 3 strips internal fields. **`re-export-all` (`export * from './x'`) is NOT enumerated** — those entries don't carry per-name shape; future B-step can extend pass 2 to enumerate `*` against source's full export set if cross-file mount validation through star-re-exports becomes necessary.

204. **A6-5 integration test SPAWNS `bun test <generated-file>` as child process.** This is the missing layer the unit-tests (A6-2/A6-3/A6-4) don't exercise. Don't replace the spawn pattern with text-pattern-matching — that's what the unit tests already do, and the consecutive-`let` bug shipped past 26 unit tests.

205. **Consecutive-`let`-in-`~{}`-body codegen bug** (filed via A6-5 integration testing). `let a = f(); let b = g();` emits as `let a = f ( ) let b = g ( )` (one line, no `;`/newline) and fails to parse as JS at bun:test load time. Same root cause as test-bind RHS string-quote-strip artifact (raw token-join in test-block body codegen). A6-5 §5 works around by using direct `assert <expr>` form. **DO NOT** retrofit the integration test to use multi-`let` bodies until the codegen tightening dispatch lands.

206. **Insight 28 OQ-bridge-3 RESOLVED clean S76.** §53.2.1 grammar EBNF allows `named-shape = identifier` against §53.6.1's 7-shape registry (email/url/uuid/phone/date/time/color); `custom` is NOT in that registry — would fire E-CONTRACT-002 per §53.6.3 if used as a §53 inline predicate. The `custom(fn)` surface is valid only as state-validator (§55), stdlib library builder, and §55.9 ValidationError tag.

207. **Insight 28 OQ-bridge-4 RESOLVED clean S76.** `validate.scrml` audit + wider stdlib `grep -rn "server {" stdlib/`: zero `server { }` decorative-wrap drift; only the historical documentary comment at `stdlib/crypto/index.scrml:140` recording the prior safeCompare fix.

208. **Insight 28 standing OQs reduced 5 → 1.** bridge-1 ratify-closed S75; bridge-2 passive trigger; bridge-3 RESOLVED S76; bridge-4 RESOLVED S76; **bridge-5 ONLY remaining standing OQ** (compile-time WARNING when bridged validator on schema-column field — deferred to compiler-diagnostics audit pass).

209. **A8 family fully CLOSED.** A6-1 (SPEC, S74) + A6-2 (parser, S75) + A6-3 (typer, S75) + A6-4 (codegen, S75) + A6-5 (integration + compileScrml plumbing, S76). **A6-6 (optional LSP/CG API design dive) still TBD** — not blocking the family closure.

210. **A9 body-split min-viable v0.2.0 fully CLOSED.** Ext 4 S4-wiring (S72) + Ext 5 S5-replay-safety (S76). Per S72 user direction: "if this is ratified, it needs to be woven into all the other V0.2 work going on." Status: woven. v0.2.0 body-split surface is structurally complete.

211. **C15 follow-up family fully CLOSED.** §C15.11/§C15.12 (S76) + §C15.13 (S76) + §C15.14 (S75) + the original C15 SHIP (S74). All 4 sub-tests of `c15-cross-file-engine-mount.test.js` now passing; entire S75-hand-off C15 follow-up dispatch list complete.

---

## File modification inventory (S76)

**scrmlTS commits — 4 SHIPs + 8 chore/record (this wrap commit will be 13th):**

| Commit | Files | Topic |
|---|---|---|
| `f6a63fd` | hand-off.md (NEW S76 OPEN), docs/changes/phase-a9-ext5-idempotency-storage/SCOPE-AND-DECOMPOSITION.md (NEW) | S76 open + A9 Ext 5 dispatch authorization |
| `e7264b0` | hand-off.md | OQ-bridge-4 closure record |
| `22b6806` | compiler/src/module-resolver.js (+56), tests/unit/module-resolver.test.js (+152, 8 new tests), tests/unit/c15-cross-file-engine-mount.test.js (1 unskip), tests/unit/p3-follow-no-isComponent-routing.test.js (budget bump 8→11) | C15.13 SHIP — MOD re-export resolution |
| `0c550ec` | hand-off.md | C15.13 closure record |
| `2867beb` | compiler/src/codegen/emit-engine.ts (+13, 1-line fallback + comment), tests/unit/c15-cross-file-engine-mount.test.js (2 unskips) | C15.11/12 SHIP — wrapper-vs-inner _scope fallback |
| `41b0764` | 18 files (+2,540 LOC across SPEC, PIPELINE, runtime/idempotency.js NEW, src/idempotency-store-resolver.ts NEW, src/monotonicity-analyzer.ts NEW, api.js, ast-builder.js, codegen/emit-functions.ts, codegen/emit-server.ts, codegen/usage-analyzer.ts, route-inference.ts, tests/self-host/ast.test.js, 5 NEW test files, progress.md NEW) | A9 Ext 5 SHIP — S5 replay safety |
| `e08d6d7` | hand-off.md | A9 Ext 5 + C15.11/12 SHIP record |
| `ff1df97` | compiler/src/api.js (+26), tests/integration/test-bind-end-to-end.test.js (NEW, 5 tests, ~280 LOC) | A6-5 SHIP — testMode opt + integration test |
| `e78ebc4` | hand-off.md | A6-5 SHIP record |
| `4af68e5` | hand-off.md | OQ-bridge-3 closure record |

**scrml-support commits (2):**

| Commit | Files | Topic |
|---|---|---|
| `72d2a75` | design-insights.md (1 line OQ-bridge-4 status update) | OQ-bridge-4 RESOLVED docs |
| `027be7b` | design-insights.md (1 line OQ-bridge-3 status update) | OQ-bridge-3 RESOLVED docs |

---

## Track-by-track summary

### A9 body-split min-viable v0.2.0 — CLOSED entirely (Ext 4 + Ext 5)

| Step | Topic | Δ tests | Session |
|---|---|---|---|
| Ext 4 (S4 wiring) | Always-`!`-wrap CPS stubs + caller-context propagation + W-CPS-NEEDS-FAILABLE + §19.9.5 SPEC + 4 §34 catalog rows | +16 | S72 |
| **Ext 5 (S5 replay safety)** | Stage 5.5 monotonicity classifier + `idempotency-store=` `<program>` attr + `.idempotent()` modifier + §19.9.6 + §19.9.7 + §39.2.6 + 5 §34 catalog rows + Bun.SQL shadow-table backend + dedup middleware in both CSRF paths | +81 | **S76** |

A9 body-split is structurally complete from spec perspective. Ext 1 (multi-batch CPS, ~38h), Ext 2 (loop-aware splitting, ~34h), Ext 3 (conditional-tier emission, ~22h), and cross-function body-split (~200-400h) all DEFERRED beyond v0.2.0.

### A8 test-bind family — CLOSED entirely (A6-1 through A6-5)

| Step | Topic | Δ tests | Session |
|---|---|---|---|
| A6-1 | SPEC §19.12.6/.7/.8 + §47.5 + §34 E-TEST-006 | 0 | S74 |
| A6-2 | parser — `test-bind-decl` AST node + ~{}-body parser extension + context-violation diagnostics | +25 | S75 |
| A6-3 | typer — SYM PASS 18 walker + LHS resolution + RHS shape discrimination + bindKind annotation | +23 | S75 |
| A6-4 | codegen — block-local dispatch table + server-fn call-site guards + 0-byte production cost (bit-identical-verified) | +26 | S75 |
| **A6-5** | testMode opt in compileScrml + `.test.js` writeOutput + integration test spawning real `bun test` on emitted JS | +5 | **S76** |

A6-6 (optional LSP/CG API design dive) is TBD and NOT blocking the family closure.

### C15 follow-up family — CLOSED entirely

| Item | Topic | Session | Status |
|---|---|---|---|
| §C15.11 | full pipeline: importer's compiled client.js has the marker | **S76** | UNBLOCKED ✅ |
| §C15.12 | multiple importers share the same exporter substrate | **S76** | UNBLOCKED ✅ |
| §C15.13 | re-export of imported engine: no duplicate substrate | **S76** | SHIPPED ✅ |
| §C15.14 | regression-guard: B14 PASS 10.B's E-ENGINE-MOUNT-NOT-ENGINE still fires | S75 | UNBLOCKED ✅ |

C15 unit-test suite now 37/37 passing / 0 skip.

### Insight 28 follow-up OQs — 4-of-5 CLOSED

| OQ | Topic | Status |
|---|---|---|
| bridge-1 | Docs section in `validate.scrml` | RATIFY-CLOSED S75 |
| bridge-2 | Friction-data-trigger threshold for re-debate | passive (≥3 adopter friction reports → re-fire) |
| bridge-3 | §53.2.1 grammar audit for `custom` | **RESOLVED clean S76** |
| bridge-4 | `safeCompare`-shape audit on `validate.scrml` | **RESOLVED clean S76** |
| bridge-5 | compile-time WARNING when bridged validator on schema-column field | DEFERRED to compiler-diagnostics audit pass |

---

## Master inbox state at close

`/home/bryan-maclee/scrmlMaster/handOffs/incoming/`:
- `2026-04-22-scrmlTS-to-master-insight-25-multi-meta.md` — UNREAD legacy from S30s era
- `2026-05-08-S72-scrmlTS-to-master-needs-push-SUPERSEDED.md` — RENAMED at master-push-protocol-retirement (S72)
- `2026-05-08-S71-scrmlTS-to-master-stage-scrml-dev-pipeline.md` — UNREAD (pipeline-substitution clean across 30+ dispatches in S73+S74+S75+S76)

No active pending master notices from S76. The "needs:push" master-coordination pattern is RETIRED per S72 user directive (PA pushes directly when authorized).

---

## Push state

scrmlTS: 12 ahead of origin at wrap-trigger; this wrap commit lands 13 ahead; **wrap-push pending** (will execute as wrap step 7 per "wrap and push" user instruction).

scrml-support: 2 ahead of origin (`72d2a75` OQ-bridge-4 + `027be7b` OQ-bridge-3); **wrap-push pending** as part of step 7.

---

## Pattern observations + lessons learned (S76)

**S67 worktree-as-scratch / file-delta protocol validated at scale:**
- A9 Ext 5 dispatch ran ~50h budget on agent's branch with PA reviewing + landing via `git checkout <agent-branch> -- <files>` from main + single PA-authored SHIP commit
- Filtered 7 agent-side-stale-view files (main moved past the agent's base while it worked) without merge friction
- Branch retained for forensic
- Compared to cherry-pick pattern: ~2-3 minute landing cost per dispatch vs ~10-15 min

**Background-agent + foreground-PA-direct hybrid productivity:**
- While A9 Ext 5 ran in background (~50h budget end-to-end), PA closed 3 substantial items in parallel: C15.13 (~45 min PA-direct), C15.11/12 (~30 min PA-direct), OQ-bridge-4 audit (~10 min)
- ZERO collisions at agent-landing time (file-disjoint discipline held)
- Pattern works when agent's FILES_TOUCHED list is well-bounded + PA chooses non-overlapping work
- The 7 agent-side-stale-view files that needed filtering at landing were exactly the files PA touched parallel to the agent — confirms the protocol's filter step is the load-bearing piece

**Integration testing surfaces real bugs the unit tests miss:**
- A6-5 integration test (spawning real bun:test on emitted code) caught the consecutive-`let`-no-separator bug that 26 prior unit tests in test-bind-codegen.test.js never surfaced because they only pattern-matched test JS as text
- Documenting the find inline in the integration test docblock is the right durable trail
- Operational rule for future codegen integration tests: **execute the emitted JS, don't just text-match it**

**Spec-Rule-4 enforcement at OQ audits:**
- Both OQ-bridge-3 and OQ-bridge-4 closed by direct spec-text inspection rather than corpus heuristics
- The methodology that prevents Rule-4 drift on spec-derivative claims also closes audits efficiently — read the spec, count what's there, report
- ~10-30 min per OQ when the audit scope is narrow + well-defined

**Cross-machine pickup loss-free pattern:**
- Audit (md5sum + file-content comparison) before any destructive operation when the work-tree state is divergent at session-open
- The S43 "MAKE NO MISTAKES" forensic protocol is the authoritative reference; this session's loss-free recovery validates it again

**Friction surfaced (recurring + new):**
- CWD drift in PA bash sessions persistent (carried from S75; not blocking but recurring)
- Pre-commit hook output is verbose enough to crowd context window (each pre-commit run dumps ~3-5k tokens of warning/test output; S76 ran the hook 9 times via 9 PA commits)
- Background-agent task notification delivers full result inline in subsequent turn (interrupts user-flow; PA had to interleave the C15.11/12 commit auth + landing the A9 SHIP cleanly)

---

## Tags

#session-76 #close #body-split-min-viable-v0-2-0-shipped #a9-ext5-shipped #a8-family-closed #c15-followup-family-closed #insight-28-bridge-3-resolved #insight-28-bridge-4-resolved #4-ships #+116-tests #zero-regressions #cross-machine-pickup-loss-free #s67-worktree-as-scratch-validated-at-scale #background-foreground-hybrid-productivity #integration-testing-surfaces-real-bugs #spec-rule-4-enforcement-at-audits #consecutive-let-codegen-bug-filed
