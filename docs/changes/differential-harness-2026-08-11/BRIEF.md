# BRIEF — fix `corpus-emit-differential.ts` BEFORE it becomes a gate

**Dispatched:** 2026-08-11 (S338-bryan) · **Base:** `fix/differential-harness` off `origin/main`
**Ruled:** bryan S338 — *"fix the differential harness before it becomes a gate"*
**Provenance:** `ruling:user-voice-scrml.md S338`

---

## CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE (F4)

1. `pwd` MUST start with `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-`.
   If it is `/home/bryan-maclee/scrmlMaster/scrml` you are in the SHARED CHECKOUT: **STOP and report.**
2. `git rev-parse --show-toplevel` MUST equal that worktree path. 3. `git status --short` clean.
4. `bun install`. 5. `bun run pretest`; use `bun run test`, never bare `bun test`, for baselines.

Worktree-absolute paths on every Read/Write/Edit. NEVER `cd` into the main checkout — use
`--cwd "$WORKTREE_ROOT"` and `git -C "$WORKTREE_ROOT"`. Echo your startup `pwd` in your first commit.
**Scratchpad unique to you:** `…/scratchpad/harness-fix/`.

**Crash recovery:** commit after EACH meaningful change; `progress.md` in this change directory,
append-only, timestamped. Three agents died mid-task today; one lost a finding that existed nowhere
on disk.

**MAPS:** read `.claude/maps/primary.map.md` + its Task-Shape Routing. Stamp `616688ea` is behind HEAD;
treat map claims as hypotheses. Report which map content was load-bearing, "none" included.

---

## WHY THIS IS URGENT

`scripts/corpus-emit-differential.ts` is named by **dpa-025** as *"the only detector on the board for
the silent-miscompile class that conformance pins are blind to"*, and dpa-025 recommends **promoting it
to a standing gate**. bryan ruled: **fix it first.** An instrument with silent lying modes cannot become
a gate — that is the §8 hollow-gate shape arriving before the gate does.

**Two independent silent failure modes were found TODAY, by two different adversarial reviewers, neither
of whom was looking for them.** Both produce a well-formed report of a WRONG ANSWER. Neither gives the
reader any hint.

### DEFECT 1 — project-root divergence poisons every content comparison

`nsId` is `fnv1aHash(projectRootRelativeSourcePath)`. A reference tree extracted with `git archive` has
no `.git`, so the compiler's project-root resolution lands somewhere else and **every namespaced token
changes**. One capture reported **1014 content diffs**; `mkdir .git` in the reference tree took the same
comparison to **0 of 7375**.

**A capture whose two sides resolved different project roots cannot compare emit content at all.** The
manifest records `revision` (`:189`, `gitRevision()` at `:1008`) but nothing about the resolved project
root, and `diff` has no way to detect the mismatch.

### DEFECT 2 — concurrency manufactures phantom compile failures

At the default `--concurrency 10` (`:1532`), a capture reported **8 newly-failing sources, 8 diagnostic
changes and 27 removed artifacts**. Direct in-process compilation of those same sources under both
compilers was **identical**, and a re-capture matched the control exactly. `compileOne` (`:1028`) spawns
one `bun …/cli.js compile` per source with a shared `cwd: opts.compilerRoot`; ten at a time.

**PA-located, VERIFY:** I have not root-caused the race. Do not assume it is resource exhaustion —
measure. Report what you find; if you cannot root-cause it, the mitigation below still stands.

---

## THE FIX — make it REFUSE, never report a wrong answer

The instrument already has the right vocabulary: exit **2 = NOT A VALID COMPARISON**, and a banner that
*"NEVER says NO DIFFERENCES on a run that was not a valid comparison"* (`:1421-1431`). Both fixes route
into that existing machinery. **Do not invent a fourth reporting mode.**

### A1 — record the resolved project root in the manifest; refuse on mismatch

- **Capture side:** resolve and record the project root exactly as the compiler resolves it — find the
  compiler's own resolver (the reviewer named `resolveProjectRoot`; **verify that symbol exists and is
  the one `nsId` keys off** — this locus is PA-asserted, not traced) and record BOTH the resolved root
  and whether a `.git` was found. Put it in `Manifest` beside `revision` (`:184-190`).
