# scrmlTS — Session 91 (OPEN)

**Date:** 2026-05-14
**Previous:** `handOffs/hand-off-90.md` (S90 CLOSE — 17-commit landmark; HEAD `ff9be0e`)

**Session-start state at S91 open:**
- scrmlTS: HEAD `ff9be0e` (S90 wrap commit landed + pushed) · 0 ahead / 0 behind origin/main
- scrml-support: HEAD `7a3fbea` (S89 user-voice append) · 0 ahead / 0 behind origin/main
- Working tree: clean (only main checkout; no agent worktrees)
- Inbox: empty (`handOffs/incoming/` no unread `.md`)
- Hook config: configuration B (rich, `.git/hooks/` carries `pre-commit` + `post-commit` + `pre-push`) — leave as-is per S88 amendment
- Tests at HEAD `ff9be0e` (S90 close baseline): **12,275 pass / 117 skip / 1 todo / 0 fail / 617 files** (full `bun test`)

**Map currency:** `primary.map.md` line 3 stamps `commit: 71305fe` (S89 close). HEAD is `ff9be0e` — 18+ S90 substantive commits + S90 wrap missing from map. **Map refresh queued (Q-OPEN-9 carried from S90).**

---

## Session-open hygiene done

1. ✅ Read `pa.md` in full (S90 + S88 + S87 + S83 + S78 + S67 protocol layers all loaded)
2. ✅ Read `docs/PA-SCRML-PRIMER.md` in full (~856 lines incl. B11-B22 specifics, three-zone B21, promotion ergonomics §13.8)
3. ✅ Read `master-list.md` §0 dashboard + §0.6 M-7C-D-12 wave close summary
4. ✅ Read S90 close hand-off in full (Phase 1 → Phase 12; commit ledger; state tables; Q-OPEN-1..9; insights)
5. ✅ Read user-voice S89 trailing entries (last 3 verbatim directives)
6. ✅ Cross-machine sync verified: scrmlTS + scrml-support both 0/0 vs origin
7. ✅ Worktree state verified: only main checkout
8. ✅ Inbox state verified: empty
9. ✅ Hook config verified: configuration B
10. ✅ Hand-off rotated to `handOffs/hand-off-90.md`

**CWD-routing precaution applied at session-open.** Initial Bash batch included a `cd /home/bryan-maclee/scrmlMaster/scrml-support && git status...` chain that leaked CWD to scrml-support; PA re-ran `cd /home/bryan-maclee/scrmlMaster/scrmlTS && pwd` immediately afterward per `feedback_agent_isolation_cwd_routing.md` (S90 memory rule). **No agent dispatches occurred while CWD was leaked.** First-session validation of the S90 rule: it caught me.

---

## Open questions to surface immediately (carried from S90 close)

### Q-OPEN-1 — A-3.5 SPEC catalog rows + pipeline wiring (5-8h)
The 5 NEW diagnostics landed S90 (W-CG-UNDEFINED-INTERPOLATION + I-AUTH-REDIRECT-UNRESOLVED + E-AUTH-GRAPH-002 + W-AUTH-RUNTIME-FALLBACK + E-CLOSURE-002 + W-AUTH-PAGE-INFERRED) need §34 SPEC catalog rows. Plus `runAuthGraph` needs wiring into `compiler/src/api.js` post-RI invocation (currently uncalled by the driver; consumers are unit tests only). Plus the worked-example fixture from SPEC §40.9.9 should replay end-to-end. This is the LAST sub-phase of A-3.

### Q-OPEN-2 — A-2.7 outer fixpoint operator (8-14h)
Closes A-2 wave. Components 3/4/5 all complete (✅ S90). The outer closure operator chases the five-component union until fixpoint; emits E-CLOSURE-001 on iteration-cap overflow per SPEC §40.9.1.

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
HEAD is `ff9be0e`; `primary.map.md` line 3 still stamps commit `71305fe` (S89 close). All S90 landings (17 substantive commits + wrap docs) + 5 NEW diagnostics + 4 NEW reachability components + AuthGraph module are NOT reflected in current maps. Recommend full cold-start `/map` refresh at S91 open (similar to S90 open hygiene pattern).

