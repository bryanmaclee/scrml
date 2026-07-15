# scrml — Session 256 (WRAP) — ⭐ Cross-OS path-model canonicalization landed to PR #55 (Windows +25 fixes, 0 regressions)

**Date:** 2026-07-15. **Seat:** Peter / `pjoliver11` (Windows). **Profile:** A (`/boot`). Continued the
S255→S256 tee-up: cleared the smaller GitHub issues, then executed the **top Windows arc** — the path-model
canonicalization refactor from deep-dive `windows-path-model-canonicalization-2026-07-14.md` ([515]).

## ⚠️ READ FIRST — state as of close
- **PR #55 is OPEN, blocking Linux `gate` is GREEN, awaiting a HUMAN merge.** I did NOT self-merge (PR-flow +
  the auto-classifier require human review). **First action next boot: `gh pr view 55`.** If merged → the
  path model is on main and `scrml:path` is the only remaining Windows arc; if not → ping Bryan/Peter to merge.
- **`origin/main` = `d5b3c77`** (advanced via #52 etc. since the S255 hand-off's `74e22ea3` — the hand-off doc
  lagged, normal under PR-flow). PR #55 forked earlier; the cloud gate tests the merge-with-current-main and
  PASSED, so it's mergeable. If GitHub flags a conflict it'll be trivial (docs vs compiler/src).
- **`module-resolver.js` runtime is UNCHANGED by the #26 fork resolution** — only the #26 TEST changed. The
  sep-aware carve-out stands (Peter ruled Option A). No security behavior changed.

## ✅ LANDED / IN-FLIGHT THIS SESSION
1. **⭐ Path-model canonicalization — PR #55** (2 commits: `61df239` refactor + `a0c22c2` #26 test adapt).
   One `path-canonical.js` boundary (`toPosix` **sep-aware** + `PathKeyedMap`/`PathKeyedSet`); posix INTERNAL
   keys, **native-uniform `filePath`** (public `outputs` contract — gathered files use the newly-exported
   `resolveModulePathNative`, NOT posix, so the 474-fail-class native comparisons stay intact); hybrid
   drive-aware resolve (`C:\`/`\\`/`//`→native, drive-less→`path.posix`). **`/code-review high` (16-agent) → 5
   findings all fixed**, incl. a native-value correction that closed a **latent desync the review missed**
   (tool-dep-closure walk `codegen/index.ts:942`). **Rigorous stash-diff: main 17060/61 → branch 17093/36 =
   0 regressions, +25 Windows cross-file fixes.** windows-latest CI 17191/47skip/12fail (all pre-existing).
2. **#25 Windows nested-page routes 404 — PR #48 (`85efaf7`, MERGED).** Sep-aware `stripPagesPrefix`. The
   S255 hand-off's "#25 fixed via #37" was WRONG (verified against code) — fixed properly. **#25 closeable.**
3. **#26 verified already-fixed → closeable.** **#28** diagnosed 2 RCs: RC1 fixed on WIP branch
   `fix/issue-28-markup-gte-swallow` (no PR); RC2 grammar-fork PAUSED for Bryan ("he's on it").

## 📋 OPEN THREADS / FORKS
1. **`scrml:path` stdlib — DEFERRED behind Bryan's ruling** (the 12 remaining windows fails). Q: *what does an
   absolute path MEAN on Windows — keep the drive?* `path.posix` drops the drive letter + mangles native `..`
   ([514]). This is the last Windows arc after PR #55 merges. Bryan-owned semantics decision.
2. **#28 RC2 grammar fork** (markup `>`/`>=` close-check direction + unclosed-edge) — **Bryan owns**, in flight
   his end. RC1 fix sits un-PR'd on `fix/issue-28-markup-gte-swallow`. **#27** (navigate soft-nav — likely
   stale, triage) and **#29** (auth example 4 codegen bugs) untouched.