- **Diff side:** if the two manifests' project-root *shape* differs in any way that changes
  `projectRootRelativeSourcePath`, mark the run **INCOMPARABLE** and exit 2, naming the reason and the
  remedy (`mkdir .git` in the reference tree). This joins the existing same-revision and unknown-revision
  guards at `:1150-1159` — read those and follow their shape exactly.
- The failure must be **impossible to misread**: a reader who sees 1014 content diffs must see, in the
  banner, that the comparison was invalid.

### A2 — re-verify the DELTA serially before reporting it

Do **not** serialize the whole run — 1904 sources at concurrency 1 is not an acceptable trade, and
failures are legitimately common (~680 of 1904 corpus files do not compile standalone; that is DATA,
per HARD REQ 5 at `:748`).

**The signal is the failure SET changing.** So the only outcomes that matter are the ones that DIFFER
between captures. At diff time, for every source whose compile outcome differs (newly-failing,
newly-passing) **and** for every source with an artifact-content difference, **re-compile it serially,
on both compilers, and confirm the difference reproduces.**

- A difference that does NOT reproduce serially is a **HARNESS FLAKE**: report it loudly under its own
  heading with the count, and EXCLUDE it from the findings total.
- A difference that DOES reproduce is a real finding and reports as today.
- If the flake count is non-zero, the banner says so. A run that had to discard flakes is not a clean run.

This bounds the extra work to the delta (~8 sources in the witnessed case), not the population.

### A3 — prove the bite, both ways

A gate that has never failed is indistinguishable from one that cannot fail (§8). For EACH fix:

- **A1:** construct a capture pair with divergent project roots; confirm exit 2 + the banner. Then fix
  the root and confirm it drops to 0 differences. **Both directions.**
- **A2:** inject a deterministic phantom (e.g. a wrapper that fails a chosen source only on the first
  attempt); confirm it is caught, reported as a flake, and excluded from the total. Then confirm a REAL
  difference still reports as a finding and is NOT swallowed by the re-verification.

**A2's swallow-risk is the one to watch:** a re-verification that quietly reclassifies real findings as
flakes would convert this instrument from one that lies loudly into one that lies quietly. Test that
explicitly and say so in `progress.md`.

---

## CONSTRAINTS

- **Rule 7 binds you** (`pa-scrml-overlay.md`, ruled today): a regex over SOURCE TEXT in a POST-AST stage
  needs a justification or the structural route. This script is not a compiler stage, but the spirit
  applies to how you detect the root — **resolve it, do not pattern-match a path string.**
- Do not change what the instrument MEASURES. This is about refusing to report wrong answers, not about
  new coverage.
- Keep the existing HARD REQ comments accurate; if a fix makes one stale, update it. **A wrong in-source
  rationale is worse than none** — this file already carries several hard-won ones and they are load-bearing.
- **`docs/known-gaps.md` is OFF LIMITS** (contended by two other agents). Report gap text in `progress.md`.

---

## VERIFICATION — DO NOT REPORT DONE WITHOUT THIS

1. Both bite proofs above, both directions, with the exact commands and observed output.
2. A real end-to-end run of the fixed instrument on two genuinely different refs, showing it still finds
   real differences.
3. A self-diff (`--allow-same-revision`) still reports 0 — the determinism control must survive.
4. `bun run test` — compare failure **NAME SETS** against `origin/main`, not counts. **Do not quote a
   baseline count**: today's measurements gave 51 and 49 in different environments, differing only by
   which gitignored build dirs were present.
5. If you touch `compiler/src`, regenerate `docs/FACTS.md` AFTER your last content commit.

**Report:** files touched, final SHA, what landed vs deferred, every locus in this brief that turned out
WRONG (they are PA-located-verify, and one of them — the root-resolver symbol — I explicitly have not
traced), and anything you think this brief gets wrong. **You are authorized to argue against it**,
including arguing that A2's re-verification is the wrong mitigation and the race should be root-caused
and fixed instead. If you can root-cause the race cheaply, that is strictly better than mitigating it —
say so and do that.
