# scrmlTS — Session 98 (OPEN)

**Date:** 2026-05-17
**Previous:** `handOffs/hand-off-98.md` (S97 CLOSE rotated as S98 OPEN-pickup snapshot)

---

## Session-open state

- **scrmlTS HEAD:** `16d8aa4` (S97 CLOSE rotate hand-off-97)
- **scrmlTS ahead/behind origin:** 0/0
- **scrml-support HEAD:** `f14bb42` (S98-open: merge S85 machine-B user-voice additions into chronological slot)
- **scrml-support ahead/behind origin:** **1/0 ahead** — push pending
- **Working tree (scrmlTS):** `M docs/articles/teej_baiting_tweet.md` (pre-session WIP, see Open Question 1)
- **Working tree (scrml-support):** clean tracked; 5 untracked `voice/articles/2026-05-09-*` files + untracked `tools/` (pre-session WIP, see Open Question 2)
- **Worktrees:** main only
- **Inbox (scrmlTS):** empty
- **Inbox (scrml-support):** empty
- **Hook config:** configuration B (pre-commit + post-commit + pre-push)
- **Tests at HEAD:** not yet re-run this session; S97 close baseline was 13,019 pass / 117 skip / 1 todo / 0 fail / 667 files / 43,402 expect

---

## S98 open — cross-machine sync reconciliation (already done)

Session opened with a cross-machine divergence: this machine's `scrml-support` was 1 commit behind origin (carrying the S96 `pa-scrmlTS.md` canonical-home move), AND carried 5 uncommitted S85 user-voice entries that never reached origin. Origin meanwhile had S86 → S95 user-voice entries this machine never pulled.