### Q-OPEN-S91-NEW-1 — S90 user-voice append GAP
S90 closed without appending its own user-voice section. User-voice last entry is `## Session 89 — 2026-05-13` (the S90-open backfill). **S90 had at least one substantive verbatim user-voice directive that should land:**
- **OQ-A3-A override (Rule-2 fidelity grounds):** *"the idea that user defined state has full interpolation but first class compiler supported state doesn't is confusing, counter intuitive, and hints that the language is still in a 'toy' status."* (Triggered the agent-recommendation-(b) → user-override-(d) shift; methodology-grade signal per S90 hand-off Phase 10 + "Insights surfaced" notes.)
- Additional S90 verbatims may exist; PA should grep transcripts for OQ dispositions + "continue A-track momentum" authorizations.

Surface at next user interaction; append once user confirms the verbatim slate.

---

## Things S91 PA must NOT screw up (carried + extended)

- **DO NOT** revisit "TS parity" as a load-bearing scrml property. TS impl is scaffold; self-host is from-scratch rewrite. Per `feedback_self_host_is_from_scratch.md`.
- **DO NOT** treat `null` or `undefined` as canonical scrml tokens in ANY context. They do not exist in scrml. `""` / `0` / `false` / `[]` / `{}` ARE defined values. Per `feedback_null_does_not_exist_in_scrml.md`.
- **DO NOT** clean up agent worktree BEFORE landing its content into main. Per `feedback_land_before_cleanup.md`.
- **DO** check agent's working tree for uncommitted Step-N work when agent crashes pre-commit. Per `feedback_agent_crash_partial_recovery.md`.
- **DO** trust Rule-4 reconnaissance.
- **DO** set `isolation: "worktree"` on EVERY dev-agent / scrml-writer / codegen Agent() call. Per S88 addendum to pa.md.
- **DO** `cd /home/bryan-maclee/scrmlMaster/scrmlTS && pwd` before any Agent dispatch IF a sibling-repo `cd` happened earlier in the same shell. Per S90 memory rule (this PA already triggered the precaution once during S91 open — rule holds).
- **DO** PA-merge orchestrator collisions PA-side when sibling parallel dispatches both extend a shared file at different functions. S90 precedent: A-2.4 + A-2.6 reachability-solver.ts; A-3.2 + A-3.4 auth-graph.ts.
- **DO** anticipate test-fixture cascade when adding new pipeline diagnostics. S90 precedent: A-3.2's E-AUTH-GRAPH-002 broke A-3.4's tests because their fixtures used `<auth role='admin'>` without declaring `UserRole` enum. Fix shape: replace `expect(errors).toHaveLength(N)` with `expect(errors.filter(e => e.code === "SPECIFIC-CODE")).toHaveLength(N)`.
- **DO** surface agent recommendations as deliberation points when they invoke "scope tractable" framings on first-class-language-shape questions. Rule-2 fidelity beats agent-scope-narrowing. S90 OQ-A3-A precedent.

### Rules permanently load-bearing
- Rule 1 — no marketing/article/tweet work unless user brings it up
- Rule 2 — full-production-language fidelity
- Rule 3 — right answer beats easy answer 99.999% of the time
- Rule 4 — spec is normative; derived planning docs are NOT
- S86 ratifications — idiomatic-examples styling rule + corpus-ouroboros warning + BS-layer over SPEC retreat
- S87 memory rules — bash-cleanup dry-run + file-delta base SHA check
- S88 memory rules — file-delta-vs-cherry-pick + stated-intent-vs-corpus migration
- S89 memory rules — land-before-cleanup + agent-crash-partial-recovery + null-does-not-exist-in-scrml + self-host-is-from-scratch
- S90 memory rule — agent-isolation-cwd-routing

---

---

## S91 mid-session activity log (refreshed mid-A-4.3 flight)

### Commits landed — 21 in scrmlTS + 1 in scrml-support

