# BRIEF — s458-reexport-dev-tenant-current (bring an S457 branch current with main, re-verify; no new features)

CHANGE-ID: `s458-reexport-dev-tenant-current`. Agent: scrml-js-codegen-engineer, isolation worktree.

BASE: after the F4 startup checks, `git reset --hard 700cb88aa` (tip of local branch `worktree-agent-a32af25e7d4658f1a`; confirm
`git rev-parse worktree-agent-a32af25e7d4658f1a` starts with 700cb88aa), then `git merge origin/main`. Then your F4 step-3 BRIEF commit.

Context: that S457 branch (based at `0d8e9d8ce`) did two things, never reviewed, its agent never reported:
(A) `g-server-reexport-of-scrml-module-fails-to-link-s456` — a `.scrml` re-export (`export { X } from "./m.scrml"`, `export *`) reaches the
server bundle, the client registry and the page; a re-exported enum reaches the client (commits d9fad95ac, 700cb88aa).
(B) `g-tenant-startup-check-built-server-only-s456` — `scrml dev` runs the same undeclared-tenant-table startup check `_server.js` runs (4d2d91ad1;
it moved logic out of `commands/build.js` into `codegen/tenant-startup-check.ts`).
Read `docs/changes/s457-reexport-and-dev-tenant-check/BRIEF.md` + `progress.md` on the branch first.

Since its base, main landed S457 #1340–#1348 — notably #1348 (`§2.2.1`: any Error-severity diagnostic → NO artifact written, in compile / build /
dev / serve — touches build.js / dev.js / api.js), #1344 / #1342 (SQL reader + checks at every lowering), #1346 (`__scrml_` reserved, per-compilation
placeholder token, emit gate), #1341 (runtime URL guard in emitters), #1347. Merge conflicts are REAL 3-way merges: preserve BOTH sides' intent;
in particular the startup-check relocation must keep #1348's no-artifact-on-error behaviour and every tenant check main added since 0d8e9d8ce
(read `git log 0d8e9d8ce..origin/main -- compiler/src/commands/build.js compiler/src/codegen/tenant-startup-check.ts compiler/src/commands/dev.js`
and confirm each of those commits' behaviour survives — list them in progress.md with how you checked). Generated docs: take main's, then regenerate
(`bun run scripts/regen-spec-index.ts`, `bun scripts/facts.ts --write` — the one exception to F4 rule 9 is regenerating these two; never hand-edit).
`bun run types:check` must pass (bidirectional baseline — `--write` it in the same commit if the set changes).

Verify on the merged tree: the branch's own tests; the full gates per house rules incl. the browser-tier CI step; and EMPIRICALLY:
(A) a two-module program re-exporting a server function, a component and an enum from a `.scrml` module through an intermediate module, built with
`scrml build` and the server RUN: the server function answers, the page renders, the enum `match` works on the client; plus `export *`;
(B) `scrml dev` against a SQLite file with an undeclared `tenant_id` table: refuses/503s exactly as the built `_server.js` does (show both outputs), and a
clean db serves normally. Also confirm (B) does not break `scrml dev` on a project with NO database and on one using Postgres config without a live PG
(should not crash at startup).

Report the merge resolutions file by file. Do NOT add features or fix unrelated things — report them.

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
