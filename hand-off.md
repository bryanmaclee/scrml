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

## S91 mid-session activity log

### Commits landed (5 in scrmlTS + 1 in scrml-support)

| # | Commit | Description |
|---|---|---|
| 1 | scrmlTS `199940e` | s91-open hygiene — hand-off rotation + FULL_COLD_START map refresh (11 maps) |
| 2 | scrmlTS `399fc81` | pa.md amendments — F4 step 1 sharpened + new "S90 addendum" CWD-routing subsection |
| 3 | scrml-support `8d13012` | user-voice S90 OQ-A3-A override verbatim backfill |
| 4 | scrmlTS `bf2b098` | **A-3.5 wave-closure** — 7 §34 catalog rows + 5 §40.9.11 rows + api.js Stage 7.55 AG wire-in + §40.9.9 13-test integration suite + normalizeFileAST helper + cross-ref consistency audit |
| 5 | scrmlTS `1d1ceef` | SPEC §40.9.9 case-fix — 6 sites `role="admin"` → `role="Admin"` (closes A-3.5 deferred #1) |
| 6 | scrmlTS (master-list S91 mid-section addendum + this hand-off update) | Pending — PA-direct work in progress |

### Q-OPEN dispositions at S91-mid

| Q | Status | Notes |
|---|---|---|
| Q-OPEN-1 (A-3.5) | ✅ CLOSED `bf2b098` | A-3 wave fully wave-closed; 13-test §40.9.9 integration replay green |
| Q-OPEN-2 (A-2.7 outer fixpoint) | 🟡 IN FLIGHT | Background agent dispatched; 8-14h walltime |
| Q-OPEN-3 (A-2.8 + A-2.9 polish) | ⏸️ BLOCKED on A-2.7 | Queue after A-2.7 lands |
| Q-OPEN-4 (A-4 per-route splitter) | ⏸️ BLOCKED on A-2.7 | Major 60-120h wave; sequence after A-2.7 |
| Q-OPEN-5 (Wave 4.A A+R adopter-content) | ⏸️ Rule 1 (marketing-shaped; do not surface unless user raises) | — |
| Q-OPEN-6 (paired migration packets re-grep) | ⏸️ unblocked but deferred | Low-value re-grep audit; defer |
| Q-OPEN-7 (pa.md S90 memory fold-in) | ✅ CLOSED `399fc81` | Sharpened F4 step 1 + new CWD-routing subsection |
| Q-OPEN-8 (default=null audit-doc closure) | ✅ CLOSED as no-edit-needed | Audit doc already incorporates S89 ruling at authorship; BORDERLINE article items still require user ratification per Rule 1 |
| Q-OPEN-9 (`/map` refresh) | ✅ CLOSED `199940e` | FULL_COLD_START refresh; 11 maps reflecting S90 state |
| Q-OPEN-S91-NEW-1 (S90 user-voice append) | ✅ CLOSED `8d13012` | OQ-A3-A verbatim landed in scrml-support |
| Q-OPEN-NEW (SPEC §40.9.9 case-fix) | ✅ CLOSED `1d1ceef` | 6 sites mechanical |
| Q-OPEN-NEW (03-contact-book auth-redirect SCOPING) | 🟡 IN FLIGHT | Background scrml-deep-dive scoping agent; 2-4h walltime; output at `docs/changes/03-contact-book-auth-redirect-SCOPING/SCOPING.md` |

### In-flight at S91-mid

- **A-2.7 outer fixpoint operator** — agent `a-2-7-agent-id-tracked-via-task-list`; closes A-2 wave.
- **03-contact-book auth-redirect SCOPING** — scrml-deep-dive agent; produces fix-shape proposals + recommendation + OQs for user ratification.

### CWD-routing precedent count this session

**Three trap-and-catches** validating the S91 pa.md fold-in:
1. Session-open Bash batch leaked CWD to scrml-support (caught next batch via relative-path Read failure)
2. User-voice S90 append CWD-leak (caught immediately; reset)
3. A-3.5 file-delta initially landed in worktree before reset (caught via empty staged-diff + `git status` "On branch worktree-...")

### Push state at S91-mid

scrmlTS: 5 commits ahead of origin (`199940e..1d1ceef`).
scrml-support: 1 commit ahead of origin (`8d13012`).
**Push deferred to wrap per user authorization at session-open.**

---

## Tags

#session-91 #open #post-S90-landmark-17-commits #A-3-FULLY-CLOSED-S91 #A-2.7-in-flight #03-contact-book-scoping-in-flight #map-refresh-DONE #user-voice-S90-DONE #pa.md-S91-amendments-DONE #§40.9.9-case-fix-DONE #5-commits-pending-push