**Chronological PA-authored commit ledger:**

| # | Commit | Category | Description |
|---|---|---|---|
| 1 | scrmlTS `199940e` | hygiene | s91-open — hand-off rotation + FULL_COLD_START map refresh (11 maps) |
| 2 | scrmlTS `399fc81` | pa.md | S90 CWD-routing memory rule fold-in + F4 step 1 sharpening |
| 3 | scrml-support `8d13012` | user-voice | S90 OQ-A3-A override verbatim backfill (methodology rule: surface narrowing recommendations on first-class compiler-state grounds) |
| 4 | scrmlTS `bf2b098` | **A-3.5** | A-3 §40 AuthGraph wave **FULLY CLOSED** — 7 §34 catalog rows + 5 §40.9.11 rows + api.js Stage 7.55 AG wire-in + §40.9.9 13-test integration suite + normalizeFileAST helper |
| 5 | scrmlTS `1d1ceef` | SPEC | §40.9.9 case-fix — 6 sites `role="admin"` → `role="Admin"` (closes A-3.5 deferred #1) |
| 6 | scrmlTS `fbc8a39` | mid-bookkeeping | master-list S91 addendum + hand-off mid-session refresh (first pass) |
| 7 | scrmlTS `9d79f45` | brief stage | A-2.8 emit-reachability canonical determinism brief |
| 8 | scrmlTS `3689153` | scoping | 03-contact-book auth-redirect SCOPING deep-dive landing (882 lines) |
| 9 | scrmlTS `59279e7` | **A-2.7** | A-2 wave **FULLY CLOSED** — outer fixed-point operator + E-CLOSURE-001 fire-site + 29 tests |
| 10 | scrmlTS `470b128` | scoping | A-4 per-route artifact splitter SCOPING deep-dive landing (695 lines, 7 sub-phases) |
| 11 | scrmlTS `527bae8` | **A-2.8** | A-2 wave polish — canonical JSON serialization for `--emit-reachability` + 21 determinism tests + F4 leak documented |
| 12 | scrmlTS `d7145b2` | brief stage | A-4.2 initial_chunk emission brief |
| 13 | scrmlTS `d6e32ed` | brief stage | A-4.3 tier-1 idle-prefetch brief |
| 14 | scrmlTS `5abcf20` | **03-contact-book** | v0.2.x latent bug CLOSED — `scrml generate auth` CLI generator + W-AUTH-LOGIN-MISSING two-tier severity + stdlib login template + 22 tests (cherry-pick recovery from base-mismatch; SPEC.md §34 6+1 rows preserved) |
| 15 | scrmlTS `b66c5da` | brief stage | A-4.4 tier-2 hover-prefetch brief |
| 16 | scrmlTS `ea6d9d3` | **A-4.1** | A-4 wave OPEN — codegen orchestrator slot + per-(EP, role, tier) iteration scaffold + opt-in `--emit-per-route` flag + 13 tests (cherry-pick recovery; api.js conflict resolved) |
| 17 | scrmlTS `5e392cf` | brief stage | A-4.5 tier-N on-demand dispatch hook brief |
| 18 | scrmlTS `d7773a4` | **A-4.2** | initial_chunk JS payload + atom-emitter extraction from emit-client.ts + §40.9.9 worked-example integration replay green + 37 tests + atom-emitter.ts NEW |
| 19 | scrmlTS `bcbb7ab` | brief stage | A-4.6 §47 content-addressing brief |
| 20 | scrmlTS `77a24a8` | brief stage | A-4.7 per-route HTML + role-bootstrap + runtime helpers (A-4 wave closer; closes A-4.2 forward-looking gap) |
| 21 | scrmlTS (this commit) | hand-off | mid-session refresh #2 |

### Major waves CLOSED this session

| Wave | Status | Detail |
|---|---|---|
| **A-3 §40 AuthGraph** | ✅ FULLY CLOSED | A-3.1..A-3.4 (S90) + A-3.5 (`bf2b098`) + §40.9.9 case-fix (`1d1ceef`). End-to-end functional in api.js Stage 7.55 with §40.9.9 13-test worked-example replay. |
| **A-2 Reachability Solver** | ✅ FULLY CLOSED | Components 1-5 (S89-S90) + A-2.7 outer fixpoint (`59279e7`) + A-2.8 canonical determinism (`527bae8`). Soundness-complete + bit-identical JSON output. |
| **03-contact-book v0.2.x latent bug** | ✅ FULLY CLOSED | S86 D2 LATENT family #3 — `scrml generate auth` CLI + W-AUTH-LOGIN-MISSING two-tier severity + adopter-owned login template + example/e2e cleanup. |

### A-4 wave progress (the major v0.3.0 cut-path investment)

| Sub-phase | Status | Commit / Brief |
|---|---|---|
| A-4 SCOPING | ✅ LANDED | `470b128` (695 lines, 7 sub-phases, 62-110h aggregate, Shape B ratified, 7 OQs ratified) |
| A-4.1 — orchestrator slot + opt-in flag | ✅ LANDED | `ea6d9d3` (~410 LOC route-splitter.ts NEW + 13 tests) |
| A-4.2 — initial_chunk payload + atom-emitter extraction | ✅ LANDED | `d7773a4` (atom-emitter.ts NEW 414 LOC + 37 tests; §40.9.9 replay green) |
| A-4.3 — tier-1 idle-prefetch | 🟡 **IN FLIGHT** | Agent Q (10-18h walltime) |
| A-4.4 — tier-2 hover-prefetch | 📋 Brief staged `b66c5da` | Plan: fire AFTER A-4.3 lands |
| A-4.5 — tier-N on-demand dispatch | 📋 Brief staged `5e392cf` | Plan: fire AFTER A-4.3 lands (parallel with A-4.4 + A-4.6) |
| A-4.6 — §47 content-addressing + FNV-1a chunk hashes | 📋 Brief staged `bcbb7ab` | Plan: fire AFTER A-4.3 lands (parallel with A-4.4 + A-4.5) |
| A-4.7 — per-route HTML + role-bootstrap + A-4.2-gap closure (`_scrml_chunk_mount` + `_scrml_vendor_require`) + W-CG-CHUNK-* lints | 📋 Brief staged `77a24a8` | Plan: fire AFTER A-4.4 + A-4.6 land (HTML needs A-4.4's data-scrml-prefetch + A-4.6's real hashes). When A-4.7 lands, **A-4 wave FULLY CLOSED + v0.3.0 critical path substantively complete**. |

### Q-OPEN dispositions at S91-mid-refresh

| Q | Status | Notes |
|---|---|---|
| Q-OPEN-1 (A-3.5) | ✅ CLOSED `bf2b098` | — |
| Q-OPEN-2 (A-2.7 outer fixpoint) | ✅ CLOSED `59279e7` | — |
| Q-OPEN-3 (A-2.8 + A-2.9 polish) | ✅ A-2.8 CLOSED `527bae8` · A-2.9 (perf + memory characterization) still pending; lower priority |
| Q-OPEN-4 (A-4 per-route splitter) | 🟢 UNBLOCKED · IN PROGRESS | SCOPING `470b128` + A-4.1 `ea6d9d3` + A-4.2 `d7773a4` landed; A-4.3 in flight; A-4.4/4.5/4.6/4.7 briefs staged |
| Q-OPEN-5 (Wave 4.A A+R adopter-content) | ⏸️ Rule 1 deferred | — |
| Q-OPEN-6 (paired migration packets re-grep) | ⏸️ unblocked but deferred low-value | — |
| Q-OPEN-7 (pa.md S90 memory fold-in) | ✅ CLOSED `399fc81` | — |
| Q-OPEN-8 (default=null audit-doc closure) | ✅ CLOSED as no-edit-needed | — |
| Q-OPEN-9 (`/map` refresh) | ✅ CLOSED `199940e` | — |
| Q-OPEN-S91-NEW-1 (S90 user-voice append) | ✅ CLOSED `8d13012` | — |
| Q-OPEN-NEW (SPEC §40.9.9 case-fix) | ✅ CLOSED `1d1ceef` | — |
| Q-OPEN-NEW (03-contact-book auth-redirect) | ✅ CLOSED `5abcf20` (SCOPING `3689153` then fix landing) | — |
| Q-OPEN-NEW (A-4.2 forward-looking gap: `_scrml_chunk_mount` + `_scrml_vendor_require` runtime helpers) | ⏸️ Tracked for A-4.7 dispatch | Brief at `docs/changes/a-4-7-per-route-html-augmentation/BRIEF.md` includes runtime helper additions in Sub-task 1 |

### In-flight at S91-mid-refresh

- **A-4.3 tier-1 idle-prefetch** — agent Q (`ab32eb087d35bd925`); 10-18h walltime; builds on A-4.2's atom-emitters.

### Plan registered for post-A-4.3 (R task)

When A-4.3 (Q) returns + lands: **fire A-4.4 + A-4.5 + A-4.6 in PARALLEL via single message with 3 Agent calls**.

File-disjoint validation:
- All three are additive on route-splitter.ts / runtime-template.js / runtime-chunks.ts (different functions / different markers).
- PA-merge orchestrator-collision pattern documented + validated 4x this session (A-3.2+A-3.4, A-2.4+A-2.6, A-3.5+L base-mismatch, A-4.1 cherry-pick).
- Cherry-pick auto-merges additive changes per `feedback_file_delta_vs_cherry_pick.md`.

A-4.7 dispatch held until A-4.4 + A-4.6 land (needs their outputs).

### CWD-routing precedent count this session

**Four trap-and-catches** validating the S91 pa.md fold-in:
1. Session-open Bash batch leaked CWD to scrml-support (caught next batch via relative-path Read failure)
2. User-voice S90 append CWD-leak (caught immediately; reset)
3. A-3.5 file-delta initially landed in worktree before reset (caught via empty staged-diff + `git status` "On branch worktree-...")
4. A-4.2 file-delta gate — task notification dropped CWD to worktree (caught via `git -C` "No such file or directory" error)

### Cherry-pick recovery precedents this session (file-delta-vs-cherry-pick rule)

**Two saves** validating `feedback_file_delta_vs_cherry_pick.md`:
1. **L (03-contact-book)** at `5abcf20` — agent base `ff9be0e` predated main's A-3.5 catalog rows. Direct file-delta would have clobbered the 6 A-3.5 §34 rows. Cherry-pick preserved all 7 rows (6 from A-3.5 + 1 from L's W-AUTH-LOGIN-MISSING). TEMP-commit dance with `git reset --soft HEAD~1` rolled the intermediate into a single PA-authored final commit with pre-commit gate clean.
2. **M (A-4.1)** at `ea6d9d3` — agent base predated A-3.5 wave. Cherry-pick auto-merged additive changes on api.js (both A-3.5 authGraph imports/returns + A-4.1 chunks imports/returns preserved); PIPELINE.md auto-merged cleanly (different sub-sections). Same TEMP-commit pattern + soft-reset bundle.

