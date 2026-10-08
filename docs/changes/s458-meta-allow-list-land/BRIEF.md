# BRIEF — s458-meta-allow-list-land (S458 ruling "1a")

CHANGE-ID: `s458-meta-allow-list-land`. Agent: scrml-js-codegen-engineer, isolation worktree.

BASE: this continues a finished-but-held S457 branch. After the F4 startup checks:
`git reset --hard c6efe94e7` (tip of local branch `worktree-agent-a34b579141955a680` — the S457 meta allow-list work; confirm
`git rev-parse worktree-agent-a34b579141955a680` == c6efe94e7… and that `c6efe94e7` is reachable), then `git merge origin/main`
(resolve conflicts as real 3-way merges; for generated docs — `docs/bootstrap-conformance.md`, `docs/FACTS.md`, `compiler/SPEC-INDEX.md` —
take main's version then REGENERATE, never hand-pick a side). Then do your F4 step-3 BRIEF commit.

Read first: `docs/changes/s457-meta-allow-list/progress.md` and `BRIEF.md` on that branch (the whole S457 story: the allow-list in
`compiler/src/meta-allow-list.ts`, meta-eval reader 2 + node:vm realm, the emit() output gate, SPEC §22.12 / §22.4.1 / §22.11 / §34 amendments).

Ruling (bryan, S458 verbatim "1a"): land the allow-list; (a) MIGRATE the one newly-refused corpus file
`samples/compilation-tests/gauntlet-s20-meta/meta-cleanup-001.scrml` (`setInterval` / `clearInterval` inside `^{}`) to the §22.5.1 runtime
`meta` API — `meta.interval` / `meta.clearInterval` (read §22.5.1 IN FULL for their exact signatures and semantics; preserve the file's
test intent — it is a cleanup test). The S457 agent's four closed-direction decisions STAND (no JS value builtins in `^{}`; prototype-member
refusal on every value; non-literal computed keys refused; destructured lambda params / markup values refused). The alternative at
`e22d6af01`-with-builtins is NOT taken.

Work:
1. Migrate the file; confirm it compiles clean on head and its runtime behaviour is equivalent (execute it if it has an executed test).
2. Re-measure the corpus by COMPILE, base (origin/main) vs head: newly-refused set must now be EMPTY; report every other artifact delta.
3. Regenerate `docs/bootstrap-conformance.md` (`--write`) if the conformance cases changed it; check `bun scripts/facts.ts --check`,
   `bun run scripts/regen-spec-index.ts` (SPEC changed — regenerate SPEC-INDEX on your branch; this is the ONE exception to F4 rule 9 for
   `compiler/SPEC-INDEX.md` and `docs/FACTS.md` — regenerate them, do not hand-edit), and `bun run types:check` (bidirectional — `--write`
   the baseline in the same commit if the set changes).
4. Make sure the SPEC text the S457 branch amended carries `> **Provenance:** ruling:user-voice-scrml.md S458 "1a"` alongside the S457 provenance.
5. Full test gates per the house rules (incl. the browser-tier CI step). Report the gap-entry flips for the PA:
   `g-meta-code-runs-unsandboxed-in-the-compiler-process-s457` (what is closed / what remains — the S457 hand-off lists residual (a)–(e) gap texts in
   the S457 report; restate them) and any new entries.

Empirical check: a `^{}` body using `emit.constructor`, `({}).constructor.constructor`, `globalThis`, `process`, `Bun`, and a non-literal computed key
is refused at compile time on head (show the diagnostics), and executes nothing (show no side effect file is written).

[SHARED BLOCK FOLLOWS]
## CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE (F4) — path-discipline incidents to date: 4 (S99) + S385 stash race + S456 cookie-jar leak

1. `pwd` — MUST start with `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-`. Otherwise STOP and report.
   `git rev-parse --show-toplevel` must equal `pwd`. `git status --short` must be clean.
2. Base: `git fetch origin`; follow the BASE line of your brief exactly.
3. Your FIRST commit archives this entire prompt verbatim to `docs/changes/<CHANGE-ID>/BRIEF.md` with the message
   `WIP(<CHANGE-ID>): start at $(pwd)` (the PA verifies the worktree prefix in this message).
4. `bun install` (worktrees do not inherit node_modules), then `bun run pretest` run plainly from the worktree CWD
   (NOT `bun --cwd <path> run …` — that silently no-ops). Verify `samples/compilation-tests/dist/` was populated.
5. Every Read/Edit/Write uses an ABSOLUTE path under YOUR worktree root. Never `cd` into `/home/bryan-maclee/scrmlMaster/scrml`
   (the main checkout). Use `git -C "$WT"`. Write NOTHING outside your worktree (scratch: `$WT/.tmp/`, delete before your final report).
   `TMPDIR` must NOT point inside any repo — leave it unset.
6. NEVER `git stash` (the stash is shared across every worktree). Base-vs-build flips by FILE COPY.
7. NEVER `pkill -f` / `killall` on a command string — kill only PIDs you started.
8. Commit after every meaningful change (WIP commits fine); keep `docs/changes/<CHANGE-ID>/progress.md` (append-only, timestamped).
   A clean `git status` + committed branch tip before your final report is mandatory. Do not push; the PA lands.
   The pre-commit hook runs the core suite (~4-6 min) — give commits a long timeout; never read a commit's success from a piped exit code, check `git log`.
9. Do NOT edit these shared, PA-owned docs: `docs/known-gaps.md`, `docs/FACTS.md`, `compiler/SPEC-INDEX.md`, `docs/changelog.md`,
   `master-list.md`, `hand-off.md`, `docs/pr-reviews.md`, `handOffs/**`. Put the gap-entry text you would write (new entries,
   status flips with resolved-by) in your final report; the PA applies it.
10. Never `--no-verify`, never change `core.hooksPath`, never disable a hook. If the pre-commit hook fails, fix the cause or report.

## MAPS — REQUIRED FIRST READ
Read `.claude/maps/primary.map.md` first (stamp `125486345`, refreshed S457; the maps PR #1350 may still be merging — if your tree has
the older `ba2712973` stamp, factor in the S457 landings #1340–#1348), follow its Task-Shape Routing to the 2-4 maps for your task,
treat map content as a hypothesis to verify against source. In your final report say which map entry was load-bearing (or "not load-bearing").

## Rules of the house (short)
- SPEC `compiler/SPEC.md` is normative. Read the governing section IN FULL (offset/limit) before changing behaviour; quote the governing sentence in progress.md.
- A locus named below is a PA HYPOTHESIS (located, not traced). Verify it; report whether it held, was refined, or was wrong.
- No `null`/`undefined` in scrml source; `not` is absence. No try/catch/async/await in scrml source.
- Before DONE: `bun test compiler/tests/unit compiler/tests/integration compiler/tests/conformance` (0 fail is the contract),
  `bun conformance/run.ts`, AND the browser-tier gate step exactly as `.github/workflows/ci.yml` runs it (pre-commit excludes it; S457 lost a CI round to stale browser pins),
  plus the empirical check named in your brief (an emitted-artifact / executed check, not "tests pass").
- Corpus measurement is by COMPILING (samples/, examples/, conformance/, stdlib/), base vs head — record command + counts.
- Final report: worktree path · branch · FINAL_SHA · files touched · tests run + results · empirical check output ·
  direction-of-change class (inert / newly-rejecting / newly-accepting / semantics-changed) with the measurement ·
  gap-entry text for the PA · anything deferred.