3. **INHERITED from S255 (Bryan, still open):** (a) **Track A Units 3-6** (server-program-shape — Unit 3
   `route.header`/`frameId`, Unit 4 JSON-RPC discriminator, Unit 5 GET-discovery+204, **Unit 6 bearer `<guard>`
   = the deferred headless-auth story**); DoD = flogence `fsp-wire-smoke` re-hosted + a conformance case.
   (b) **Advisory cloud review BROKEN** pending the Claude-Code-GitHub-App install vs `github_token` fallback
   decision (non-blocking red). See archived `handOffs/hand-off-255.md` for full detail.

## 🔬 IRREDUCIBLE NARRATIVES (anomalies + what to watch)
- **The first cloud gate caught a real Linux-only regression I'd missed locally** — my sep-aware
  `isStdlibFilePath` (deep-dive-ordered) broke the #26 P0 auth-bypass test, which SYNTHESIZES Windows backslash
  paths on the Linux gate (unconditional-fold-dependent). Sep-awareness and that synthesis are mutually
  exclusive. **Resolved per Peter's Option A** (surfaced as a load-bearing security fork): keep the sep-aware
  carve-out; gate the 3 synthetic-Windows assertions behind `sep==="\\"` → run FOR REAL on windows-latest (the
  runner the test's "WITHOUT a Windows runner" note predates). **Lesson (→ memory
  `cross-os-forced-posix-presubmit`): run the touched security suite under a forced-POSIX sim BEFORE pushing a
  cross-OS change** — a local-Windows baseline hides the Linux-only divergence; I burned a cloud cycle finding it.
- **The review's finding-1 pushed toward POSIX gathered filePaths; that was the WRONG fix** — it would re-open
  the 474-fail class in every native `filePath` comparison. Keeping gathered values native (exported
  `resolveModulePathNative`) is the deeper-correct fix AND it surfaced the latent `visitDeps` desync the review
  itself missed. Checking the "obvious" review fix against the invariant paid off.
- **Watch: a concurrent Bryan/Ryan session can move main any time** (PR-flow). PR #55 forked off an older main;
  re-check mergeability if main churns before merge.

## 🚦 STATE @ CLOSE
- git (scrml): branch `fix/path-model-canonicalization` @ `a0c22c2`, pushed, **working tree clean**. `origin/main`
  `d5b3c77`. Only the main checkout worktree (no agent worktrees this session). scrml-support clean 0/0.
- **Gate:** blocking Linux `gate` GREEN on PR #55; local unit+conformance 17093/36 (subset of main's fails);
  windows-latest 17191/47skip/12fail (all pre-existing backlog); TodoMVC gauntlet + R26 adopters green.
- **Maps: UNCHANGED this session** — no code landed to main (PR #55 unmerged); a refresh follows the merge.
  (Still ~130+ behind from prior sessions — a standing refresh is owed, Bryan-side per S255.)
- Mechanical state: `handOffs/delta-log.md` **[517]-[521]** + `docs/changelog.md` S256 block. Memory:
  `~/.claude/.../memory/cross-os-forced-posix-presubmit.md`.

## pa.md directives in force
R1-R5 · **PR-flow (branch→PR→gate→HUMAN-merge; NO direct main push, NO self-merge)** · S239 mandatory
adversarial `/code-review high` pre-land (caught the Linux regression + 5 findings) · **surface load-bearing
security forks to the operator** (Option A carve-out ruling) · shoot-straight (verify-before-closing, rigorous
stash-diff not a stored baseline) · Peter is a live concurrent contributor.

## Tags
#session-256 #peter-windows #path-model-canonicalization-PR55-OPEN #gate-green-awaiting-human-merge
#plus25-windows-fixes-0-regressions #issue-25-LANDED-PR48 #issue-26-carve-out-fork-option-A
#scrml-path-DEFERRED-bryan-ruling #issue-28-RC2-bryan #track-a-units-3-6-inherited #advisory-review-app-PENDING
#forced-posix-presubmit-lesson