**Resolution executed S98 open (user-authorized via session-start question):**
1. Stashed local 102-line `user-voice-scrmlTS.md` modification.
2. `git pull --ff-only` brought local from `745adde` (S85) to `548a675` (S96).
3. `git stash pop` produced conflict on user-voice (both sides modified the same region).
4. Conflict resolved via deterministic Python script: inserted local S85 entries into chronological slot (between origin's S85 Wave-2.5 entry and the `## Session 86` header). No content lost on either side; verbatim preserved.
5. Committed as `f14bb42 docs(user-voice): merge S85 machine-B additions in chronological slot`.

**Status:** scrml-support has 1 unpushed commit (the merge). Push when user authorizes — likely batched with subsequent S98 work.

---

## Carry-forward from S97 close (NOT yet picked up)

### From hand-off-98.md (S97 close) §"Open questions to surface immediately"

1. **Svelte `$store` auto-subscribe lint** — the only remaining generic-error in the brute-force stress harness. Needs $-prefix ident context detection. v0.3.x candidate. Three approach options listed in S97 hand-off.
2. **pa-scrmlTS.md kickstarter v1→v2 reference staleness** — confirmed S98 open: `pa-scrmlTS.md:391` still cites `docs/articles/llm-kickstarter-v1-2026-04-25.md`. v2 (`llm-kickstarter-v2-2026-05-04.md`) self-declares as superseding v1. Quick doc decision needed.
3. **Postfix value-semantic** — `rewriteReactiveAssign` returns NEW value (matches `++x` not `x++`); value-position silently wrong. Document-only finding; vanishingly rare. v0.3.x watch-item.
4. **`feel-of-performance` empirical study** — S83-queued, deferred S94/S95/S96/S97. Is this still the right priority slot?
5. **Brute-force harness extension candidates** — Alpine.js / HTMX / Lit / Stencil / Web Components. Trigger when adopter friction signals.

### From user-voice-scrmlTS.md S94/S95 (most recent durable directives)

6. **Heads-up coding session** — S94 verbatim: *"I don't think we have pushed the canonical of this language hard enough... next session I want to have a heads-up coding session to see what we can and cannot do with this language."* S95 was supposed to be this; per S95 user-voice it became partially bug-fix-heavy. Not explicitly named in the S97 hand-off carry-forward. Possibly already absorbed, possibly still owed.
7. **Missing state-system primitive — event-with-payload → transition** — S95 user-direct: scrml currently has no state-system surface for "event with payload triggers transition consuming the payload." Forced into `function` glue today. Blocks the 90/10 fn/function ratio target. Filed as v0.4+ language-design dispatch candidate at `docs/changes/heads-up-s95-bugs/MISSING-PRIMITIVE.md`.
8. **State-vs-logic boundary axiom (S94 corrected S95)** — the corrected reading: state system should be able to fully DESCRIBE its own transitions; logic CAN describe state mutations but SHOULDN'T HAVE TO. Apply during language-addition reviews + example-corpus audits.
9. **Track 2 (LLM corpus presence)** — at least as important as Track 1 (compiler correctness). Concrete moves listed S95: LLM benchmark, open-source examples, honest current-state page, voice essays (3 candidates), synthetic corpus generation deferred.
10. **`building anyway` essay scaffold** — drafted S95 at `scrml-support/voice/articles/building-anyway-draft-s95.md` (scaffold only; user authors). Marketing-adjacent — Rule 1 says don't volunteer unless user raises.

### From master memory rules

11. **lin redesign — Approach B ratified** — per memory rule `project_lin_redesign.md`: deep-dive done, spec amendments drafted, implementation is the next step (NOT another deep-dive/debate). Has this been picked up anywhere in S96/S97? Not visible in the bug-chip catalog work. Verify before any new dispatch on lin.

---

## Open questions to surface immediately (S98 PA pickup)

1. **The pre-session WIP in `docs/articles/teej_baiting_tweet.md` (scrmlTS) — 10 lines appending the actual tweet text back into a file that S89 explicitly archived as a stub (`# teej baiting tweet (RETRACTED)`).** This contradicts the S89 retraction. Likely cross-machine filesystem-sync residue or another session's experimental edit that never committed. Disposition needed: (a) revert (preserve the S89 retracted-stub shape, content stays in `scrml-support/archive/articles-skipped/`), (b) keep + reframe as un-retraction with intent stated, (c) leave as-is and surface in next session. Rule 1 (no marketing/article work unless user raises) means PA should NOT auto-decide.
2. **The pre-session WIP in `scrml-support` — `user-voice-scrmlTS.md` merge already handled, but 5 untracked `voice/articles/2026-05-09-*` files (dev.to opener / modularity reply v1+v2 / server-keyword-deprecation) + untracked `tools/` directory remain.** These predate this session. Likely from S85+ adopter-content work that never got committed. Disposition pending user — same Rule 1 framing for the article drafts; `tools/` may be operational scaffolding.
3. **scrml-support push** — `f14bb42` (S98 user-voice merge) is unpushed. Push now (low risk, append-only verbatim), batch with S98 substantive work, or defer to wrap?
4. **What's the actual S98 priority?** Several live carry-forwards (heads-up coding from S94/S95; bug-catalog drain — though S97 hand-off says all filed compiler bugs are closed; perf-feel empirical study from S83; lin redesign implementation; Svelte `$store` lint). User direction needed before any dispatch.

---

## Session-start checklist status

- [x] Read `pa-scrmlTS.md` (852 lines, full)
- [x] Read `docs/PA-SCRML-PRIMER.md` (898 lines, full)
- [x] Read `compiler/SPEC-INDEX.md` (320 lines, full)
- [x] Read `master-list.md` §0 dashboard (§0-§0.6, lines 100-271)
- [x] Read `hand-off.md` (S97 CLOSE, full)
- [x] Read recent contentful user-voice (S94 entries + all S95 entries, ~205 lines covering 8 substantive blocks)
- [x] Rotate `hand-off.md` → `handOffs/hand-off-98.md`
- [x] Create fresh `hand-off.md` (this file)
- [x] Cross-machine sync hygiene reconciliation (scrml-support fast-forward + user-voice merge)
- [ ] Confirm push policy with user
- [ ] Surface priorities + open questions; await direction

---

## Things S98 PA must NOT screw up (carry-forward, unchanged)

### pa-scrmlTS.md Rules permanently load-bearing

- Rule 1 — no marketing/article/tweet work unless user brings up (relevant TODAY for `teej_baiting_tweet.md` WIP + 5 untracked voice/articles files)
- Rule 2 — full-production-language fidelity; no "users won't notice" reasoning
- Rule 3 — right answer beats easy answer 99.999%
- Rule 4 — SPEC is normative; derived planning docs are NOT (verify against `compiler/SPEC.md` before encoding spec-derived claims)
- Rule 5 — shoot straight; politeness-for-politeness rejected; push back when warranted

### S96/S97 PA-memory rules permanently load-bearing

- `feedback_read_spec_at_session_start.md` — SPEC-INDEX.md read at open; verify spec sections directly before spec-implication changes
- `feedback_declaration_form_in_reproducers.md` — synthetic reproducers use V5-strict canonical shape
- `feedback_dont_wrap_at_43_percent.md` — don't propose wrap above 50% remaining; 1M context budget actively tracked by user

### S97-specific anti-patterns (carry into S98)

- DO NOT trust master-list "STILL PENDING" markers without cross-verifying against `docs/changelog.md`
- DO NOT trust hand-off bug framing without reproduce-first verification
- DO NOT extend the stress harness fixtures without classifying them

### S98 NEW (this session — cross-machine sync)

- DO surface cross-machine divergence at session open. The `pa-scrmlTS.md` stub redirect to a file not-yet-pulled was a structural hint that pull was needed; merging the user-voice divergence was load-bearing because the local 102 lines were verbatim user statements (append-only verbatim rule applies). Always: stash → pull → reconcile → commit before any other work touches the divergent paths.

---

## Tags

#session-98 #OPEN #cross-machine-sync-reconciled #user-voice-merge-S85-machine-B #pre-session-WIP-surfaced #carry-forward-from-S97-close #heads-up-coding-still-pending #lin-implementation-still-pending
