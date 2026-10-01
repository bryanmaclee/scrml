change-id: s447-dev-db-r5

## CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE (path-discipline incidents to date: track yours, report 0 or N)
1. `pwd` MUST start with `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-`. `git rev-parse --show-toplevel` must equal it. Clean tree. If ANY check fails: STOP, report, exit.
2. `bun install` then `bun run pretest` (run plainly from the worktree CWD — `bun --cwd <path> run` silently no-ops).
3. EVERY Write/Edit uses an absolute path UNDER your worktree root. Never `cd` into /home/bryan-maclee/scrmlMaster/scrml (main). Use `git -C "$WT"`. NEVER `git stash` (shared across worktrees) — flip base/build by file copy. NEVER bare `pkill -f`/`killall` — kill by captured PID.
4. First commit: write this whole prompt verbatim to docs/changes/s447-dev-db-r5/BRIEF.md and commit it as `WIP(s447-dev-db-r5): start at $(pwd)`.
5. Commit after each meaningful change; keep docs/changes/s447-dev-db-r5/progress.md (append-only, timestamped). Code and its tests are ONE commit (never a transiently-red split). Never --no-verify; never touch core.hooksPath.

MAPS — REQUIRED FIRST READ: /home/bryan-maclee/scrmlMaster/scrml/.claude/maps/primary.map.md (stamp 464c9ab4d, 2026-10-01; post-map landings: #1201 program-role-by-ancestor, #1204/#1205 docs). Follow its Task-Shape Routing; treat it as a verify-against-source hypothesis. Report whether it was load-bearing.

## Task
Finish the dev-db arc (S445). The prior work is on LOCAL branch `worktree-agent-a357de622e258554c` @ a1123e931 (also on origin). Your worktree is cut from origin/main. Step 1 after startup: `git merge worktree-agent-a357de622e258554c` (it carries 3 review rounds), then `git merge origin/main` if still behind; resolve real 3-way conflicts (generated counts in SPEC-INDEX/FACTS/known-gaps: take main + regen via `bun run scripts/regen-spec-index.ts`, `bun scripts/facts.ts`, `bun scripts/state.ts --write`). Read the branch's commit messages and docs/changes/s445-dev-db-side-file/ (if present on that branch) to absorb the design.

Rulings (verbatim authority: /home/bryan-maclee/scrmlMaster/scrml-support/user-voice-scrml.md §S445, "db= resolution + creation" item 6 and "a built server's data root; ownership is per declaring file"): dev/compile — `db=` resolves against the declaring .scrml file's directory; only a file that declares its schema (CREATE TABLE / <schema>) owns and may create the db; referencing handles open lazily and fail loudly if missing. Built server — paths recorded project-root-relative, resolved at runtime against SCRML_DATA_DIR ?? project root; Docker/Fly adapters set SCRML_DATA_DIR.

### Round-4 review = LAND-WITH-NITS. Fix R4-1 (required), then the nits:
- **R4-1 (MED-HIGH):** an OWNING db outside the project root (e.g. `db="../../shared/app.db"`) is recorded ABSOLUTE and ignores SCRML_DATA_DIR → in a container it is created at the build machine's absolute path (ephemeral layer, lost on redeploy). Fix: at runtime, when SCRML_DATA_DIR is set and an owning handle's recorded path is absolute and the file is missing → REFUSE loudly (name the path + SCRML_DATA_DIR + the fix), never create. Plus a build-time warning for outside-root db paths on deploy targets (docker/fly/render/railway). Fail closed.
- R4-2: no scrml.toml/.git → recorded path depends on build composition; emit a warning suggesting scrml.toml.
- R4-3: a REFERENCING app passes the Fly health check with its db missing — when SCRML_DATA_DIR is set, startup/health should check referencing db files exist (fail loudly, or health 503 — pick the minimal fail-closed option, justify it).
- R4-4: `scrml build` prints "databases expected under $SCRML_DATA_DIR: <path> (owning — created on first run) / <path> (referencing — seed it)".
- R4-5: absolute `_scrml_project_root` baked into .server.js — NOT client-visible; document as known, do not fix unless trivial. Relative SCRML_DATA_DIR resolves against CWD — document in the warning text.
Each fix gets a test. The previous reviewer harness (reuse ideas, read-only): /tmp/claude-1000/-home-bryan-maclee-scrmlMaster-scrml/777e6bc5-4a13-4cb4-b3a0-497aaeb21665/scratchpad/rev-devdb-work/ (deploy-A/, deploy-B/, d4/, p4/, flo4*).

### Empirical phase (mandatory — "tests pass" is not done)
Reproduce R4-1 on the merged-but-unfixed branch FIRST (build a project with an owning outside-root db, run the built server with SCRML_DATA_DIR set to a temp dir, show the file appears at the absolute path), then show after the fix it refuses. Also re-run: examples/09 (self-bootstrap owning idiom) dev + build; a referencing-only program with missing db → loud error. Record commands + outputs in progress.md. Do NOT mark done without these.

Governing sentences: quote the S445 ruling lines above in progress.md (this is a semantics change to the runtime path; direction-of-change: R4-1 is newly-rejecting at runtime).

Also: the full local suite — `bun test compiler/tests/{unit,integration,conformance}` plus `compiler/tests/commands/` (the db tests live there) and any top-level compiler/tests/*.test.js touching db. Before running, note that leaked `scrml dev --__dev-child` servers from earlier runs can starve tests: list `ps` for scrml-dev processes; do NOT kill processes you did not start — report them.

Final report: worktree path, FINAL_SHA, files touched, each R4 item fixed/deferred with evidence, empirical outputs, test counts, path-discipline incidents.