### F4 leak precedent (one occurrence, recovered)

- **L agent Sub-task A** wrote auth-graph.ts + types/auth-graph.ts changes to MAIN's working tree directly (in addition to its worktree branch). PA cleaned via `git checkout HEAD --`. Agent's commit chain on its own branch was correct; the leak was from a path-discipline failure on the first edit. Subsequent Sub-tasks A.2-B did NOT leak. Documented in A-2.8 commit message body for next-session F4 audit.

### Test count trajectory

- S91 open baseline (HEAD `ff9be0e`, S90 close): 12,275 pass / 117 skip / 1 todo / 0 fail (full `bun test`)
- Post-A-2.7 (pre-commit subset): 11,533 → 11,562 (+29)
- Post-A-2.8 (pre-commit subset): 11,575 → 11,596 (+21)
- Post-A-3.5 (pre-commit subset): 11,533 → 11,546 (+13)
- Post-L 03-contact-book: 11,533 → 11,543 (+10; plus 12 generator tests outside pre-commit subset)
- Post-A-4.1: 11,533 → 11,546 (+13)
- Post-A-4.2 (full pre-commit gate): 11,619 → 11,656 (+37)

Cumulative test additions S91: ~+123 across pre-commit subset (full-suite count to verify at next push).

Pre-commit gate clean on EVERY commit. Zero `--no-verify` on substantive code commits (one procedural `--no-verify` on cherry-pick TEMP commit was rolled back into staging + bundled into clean final commit; documented).

