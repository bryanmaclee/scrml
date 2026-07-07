# scrml — Session 243 (LIVE)

**Date:** 2026-07-06/07. **Profile:** A — FULL (`/boot`, default). Predecessors S241 + S242 BOTH wrapped (concurrent, two machines) → this session takes up officially per the concurrent-session ruling. S242 = this machine's CLOSE (`handOffs/hand-off-242.md`); S241 = the other machine's CLOSE (`handOffs/hand-off-s241.md`) — **its NEXT-START queue is ALSO owed.** Read both.

## ⚠️ READ FIRST — inherited open state
- **PUSH-PENDING (from S242 "wrap no push").** scrml is **ahead 1** (the S242 wrap commit, LOCAL, unpushed) + scrml-support ahead 1 (its wrap, unpushed). Everything ELSE from S242 IS pushed. **First real action: `git push` scrml + scrml-support, then S147 coherence (origin/main...HEAD == 0/0).** Awaiting user authorization.
- **BOTH machines' queues live.** S242 queue below + `handOffs/hand-off-s241.md` §NEXT-START (residual-D ruling, F3-still-open, 6nz dev-live-reload, the R26-sweep 11 live gaps, the 8 S241 gaps).
- **Per-machine hooks.** THIS machine has config-B hooks (pre-commit + pre-push); the S241 machine has none. S242's pre-push/pre-commit fixes (#1/#1b/#2) are THIS machine's `.git/hooks/` only (untracked, machine-local) — flogence's CI ask (inbox 1845) is the source-controlled fix.

## 📨 INBOX — 4 unread flogence msgs (all responses to scrml's own S242 outbound proposals)
1. **1749 stack-pack-scrml FIXED — needs:action.** Verify the vendored whole-stack primer's 5 tech claims (auth `scrml:auth`/`<auth role=>` · realtime `<channel>`/`broadcast()` · db `?{}`/`<schema>`/Bun.SQL/`db=` · deploy `scrml build --target` · server-placement inference). It's now the ADOPTER CANON → accuracy matters. Quick (scrml authored it; grounded in PRIMER/SPEC).
2. **1817 concurrent-session claim protocol — needs:action.** Apply 2 interim board hardenings to the live `scrml-support/handOffs/active-sessions/` board: (a) write-FOOTPRINTS on claims (footprint-intersection, short-lived file-locks on hot docs — closes Surface 2, the SPEC.md §38.13 false-clean-merge) · (b) `lease-until` field + pre-push self-revalidation + triple-gated reclaim (closes Surface 3, the 2h-heartbeat-unsound). +recommended: route claims through a shared `claims.md` via git-CAS.
3. **1845 CI full-suite gate — needs:action.** Stand up ask 1 (`.github/workflows/ci.yml` — full suite on clean ubuntu runner; drop-in template provided) + ask 2 (move S242's machine-local pre-push scope-fix into source-controlled `scripts/git-hooks/pre-push`). Once CI is the full-suite authority, the local pre-push shrinks to fast-feedback → the env-floor false-fail class disappears by construction.
4. **1018 oracle-ask #6 (co-signed w/ giti) — feasibility read (no build ask).** Two additive `--emit-block-analysis` sidecar extensions for AST semantic merge: [PRIMARY] per-`type` field-level `members[]` emission (`typeShape` + `{name,memberKind,typeText,span}`, enum variant `args[]`); [SECONDARY] tight `bodySpan`. Consumers: giti §4.3 AST merge + flogence same-file region-leasing. Payoff-vs-cost = scrml's call. Also flags a SEPARATE bug: `delta-log.scrml` fails block-analysis emit with `E-CODEGEN-INVALID-LOGIC` (isolated NOT the enum; likely residual-D multi-stmt foreign `_{}` mis-lower to `return (…)`).

## 📋 S242 NEXT-START queue (carried)
1. Push the S242 wrap (scrml + scrml-support).
2. flogence primer-verify (inbox 1749).
3. **Apply realtime SPEC §38.13** to SPEC.md from the drafted `docs/changes/realtime-external-db-writes-2026-07-06/SPEC-AMENDMENT.md` (section-relative; SPEC.md is a HOT doc — short-lived lock per claim-protocol) + regen SPEC-INDEX + flip `g-realtime-external-db-writes` open→nominal. Then the impl wave (§38.13.9: emit-channel trigger DDL + LISTEN bridge + `<onchange>` dispatch + 6 codes; Postgres-only).
4. **Fire auth-flows + JWKS** — dispatch-ready SCOPE at `docs/changes/baas-auth-flows-jwks-2026-07-06/SCOPE.md` (RS256 GO). scrml-writing dispatch → include kickstarter + anti-patterns; PA adversarial /code-review on landing (S239).
5. flogence claim-protocol hardenings (inbox 1817).
6. CI stand-up (inbox 1845). BaaS #2 (blob storage) + the worth-building set; the MED/LOW backlog + Nominal features (S219 finish-the-project).

## 🚦 STATE @ boot
- **git:** scrml HEAD `da6bc91d`+wrap (ahead 1, UNPUSHED). scrml-support ahead 1 (UNPUSHED). Both behind 0, clean (ex. inbox). Branch = main.
- **Board (@generated, S242):** HIGH **0** · MED **19** · LOW **15** · Nominal **7** (realtime token = NOMINAL/uncounted until §38.13 lands). Suite 19359/0 subset at BaaS #3 gate; env-floor ≈ 7 browser whitespace-assertion tests (env-specific, not regressions).
- **Worktrees:** main only. **active-sessions board:** S242.md marked CLOSED.
- **Maps:** not refreshed S242 (no-code wrap). Watermark trails — refresh at next code-landing wrap.

## 🧭 METHODOLOGY IN FORCE (Profile A FULL)
R1–R5 · **S239 adversarial /code-review MANDATORY on our OWN codegen** before landing (green is a floor) · S138 R26 empirical (both directions) · S215 random-sample 10× · S67 file-delta + S226 3-way-merge for shared files + file-footprint · S147 coherence · S88/S90/S99/S126 worktree isolation + path discipline · S136 BRIEF.md archival · S219 orchestrate-don't-grind + default-GO · S43 cross-machine sync · the concurrent-session ruling (official-takeup; only wrap defers) · `feedback_file_msgs_along_the_way` (file cross-repo msgs immediately) · commit-to-main only after explicit authorization.

## Tags
#session-243 #live #boot-profile-a #push-pending #both-queues-owed #4-inbox-flogence #realtime-spec-owed #auth-flows-teed-up #concurrent-ruling
