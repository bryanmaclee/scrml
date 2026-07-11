# scrml — Session 249 (CLOSE) — the verify-harden mega-session

**Date:** 2026-07-11. **Profile:** A (`/boot concurrent`). **Branch-baton successor to S248** (took over
main after S248's baton merge). A very large session: **verify-harden as a systematic pass** (adversarially
probe impl-vs-SPEC across covered domains) → 2 waves, ~43 divergences surfaced, **20 fixes landed** incl. **two
critical security fail-opens**, an async/await language migration, and the whole thing landed in disciplined
S239-reviewed batches on the shared-checkout concurrent-session infrastructure.

## ⚠️ READ FIRST
- **PUSH HELD** (bryan's standing hold, all session). **main @ `c4332e0d`, 56 ahead of origin, 0 behind.**
  Nothing pushed. When bryan authorizes push: `git push` (pre-push runs the full suite ~5min; coherence 0/0 after).
- **COMMIT-LOCK: RELEASED at this wrap** (`commit-lock.sh release S249`) — main-authority is FREE for the next
  boot. The lock (S250-built, `scrml-support/.../commit-lock.sh`) is the new single-writer signal: **boot runs
  `commit-lock.sh status` FIRST** (Discipline step 0), never infer leading-vs-concurrent from ps/hand-off.
- **Oracle 349/349 · full gate 19954/0** at close.
- **S250 is a concurrent off-main PA** (built the commit-lock in scrml-support; touches no scrml main). Board:
  `active-sessions/S250.md`. My ack: `active-sessions/2026-07-11-from-S249-to-S250-lock-adopted.md`.

## ✅ LANDED THIS SESSION (all local, push held)
**Wave-1 verify-harden (13 fixes, batch `4128610a`)** — engine/reactive/forms/error §19 divergences:
Rx-1 E-DERIVED-CIRCULAR-DEP (was infinite-loop-to-client) · Rx-2 E-DERIVED-WRITE · Rx-3 W-DERIVED-001 ·
Rx-6 reactive-map bare-variant · En-D1/En-D4 derived-engine-write · En-D3 derived-engine-match-exhaustiveness ·
D-ERR-1 failable-match-exhaustiveness · D-ERR-2 E-ERROR-010 (?-propagation) · D-FORM-2/3 compound-path ·
D-FORM-5 select-coerce · D-FORM-8 bind:checked. (4-reviewer S239 pass; D-FORM-4 flipped to SPEC-amend.)
**Two SECURITY fail-opens (batch `9113d5ea`):**
- **JWT auth-bypass** — verifyJwt/signJwt un-awaited in server fns (accept-all). 3 roots: block-splitter `/* */`
  in brace-ctx + tokenizer `/=/g` regex-mis-lex (export-drop) + `~{}` test-block drop; + fail-closed seed.
  (S239 caught a block-splitter regression on regex/backtick `/*` — fixed: backtick-track + containment.)
- **protect-CTE leak** — CTE/comment-prefixed SELECT shipped protected cols unredacted. Fixed CTE+comment scope.
**Wave-2 clear-FIX fail-opens (batch `c4332e0d`):** D-SF-1 schemaFor-attr-leak · D-MB-2 member-access-match-
exhaustiveness · D-EP-1 endpoint-arm-body-scope · D-SFN-2 bare-assign `?{}` broken-SQL.
**async/await MIGRATION (batch `c4332e0d`):** user async/await → hard E-ASYNC/AWAIT/FOR-AWAIT-NOT-IN-SCRML
(§19.9.8 stated intent; retired the S89 I-ASYNC-USER-SOURCE nudge; stdlib carve-out + `^{}`/`_{}` host-await exempt).

## 🧭 FORK RULINGS (bryan, banked → design-insights + user-voice)
- **Fork D = (b)** backport *-NOT-IN-SCRML to path-1 (throw/try+D-ERR-5 done; async/await done as migration).
- **Fork A = (C)** server-fn/client-reactive TRUST AXIOM: retire E-REACTIVE-003 (marshal is real), add a
  trust-boundary diagnostic (C-MVP: warn on server-fn read of a derived). **SCOPED not built** — scope draft in
  scratchpad `forkA-C-trust-boundary-SCOPE.md`. → next session builds it.
- **Fork B = implement flush()** (§6.6.5) — **NOT DONE, deferred** (small: expose runtime flush + E-REACTIVE-004).
- **Fork C = validators closed at 14 + custom** → D-FORM-1/6 landed (E-TYPE-031).
- **D-FORM-4 = amend SPEC** (drop E-ATTR-012, composable-by-design).
- **⭐ STRATEGIC: parser drain-path-1.** Keep the native-parser (path 2) as path-3's oracle, OFF the V1 path;
  don't do M5/M6. Path 3 (self-host-v2, real scrml-scrml) = post-V1 prize. Meter: if verify-harden stops
  finding a declining divergence count OR the freeze slips quarters → M5 earns its cost.

## 📋 DEFERRED BACKLOG (next-session; full detail in scratchpad `verify-harden-backlog.md`)
**Wave-2 GENUINE FORKS (need bryan rulings):** protect-allowlist→DENYLIST redesign (fail-closed-vs-over-strip
tension; the R2-HIGH — TABLE/paren/dynamic-leader STILL leak) · server-fn closure-capture trust (AUTH, like Fork A)
· schema-for `;`-multi-call expand-vs-reject · endpoint §18.6/csrf · match-block SPEC tensions.
**Broad/pre-existing FAIL-OPENS surfaced (clear-ish FIX):** ⚠️ **§18.0.1 arm-body scope-bypass is BROAD** —
MATCH-expr arms + channel `<onchange>` arms ALSO leak free vars (endpoint fixed; siblings not) · mid-arm-alternation
drop (non-surgical, ast-builder+type-system+codegen) · derived-engine INIT-ORDER (forced get before set) ·
fatal-error-writes-dist (compiler emits artifacts on fatal; exit-code is the only gate) · is-some two-word
bare-attr misparse · bare-ident foreign-init `_={}=`.
**~66 authorable GAPS** (coverage-growth, no ruling) across all domains.
**Harness verbs owed:** endpoint foreign-inbound-request verb · realtime __change (ratified, build deferred).
**OWED SPEC amendments** (Rule 4, deferred this wrap — do next): E-ERROR-010 §19.5.3/.4 + §34 row · drop
E-ATTR-012 §5.4 + §34 · async/await 3 E-rows (17843/44/45) annotate default-path emit site.
**OWED wrap-debt (S248's + mine):** worktree cleanup (~30 worktrees — DRY-RUN first, [[feedback_pa_bash_cleanup_dry_run]];
some locked/#26/mine-merged) · maps refresh (04a483d0 watermark, ~stale) · state.ts · board archive of CLOSED
S242/244/245/246/247/248 · changelog dated block. Open origin issues: #25 Windows pathFor · #27 navigate soft-nav.

## 🔬 METHODOLOGY (the irreducible lessons)
- **Verify-harden works + adversarial S239 is non-negotiable.** The green oracle MASKS fail-opens (it tests what
  it asserts, not the negative-space). S239 adversarial review caught 2 things a green gate couldn't: the JWT
  block-splitter regression (regex/backtick `/*`) + the protect allowlist-gap. Green ≠ complete.
- **Synth-AST misses upstream** (Rx-1: detector 22/22 on synthetic AST, dead in the real pipeline). Probe the real CLI.
- **A recurring ROOT-CLASS**: member/attr/compound-path resolution blind spots (the checker resolves a plain
  ident but skips member/attr/compound positions) — behind D-MB-2, D-SF-1, D-EP-1, wave-1 compound-path.
- **Commit-lock nuance**: `status` ALWAYS prints "concurrent, do NOT commit" (written for a concurrent reader;
  doesn't compare caller to holder). The holder confirms via `heartbeat` (script refuses non-holders).
- **Agent transient death**: an agent can die on ConnectionRefused with its commits already ON the branch —
  re-check the branch tip + SendMessage-resume (the JWT agent finished this way twice).

## 🚦 STATE @ CLOSE
- git: main `c4332e0d`, 56 ahead of origin (0 behind), PUSH HELD. Working tree clean post-wrap.
- lock: RELEASED (S249). Next boot: `commit-lock.sh status` → 🟢 FREE → acquire on baton.
- worktrees: ~30 present (this session's ~15 fix/review + S248's + locked) — cleanup owed (dry-run).
- oracle 349/349 · gate 19954/0.

## pa.md directives in force
R1-R5 · S239 adversarial (incl PA-side + resumable-agent) · S138 R26 empirical · S67 file-delta + git-apply-3way
for concurrent same-file regions · S147 coherence · commit-lock (S250) · branch-baton (concurrent) · commit-to-main
only after authz (baton = authz; push separately held) · orchestrate-don't-grind + default-GO.

## Tags
#session-249 #close #verify-harden #20-fixes #jwt-auth-bypass #protect-cte #async-await-migration #4-fork-rulings
#parser-drain-path-1 #s239-earned-its-keep #branch-baton #commit-lock #push-held #56-ahead