### Push state at S91-mid-refresh

scrmlTS: **21 commits ahead** of origin (`199940e..77a24a8`).
scrml-support: **1 commit ahead** (`8d13012`).
**Push deferred to wrap per session-open authorization.**

### Forward-looking gap tracked

A-4.2's atom-emitter output references `_scrml_chunk_mount(id, tag)` and `_scrml_vendor_require(unit)` runtime helpers that DO NOT YET exist in SCRML_RUNTIME. **A-4.7 brief includes adding them in Sub-task 1.** Until A-4.7 lands, the chunks are structurally correct + deterministic (§40.9.7 + §40.9.8 contracts satisfied) but cannot ACTIVATE in a running browser (ReferenceError on the missing helpers).

### Routing-helper fix tracked

A-4.1's `routeSegmentFromEntryPointId` uses `::#page::` markers that don't match real-pipeline entry-point IDs (`<file>#program` / `<file>#page@<route>` / `<file>#page-<N>`). Currently chunk filenames fall into a whole-id-sanitized fallback. **A-4.7 brief Sub-task 3 fixes this**; non-blocking for A-4.2 closure (chunks Map + manifest still consistent; tests pass).

---

## S91 CLOSE — final state (post-A-4.7 landing)

### Tests at HEAD `b28f493`

