> ## ⚠️ CROSS-MACHINE — Peter/Windows S254 also wrapped (2026-07-15), AFTER this S255 hand-off
> A concurrent Windows-seat session (Peter, `pjoliver11`) landed **two PRs to main after S255 wrapped**:
> **PR #37** (`95a912c` — 150-file `.pathname`→`fileURLToPath` codemod + reset-gap) and **PR #43**
> (`a4192be` — cross-OS hardening partial, reviewed 16-agent high: `isStdlibFile`→single #26 gate ·
> posix `deriveWatchFiles` · `os.tmpdir()` test portability · `docs/cross-os-invariants.md`). Windows
> `unit+conformance` **59→37 fails, 0 regressions; POSIX no-op**. Absorb delta-log **[513]-[516]**.
> **Top Windows arc for next boot:** the **path-model canonicalization refactor** — the 37 remaining are
> ONE root cause (inconsistent native/posix path KEYS); design + rejected-approaches (474-fail
> entry-norm) in `scrml-support/docs/deep-dives/windows-path-model-canonicalization-2026-07-14.md`.
> It's security-adjacent (#26) + defines the cross-OS path *contract* → **Bryan-adjacent, own reviewed arc.**
> Housekeeping: stale remote branch `s254-windows-pathname-fix` (delete needs naming). scrml-support @ `86d5c71`.
> _(bryan's S255 wrap follows, unchanged.)_

# scrml — Session 255 (WRAP) — ⭐ Track-A Units 1+2 landed + PA-contract PR-flow migration + advisory review + Windows CI

**Date:** 2026-07-14/15. **Profile:** A (`/boot`). A very large multi-arc session: migrated the PA contract to
the S254 PR-flow model, built the advisory cloud review + the Windows CI, then scoped **Track A
(server-program-shape)** and landed its first two units — the `emit-server` decouple + the
`kind="tool" serve=` harness. Coordinated a concurrent Peter (pjoliver11) session that self-merged PR #37.

## ⚠️ READ FIRST — state as of close
- **main = `74e22ea3`**, both repos 0/0, CI `gate` GREEN. PR-flow is the norm (branch → PR → gate → merge).
- **Track A: Units 1 + 2 LANDED.** A `<program kind="tool" serve=PORT>` now hosts native `<endpoint>`/SSE
  off a compiler-emitted `Bun.serve`. Units 3-6 remain (see OPEN THREADS).
- **Advisory review is BROKEN pending a decision** — the `claude-code-action` workflow (PR #33) + its OIDC
  fix (PR #35) are in, but the run fails: **"Claude Code is not installed on this repository"**. FIX:
  either bryan installs the **Claude Code GitHub App** (github.com/apps/claude → install on scrml; the clean
  fix, branded identity) OR add `github_token: ${{ secrets.GITHUB_TOKEN }}` to the workflow to skip the
  App (PA can PR that; github-actions[bot] identity). Non-blocking (off required checks) — harmless red.
- **The PA contract is MIGRATED** to PR-flow (overlay v2 + boot manifest + thin read + board banner). Trust
  the migrated contract now (not the pre-S254 direct-commit/commit-lock language).

## ✅ LANDED THIS SESSION (all via PR-flow)
1. **PA-contract → PR-flow migration** — scrml-support `45633d8` (overlay v2 · pa-core · README banner · S255 board) + PR #32 (`.pa-base/profile`). The top S255 task; done.
2. **Advisory cloud review** — PR #33 (workflow) + PR #35 (OIDC `id-token: write`). Secret set. **Blocked on the App-install decision above.**
3. **Windows CI** — PR #36: a NON-BLOCKING `windows-latest` job (unit+conformance). Confirmed working: **16061 pass / 926 fail** on Windows (the OS-path gap Peter's been the canary for, now automated). Promote to the blocking `gate` once green.
4. **Track A Unit 1 (Fork 2A decouple)** — PR #34 (`0bb16591`). `generateServerJs` gains a `programShape` axis; `<endpoint>`/SSE route+fetch emit is program-shape-agnostic; `generateHeadlessServerJs` export. Byte-identical web-app. **3 adversarial review rounds** (see NARRATIVES).
5. **Track A Unit 2 (Fork 1A serve-harness)** — PR #38 (`74e22ea3`). `serve=`/`cors=` on `kind="tool"`; `Bun.serve` mounting the headless routes; main-optional (§64.3); the cookie-auth guardrail; new §64.9 SPEC + 4 `E-TOOL-SERVE-*` codes + `E-TOOL-ROUTE-NEEDS-SERVE`. **1 fix round** (6 review bugs).
6. **Peter's PR #37** (concurrent) — his 150-file `.pathname→fileURLToPath` Windows codemod (#25/#26 class) self-merged via PR-flow. Disjoint from our work; the multi-contributor model working as designed.

## 📋 OPEN THREADS / FORKS
1. **Advisory review App-install vs github_token** — decide (above). Non-blocking.
2. **Track A Units 3-6** (from the DD `server-program-shape-2026-07-12.md`, per SCOPING `docs/changes/server-program-shape-v1/SCOPING.md`):
   - **Unit 3 — Fork 5A:** `route.header(name)` + `route.frameId` (request-frame access).
   - **Unit 4 — Fork 4A:** JSON-RPC discriminator + wire-tag remap on `accepts=`.
   - **Unit 5 — H4 + H1:** GET-discovery (no-`accepts=` endpoint) + notification-204.
   - **Unit 6 — Fork 6A:** bearer `<guard>` arm (6C `handle()` is the interim). **This is the "headless auth" story deferred all through Units 1+2** — until it lands, a headless serve= program's routes/channels have no auth guard (Unit 2 fail-closes cookie-auth via E-TOOL-SERVE-AUTH-UNSUPPORTED).
   - **Fork 3 (stdio)** = fast-follow/post-V1 (bryan ruled via flogence inbox this session).
   - **DoD / merge-blocker:** flogence `fsp-wire-smoke` (11 assertions) re-hosted on the scrml-native server + a conformance case.
3. **Peter's GitHub issues (all his):** #26 (P0 Windows auth-bypass) **FIXED on main** (`66483cdf`) — **closeable** (was awaiting his Windows sign-off). #25 (nested-pages prefix) **fixed via #37**, closeable. #27 (navigate soft-nav) — navigate Wave-1b landed S251; likely stale, **triage**. #28 (markup `>`→`>=`), #29 (auth example 4 codegen bugs) — **untriaged**.
4. **2 pre-existing gaps filed** (Unit-1 review surfaced, NOT decouple regressions): `g-currentuser-plain-handler-dangling` + `g-channel-auth-only-authcheck-dangling` (both MED, both real ReferenceErrors). See known-gaps.

## 🔬 IRREDUCIBLE NARRATIVES (anomalies + what to watch)
- **The adversarial gate caught real bugs on BOTH units — twice on MY spec, not just agent error.** Unit 1: 3 rounds (round 1 a dangling auth ref; round 2 an over/under-emit *I* caused with a wrong fix-brief that told the agent to make cookie-auth work in headless — WRONG, headless auth is bearer; round 3 the clean subtractive gate-off-and-defer). Unit 2: 1 round (6 bugs incl. a channel-auth fail-open — my guardrail spec only checked program-level auth). **Lesson: the mandatory `/code-review` is load-bearing; write fix-briefs that gate-OFF-and-defer, don't "make it work."**
- **Unit 2 agent STALLED during finalization** (stream watchdog, post-commit) — salvaged from the committed branch tip (`8d9f6593`, worktree clean); the work + gate (20176/0) were done before the stall. [[feedback_agent_notification_transient_disconnect_resume]] [[feedback_agent_crash_partial_recovery]].
- **PR #37 base-drift mid-Unit-2** — Peter self-merged his codemod while Unit 2 ran; main moved under it. Verified zero file overlap (his 150 files, 0 in compiler/src), rebased Unit 2 onto #37, re-ran R26 on the new base. **Watch: a concurrent Peter session can move main any time now.** [[feedback_file_delta_vs_cherry_pick]] [[feedback_parallel_dispatch_shared_test_baseline]].
- **The wrap stash tangle** — my uncommitted bookkeeping (known-gaps) collided with #37's known-gaps changes; stashed it aside to land Unit 2, popped + 3-way-merged at wrap (both survived). The stash also carried a stale Unit-2 snapshot that conflicted with the landed version → resolved by taking HEAD.
- **Commit-hook timeouts** — the pre-commit gate now runs ~5min (20176+ tests under load); foreground commits timed out at the 5min wrapper but ALWAYS finalized (verify git STATE, not the exit code). [[feedback_commit_hook_timeout_and_F_flag]].
- **claude-code-guide was wrong twice** on the advisory setup (id-token commented out; "no App needed"). Verify Claude tooling against actual runs, not just its guidance.

## 🚦 STATE @ CLOSE
- git: main `74e22ea3` (Units 1+2 + #37 + all infra), 0/0. scrml-support pushed (contract migration).
- Conformance 41 categories; full gate 20176/0 (Unit-2 PR). CI `gate` GREEN on main.
- **Worktrees: 22 agent worktrees exist.** This session's 2 (Unit 1 `agent-a1ef88d0`, Unit 2 `agent-a485f1c4`) cleaned at wrap. **~20 stale from prior sessions — broad sweep still OWED** (S83 disk risk; dry-run first per discipline).
- **Maps: ~130 commits behind** (stamped `fbb4d9fd`, 2026-07-09). Refresh OWED (navigated by grep all session; a project-mapper refresh is a next-session task).
- Mechanical state: `handOffs/delta-log.md` `[505]+` + `docs/changelog.md` S255.

## pa.md directives in force
R1-R5 · **PR-flow (branch→PR→gate→merge; NO direct main push)** · S239 mandatory adversarial `/code-review` pre-land (caught bugs on both units) · S138 R26 · orchestrate-don't-grind · default-GO · the deliberation ladder · Peter is a live concurrent contributor (PR-flow coordinates).

## Tags
#session-255 #track-a-server-program-shape #unit1-decouple-LANDED #unit2-serve-harness-LANDED
#pa-contract-pr-flow-MIGRATED #advisory-review-app-install-PENDING #windows-ci-LANDED
#peter-pr37-concurrent #adversarial-gate-caught-both-units #agent-stall-salvaged #maps-130-behind-owed
#worktree-sweep-owed #track-a-units-3-6-remain #big-session
