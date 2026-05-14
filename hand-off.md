# scrmlTS — Session 92 (OPEN)

**Date:** 2026-05-14
**Previous:** `handOffs/hand-off-91.md` (S91 CLOSE — 30-commit landmark; A-2 + A-3 + A-4 + 03-contact-book FULLY CLOSED; HEAD `178a86f`)

**Session-start state at S92 open:**
- scrmlTS: HEAD `178a86f` (S91 wrap-bookkeeping landed + pushed) · 0 ahead / 0 behind origin/main
- scrml-support: HEAD `8d13012` (S91 user-voice S90 OQ-A3-A backfill landed + pushed) · 0 ahead / 0 behind origin/main
- Working tree: clean (only main checkout; no agent worktrees)
- Inbox: empty (`handOffs/incoming/` contains only `dist/` + `read/` subdirs; no unread `.md`)
- Hook config: configuration B (rich, `.git/hooks/` carries `pre-commit` + `post-commit` + `pre-push`) — leave as-is per S88 amendment
- Tests at HEAD `178a86f` (S91 close baseline): **12,517 pass / 117 skip / 1 todo / 0 fail / 629 files** (full `bun test`)

**Map currency:** `primary.map.md` line 3 stamps `commit: b28f493` (A-4.7 landing + S91 post-A-4.7 refresh). HEAD is `178a86f` — only the S91 wrap-bookkeeping commit (`178a86f` itself) landed after the map refresh; that commit touched hand-off + changelog + master-list only (no code/spec/pipeline). **Maps current for code/spec/pipeline state.** No refresh required at session-open.

---

## Session-open hygiene done

1. ✅ Read `pa.md` in full (all protocol layers loaded: S90 CWD-routing + S88 isolation-explicit + S87 base-SHA check + S83 commit-discipline + S78 hook + S67 file-delta + Rules 1-4)
2. ✅ Read `docs/PA-SCRML-PRIMER.md` (chunk read; §1-§10 covered — three RHS shapes, V5-strict, engines, validators, channels/schema/predicates, stdlib catalog)
3. ✅ Read `master-list.md` §0 + addenda (live phase dashboard through S91 mid + S91 close)
4. ✅ Read S91 close hand-off in full (commit ledger; state tables; Q-OPEN slate for S92; patterns validated)
5. ✅ Read user-voice S86-S90 verbatim entries (idiomatic-examples styling + corpus-ouroboros + try/catch ouroboros + Approach A deferral reversed + Sonnet default-down + null+undefined absolute + self-host from-scratch + skinny-arrow lifecycle + "1 all concurrent where safe" + OQ-A3-A user override)
6. ✅ Cross-machine sync verified: scrmlTS + scrml-support both 0/0 vs origin (S91 wrap pushed)
7. ✅ Worktree state verified: only main checkout
8. ✅ Inbox state verified: empty
9. ✅ Hook config verified: configuration B
10. ✅ Hand-off rotated to `handOffs/hand-off-91.md`

---

## Open questions to surface immediately (carried from S91 close)

### Q-OPEN-1 — A-5 integration tests (HIGH PRIORITY — v0.3.0 cut path)
Consumes A-2 + A-3 + A-4 output end-to-end. Most logical next major effort. Depends on user disposition for scope + timing. SCOPING dive likely needed first to ratify shape (what does "integration test" mean across the 3 waves — corpus replay? trucking-dispatch reference app? new test-bind shapes? worked-example expansion?).

### Q-OPEN-2 — A-2.9 perf + memory characterization (LOWER)
Corpus-wide ceiling-baseline measurement post-A-2 (Reachability Solver). 7-12h. Standalone; no dependencies.

### Q-OPEN-3 — Wave 4.A A+R adopter-content (DEFERRED — Rule 1)
scrml.dev refresh + README + currency. v0.3.0 cut path blocker per S88 user ratification. **Rule 1 says do not surface unless user raises.** Carry as known-pending.

### Q-OPEN-4 — A-4.6 deferred: `compiler` manifest version source (LOW)
`chunks.json` `compiler` field hard-coded `"scrml-0.3.0"`; pkg.json shows `0.2.0`. Reconcile when v0.3.0-alpha tag cuts. <1h.

### Q-OPEN-5 — A-4.7 deferred: `--chunk-size-budget` CLI flag (LOW)
Replace hard-coded `CHUNK_LARGE_SOFT_BUDGET_BYTES = 100000` with CLI-configurable. 1-2h.

### Q-OPEN-6 — A-4.7 deferred: W-CG-CHUNK-NO-PREFETCH polish (LOW)
Distinguish "no internal links" vs "links resolved nowhere". <1h.