**12,517 pass / 117 skip / 1 todo / 0 fail / 629 files** (full `bun test`). **Cumulative S90→S91 delta: +242 pass / +12 files / 0 fail / 0 regressions** across 30 PA-authored commits.

### Major waves CLOSED end-to-end this session

| Wave | Status | Detail |
|---|---|---|
| **A-2 Reachability Solver** | ✅ FULLY CLOSED | Components 1-5 (S89-S90) + A-2.7 outer fixed-point (`59279e7`) + A-2.8 canonical determinism (`527bae8`). Soundness-complete + bit-identical JSON output per §40.9.8. |
| **A-3 §40 AuthGraph** | ✅ FULLY CLOSED | A-3.1..A-3.4 (S90) + A-3.5 wire-in (`bf2b098`) + §40.9.9 case-fix (`1d1ceef`). End-to-end functional in api.js Stage 7.55. |
| **03-contact-book v0.2.x latent bug** | ✅ FULLY CLOSED | `scrml generate auth` CLI generator (`5abcf20`) + W-AUTH-LOGIN-MISSING two-tier severity + stdlib login template + adopter example/e2e cleanup. |
| **A-4 Per-Route Artifact Splitter** | ✅ FULLY CLOSED | A-4.1..A-4.7 inclusive. Adopter chunks **ACTIVATE in actual browsers** post-A-4.7 (A-4.2 forward-looking runtime-helper gap closed). v0.3.0 critical path through A-2 + A-3 + A-4 **substantively complete**. |

### S91 commit ledger (30 PA-authored scrmlTS commits + 1 scrml-support)

