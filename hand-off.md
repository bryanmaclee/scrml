# scrmlTS — Session 90 (OPEN)

**Date:** 2026-05-13 (S90; opened directly after S89 wrap)
**Previous:** `handOffs/hand-off-89.md` (S89 CLOSE — 36-commit landmark; HEAD `71305fe`)
**This file:** rotates to `handOffs/hand-off-90.md` at S91 open

**Tests at S90 open:** **12,065 pass / 117 skip / 1 todo / 0 fail / 604 files** at HEAD `71305fe` (carried from S89 close; no S90 work yet).

**Semver state:** v0.2.6 `efbd1e8` still the shipped baseline. v0.3.0 cut path ~95% cleared after S89 (Approach A still has A-2.3..A-2.9 + A-3 + A-4 + A-5 + Wave 4 A/R tracks).

**Cross-machine sync state at S90 open:**
- scrmlTS: 0 ahead / 0 behind origin/main ✅ (S89 wrap pushed)
- scrml-support: 0 ahead / 0 behind origin/main ✅
- Working trees clean across both repos.

**Worktree state at S90 open:** clean. Only main checkout.

**Inbox state:** no unread `.md` messages in `handOffs/incoming/`. Only `dist/` (test artifacts) + `read/` subdirs.

---

## S90 — what happened so far

(open; no work yet)

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

## Open questions to surface immediately (S90 pickup)

### Q-OPEN-1 — Map refresh
Run incremental `/map` to bump `primary.map.md` commit metadata + capture any S89 deltas the wrap-time refresh missed? Pure-mechanical PA work, ~5 min.

### Q-OPEN-2 — S89 user-voice append
Append 4 S89 verbatim directives to `../scrml-support/user-voice-scrmlTS.md` as `## Session 89 — 2026-05-13` before any other S90 work? Pure-PA append, ~10-15 min.

### Q-OPEN-3 — M-7C-D-12 impl Tracks 1-5 (carried from S89)
Option ε ratified S89. **3 substantive OQs still need disposition before impl:**
- **OQ-2 wire-envelope JSON shape** — small adjustment for absence-vs-JS-host-null wire distinction
- **OQ-5 `?? "undefined"` replacement** — codegen emits literal `"undefined"` string in init-fallback (emit-server.ts L882/L1047/L1139 + emit-logic.ts 10 sites + scheduling.ts L127-L129)
- **OQ-6 `E-DERIVED-ENGINE-INITIAL-UNDEFINED-RT` rename** — error code name contains forbidden `undefined` token; likely → `E-DERIVED-ENGINE-INITIAL-ABSENT-RT`

5 tracks / 33-45h aggregate ready to dispatch after OQ-2/5/6 dispositioned. SCOPING at `docs/changes/m-7c-d-12-runtime-sentinel-scoping/SCOPING.md`.

### Q-OPEN-4 — 9.A classification chain-blocked (carried from S89)
After M-7C-D-12 ratification + impl, ~18 M-7C-D-N + 16 M-8C-D-N items can dispatch as bundled paired edit packets per audit §6 ordering (less the items closed-as-spec-ratified by Option ε).

### Q-OPEN-5 — Wave 4.A remaining tracks (A + R) (carried from S89)
T-track + D-track done S89 via Wave 6. **A-track (scrml.dev refresh)** + **R-track (README + currency)** pending. ~6-12h aggregate.

### Q-OPEN-6 — A-2.3 onward (Reachability Solver continuation) (carried from S89)
A-2.1 scaffold + A-2.2 Component 1 done. A-2.3 reactive_dep_closure (Component 2; 6-10h) next. Then A-2.4..A-2.9. Multi-month walltime to close A-2 wave.

### Q-OPEN-7 — A-3 sub-phases pending (AuthGraph impl) (carried from S89)
SCOPING captured. 5 sub-phases / 30-49h parallel critical path. Depends on A-3's role-enum resolution feeding A-2.5 Component 4.

### Q-OPEN-8 — `default=null` audit-doc closure (carried from S89)
Check whether `docs/audits/articles-currency-table-2026-05-13.md` needs an update note reflecting the post-S89 ruling change (null/undefined now ABSOLUTE — `default=null` is no longer ratifiable).

### Q-OPEN-9 — pa.md S89 amendments (carried from S89)
Consider whether any S89 memory rules reach pa.md update threshold (null-eradication rule + self-host-is-from-scratch rule are arguably load-bearing across all future sessions; might warrant pa.md addendum).

---

## Things S90 PA must NOT screw up (carried forward from S89)

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

---

## Push state at S90 open

scrmlTS + scrml-support both 0 ahead of origin. Clean baseline.

---

## Tags

#session-90 #open #v0.2.6-baseline #v0.3-in-flight #m-7c-d-12-tracks-pending #A-2-3-onward-pending #A-3-impl-pending #wave-4-A-and-R-pending #user-voice-S89-not-appended #map-metadata-stale-on-line-3