### Q-OPEN-7 — A-2.9 + A-4 polish bundle (NICE-TO-HAVE)
Consider single dispatch combining Q-OPEN-2/4/5/6 above. 8-15h aggregate.

### Q-OPEN-8 — S91 user-voice append (housekeeping)
S91 closed with all session-open verbatim already backfilled (`8d13012` covered S90 OQ-A3-A). PA should grep S91 transcript for any new verbatim directives that landed during S91 itself (wave-3 batch authorization? A-4 sub-phase ratifications? wrap authorization shape?). Surface at next user interaction; append once confirmed.

---

## Things S92 PA must NOT screw up (carried + extended)

### Rules permanently load-bearing
- Rule 1 — no marketing/article/tweet work unless user brings it up
- Rule 2 — full-production-language fidelity
- Rule 3 — right answer beats easy answer 99.999% of the time
- Rule 4 — spec is normative; derived planning docs are NOT
- S86 ratifications — idiomatic-examples styling rule + corpus-ouroboros warning + BS-layer over SPEC retreat
- S87 memory rules — bash-cleanup dry-run + file-delta base SHA check
- S88 memory rules — file-delta-vs-cherry-pick + stated-intent-vs-corpus migration + `isolation: "worktree"` MUST be explicit on every dev-agent Agent() call
- S89 memory rules — land-before-cleanup + agent-crash-partial-recovery + null-does-not-exist-in-scrml (ABSOLUTE; extends to `undefined`; `""` is defined) + self-host-is-from-scratch
- S90 memory rule — agent-isolation-cwd-routing (Bash shell CWD routes harness worktree allocation; `git -C` preferred for sibling-repo ops)

### Specific S91-stress-validated patterns to honor in S92
- **DO** check agent's working tree for uncommitted Step-N work when agent crashes pre-commit (S89 precedent)
- **DO** PA-merge orchestrator collisions PA-side when sibling parallel dispatches both extend a shared file at different functions (S90/S91 precedents: A-3.2+A-3.4, A-2.4+A-2.6, A-4.4 with 4 simultaneous conflicts)
- **DO** cherry-pick when agent base predates main-side sibling landings on same files (S91 stress count: 4 recoveries — L 03-contact-book + M A-4.1 + U A-4.6 + S A-4.4)
- **DO** anticipate test-fixture cascade when adding new pipeline diagnostics (filter-by-code pattern: `expect(errors.filter(e => e.code === "X")).toHaveLength(N)` instead of `expect(errors).toHaveLength(N)`)
- **DO** surface agent recommendations as deliberation points when they invoke "scope tractable" framings on first-class-language-shape questions (S90 OQ-A3-A precedent)
- **DO** `cd /home/bryan-maclee/scrmlMaster/scrmlTS && pwd` before any Agent dispatch IF a sibling-repo `cd` happened earlier in the same shell (S91 trap-and-catch count: 4 — all caught before damage via F4)
- **DO** set `isolation: "worktree"` on EVERY dev-agent / scrml-writer / codegen Agent() call (S88 rule)
- **DO** trust Rule-4 reconnaissance — verify spec-derivative claims against `compiler/SPEC.md` text directly before encoding in dispatch briefs

### Anti-patterns
- **DO NOT** revisit "TS parity" as load-bearing scrml property. TS impl is scaffold; self-host is from-scratch rewrite. Per `feedback_self_host_is_from_scratch.md`.
- **DO NOT** treat `null` or `undefined` as canonical scrml tokens in ANY context. They do not exist in scrml. `""` / `0` / `false` / `[]` / `{}` ARE defined values. Per `feedback_null_does_not_exist_in_scrml.md`.
- **DO NOT** clean up agent worktree BEFORE landing its content into main. Per `feedback_land_before_cleanup.md`.

---

## S92 PA dispatch backlog (in priority order)

| Priority | Item | Est | Notes |
|---|---|---|---|
| HIGH | A-5 integration tests SCOPING | 4-8h | First step before any A-5 dispatch; produces scope dive ratifying shape + ordering |
| MEDIUM | A-2.9 perf + memory characterization | 7-12h | Standalone; ceiling-baseline measurement |
| LOW (bundle) | A-4.6 manifest version + A-4.7 chunk-budget CLI + A-4.7 lint polish | 8-15h | Combine into single polish dispatch |
| DEFERRED (Rule 1) | Wave 4.A A+R adopter-content | 6-12h | Surface only if user raises |

---

## Tags

#session-92 #OPEN #post-A-4-wave-close #v0.3.0-critical-path-substantively-complete #A-5-next-major-effort