```
199940e docs(s91-open): hand-off rotation + FULL_COLD_START map refresh
399fc81 docs(pa.md s91): fold S90 CWD-routing memory rule + sharpen F4 step 1
[scrml-support 8d13012] user-voice(s90): OQ-A3-A override
bf2b098 A-3.5: SPEC §34/§40.9.11 catalog rows + AuthGraph pipeline wiring + §40.9.9 replay
1d1ceef spec(§40.9.9 + 5 prose sites): role="admin" → role="Admin"
fbc8a39 docs(s91-mid-refresh-1): master-list S91 addendum + hand-off mid-refresh
9d79f45 docs(s91): stage A-2.8 dispatch brief
3689153 docs(s91): land 03-contact-book auth-redirect SCOPING (882 lines)
59279e7 A-2.7: outer fixed-point operator + E-CLOSURE-001 fire-site
470b128 docs(s91): land A-4 per-route artifact splitter SCOPING (695 lines, 7 sub-phases)
527bae8 A-2.8: emit-reachability canonical determinism
d7145b2 docs(s91): stage A-4.2 brief
d6e32ed docs(s91): stage A-4.3 brief
5abcf20 03-contact-book-auth: E (scrml generate auth CLI + template) + A (W-AUTH-LOGIN-MISSING)
b66c5da docs(s91): stage A-4.4 brief
ea6d9d3 A-4.1: codegen orchestrator slot + per-(EP, role, tier) iteration scaffold
5e392cf docs(s91): stage A-4.5 brief
d7773a4 A-4.2: initial_chunk JS payload + atom-emitter extraction — §40.9.9 replay green
bcbb7ab docs(s91): stage A-4.6 brief
77a24a8 docs(s91): stage A-4.7 brief (wave closer)
d29357f docs(s91-mid-refresh-2): hand-off comprehensive state update
7cac10c A-4.3: tier-1 idle-prefetch — _scrml_prefetch_tier1 + tree-shakeable
e3cfabc A-4.5: tier-N on-demand dispatch hook
d089974 A-4.6: §47 content-addressing — FNV-1a base36 chunk hashes + URL-style chunks.json
07e9795 A-4.4: tier-2 hover-prefetch — cross-route data-scrml-prefetch wiring
437e539 docs(s91-pre-wrap): comprehensive S91 changelog entry (DRAFT)
b28f493 A-4.7: per-route HTML augmentation + role-bootstrap + W-CG-CHUNK-* lints — A-4 WAVE FULLY CLOSED
<wrap-bookkeeping commit landing this hand-off + map refresh + changelog backfill>
```

### Patterns validated this session

- **4 cherry-pick recoveries** per `feedback_file_delta_vs_cherry_pick.md`: L 03-contact-book + M A-4.1 + U A-4.6 + S A-4.4. Each had worktree base predating main-side sibling landings; cherry-pick auto-merged additive changes; manual conflict resolution at exact-line overlaps. **Most stress: A-4.4 with 4 TEMP commits + 4 soft-resets bundled into clean final commit** (route-splitter + runtime-template + runtime-chunks + PIPELINE + domain.map all conflicted simultaneously).
- **4 CWD-routing trap-and-catches** validating S91 pa.md `feedback_agent_isolation_cwd_routing.md` fold-in: (1) session-open Bash batch, (2) user-voice S90 commit, (3) A-3.5 file-delta initially landing in worktree, (4) A-4.2 file-delta gate. Each caught before damage.
- **1 F4 leak recovery**: L Sub-task A wrote to main's working tree directly; PA cleaned via `git checkout HEAD --`; subsequent sub-tasks correctly isolated.
- **1 pre-commit-gate save**: A-4.4 test §12 placeholder assertion collided with A-4.6's real-hash replacement; pre-commit caught; updated to NOT-placeholder + base36 regex.
- **TEMP-commit + soft-reset bundling** for cherry-pick recoveries — `--no-verify` ONLY on procedural sequencer-advance commits, always rolled back into clean final commits with pre-commit gate run. Zero substantive `--no-verify`.

### Q-OPEN state at S91 close

**All session-open Q-OPENs disposed:**
- Q-OPEN-1 (A-3.5) ✅ `bf2b098` · Q-OPEN-2 (A-2.7) ✅ `59279e7` · Q-OPEN-3 A-2.8 ✅ `527bae8` (A-2.9 deferred; lower priority)
- Q-OPEN-4 (A-4 wave) ✅ FULLY CLOSED (A-4.1 through A-4.7)
- Q-OPEN-5 (Wave 4.A A+R adopter-content) ⏸️ Rule 1 deferred
- Q-OPEN-6 (paired migration re-grep) ⏸️ low-value
- Q-OPEN-7 (pa.md S91 memory fold-in) ✅ `399fc81`
- Q-OPEN-8 (default=null audit-doc) ✅ no-edit-needed
- Q-OPEN-9 (/map refresh) ✅ `199940e` (session-open) + post-A-4.7 refresh at wrap
- Q-OPEN-S91-NEW (S90 user-voice) ✅ `8d13012`
- Q-OPEN-NEW (SPEC §40.9.9 case-fix) ✅ `1d1ceef`
- Q-OPEN-NEW (03-contact-book) ✅ `5abcf20` + SCOPING `3689153`

### Q-OPEN slate for S92 (carried)

| Q-OPEN | Description | Priority | Est |
|---|---|---|---|
| **A-5 integration tests** | Consumes A-2 + A-3 + A-4 output; depends on user disposition for scope + timing. Most logical next major effort. | HIGH (v0.3.0 cut path) | TBD per user scope decision |
| **A-2.9 perf + memory characterization** | Corpus-wide ceiling-baseline measurement post-A-2. | LOWER | 7-12h |
| **Wave 4.A A + R adopter-content** | scrml.dev refresh + README + currency. v0.3.0 cut path blocker per S88 user ratification. | DEFERRED (Rule 1) | 6-12h |
| **A-4.6 deferred — `compiler` manifest version source** | `chunks.json` `compiler` field hard-coded `"scrml-0.3.0"`; pkg.json shows `0.2.0`. Reconcile when v0.3.0-alpha tag cuts. | LOW | <1h |
| **A-4.7 deferred — `--chunk-size-budget` CLI flag** | Replace hard-coded `CHUNK_LARGE_SOFT_BUDGET_BYTES = 100000` with CLI-configurable. | LOW | 1-2h |
| **A-4.7 deferred — W-CG-CHUNK-NO-PREFETCH polish** | Distinguish "no internal links" vs "links resolved nowhere". | LOW | <1h |
| **A-2.9 + A-4 polish bundle candidate** | Consider single dispatch combining the three deferred polishes above. | NICE-TO-HAVE | 8-15h |

### Things S92 PA must NOT screw up (carry-forward)

- All S88-S91 memory rules (null/undefined ABSOLUTE · self-host from-scratch · file-delta-vs-cherry-pick · land-before-cleanup · agent-crash-partial-recovery · isolation:worktree EXPLICIT · CWD-routing). All rules validated end-to-end across stress patterns this session.
- Rule 1 (no marketing/article work unless user raises it) — Wave 4.A A+R tracks remain deferred until user surfaces them.
- Rule 2 (full-production fidelity) — S91 never relaxed; OQ-A3-A user-override precedent stands.
- Rule 3 (right answer beats easy answer) — §40.9.9 case-fix was the easy answer (corpus-zero); the right answer was the SPEC fixture correction (1d1ceef).
- Rule 4 (spec normative; derived planning docs NOT) — applied throughout (W-CG-CHUNK-* §34 + §40.9.11 verified against SPEC structure).

### Cross-machine state at S91 close

- scrmlTS: 30 commits ahead origin (push pending wrap step 7)
- scrml-support: 1 commit ahead origin (push pending wrap step 7)
- Working tree: clean
- No agent worktrees retained

### Push state — REQUIRES EXPLICIT AUTHORIZATION

Per session-open authorization: "No pushes until explicit 'push' at wrap." User said "wrap" not "wrap and push". Pa.md "wrap" default: execute 1-6 + 8, leave step 7 explicit-pending. Surface for push when ready.

---

## Tags

#session-91 #CLOSE #LANDMARK-30-COMMITS #A-2-FULLY-CLOSED #A-3-FULLY-CLOSED #A-4-FULLY-CLOSED #03-contact-book-CLOSED #v0.3.0-critical-path-substantively-complete #+242-tests #4-cherry-pick-recoveries #4-CWD-trap-and-catches #1-F4-leak-recovered #1-pre-commit-gate-save #zero-substantive-no-verify #push-pending-wrap-authorization
