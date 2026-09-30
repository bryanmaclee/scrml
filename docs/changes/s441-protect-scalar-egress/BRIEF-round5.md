change-id: s441-protect-scalar-egress (round 5 — fresh agent)

SECURITY dispatch (HIGH). Continue the RATIFIED §14.8.9 protected-column egress work. You are a FRESH agent; the previous one ran out of context after round 4. Its branch is your starting point.

CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE (incident counter: 0 this session)
1. `pwd` MUST start with `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-`; `git rev-parse --show-toplevel` == pwd; tree clean. Else STOP and report.
2. Then: `git fetch origin && git reset --hard origin/worktree-agent-a8aefdb4c19a10c1a` (expected tip 049390932 — a merge of main into round 4) and `git merge origin/main` (resolve conflicts as real 3-way merges; `docs/FACTS.md` is generated — take either side then `bun scripts/facts.ts --write`; `docs/known-gaps.md` is MIXED — resolve only the generated count hunk, keep BOTH sides' entries). Commit the merge.
3. `bun install`; `bun run pretest` plainly from the worktree CWD (`bun --cwd … run` silently no-ops).
4. Every Edit/Write: absolute path UNDER your worktree. Never `cd` into /home/bryan-maclee/scrmlMaster/scrml (main). NEVER `git stash`. NEVER `pkill -f`/`killall` on a shared command string. Scratch under your worktree or /tmp/claude-1000/-home-bryan-maclee-scrmlMaster-scrml/d50df1ca-2c06-4400-933e-9f464e169732/scratchpad/s443-protect/.
5. Append this prompt verbatim to `docs/changes/s441-protect-scalar-egress/BRIEF-round5.md` and a `progress.md` line; first commit `WIP(s441-protect-scalar-egress r5): start at $(pwd)`. Commit after every meaningful change (code + test together). Foreground commits, timeout ≥300s. Never `--no-verify`, never touch core.hooksPath. `git commit -F <file>` for messages with backticks/`${}`.
6. Parallel siblings are live: one agent is fixing `<page auth>` / nested `<program auth>` gating (route-inference.ts, emit-server.ts auth middleware); one is on `<program>` body prose (ast-builder.js). Keep edits to the protect path.

READ FIRST: `docs/changes/s441-protect-scalar-egress/` (BRIEF.md, progress.md — the whole history of rounds 1-4), and SPEC §14.8.9 on your branch IN FULL (it carries the S441 amendment text). Rulings (authority: /home/bryan-maclee/scrmlMaster/scrml-support/user-voice-scrml.md §S441): "ratify 14.8.9"; "ratify with the changes, arithmetic stays protected" — N3 closed: arithmetic/unary on a protected value is PROTECTED; `reveal("col")` is the sole declassify path; char-oracles / control-dependence are disclosed OUT of scope.

MAPS — REQUIRED FIRST READ: `.claude/maps/primary.map.md` (stamp cf62b415 — verify against source). Report whether load-bearing.

ROUND 5 — the round-4 review verdict was DO-NOT-LAND. These findings are REVIEWER-REPORTED and RELAYED-UNVERIFIED: reproduce each by EXECUTION (serve the build over HTTP and inspect the response body, as the reviewer did) BEFORE fixing; if one does not reproduce, say so with your evidence and do not "fix" it.
1. CRIT — `.length` is treated as a derived non-protected value on ANY receiver (protect-flow.ts ~1289, PA-located-verify) → `({length: h}).length`, `new Array(u.pin).length` ship the protected value. Fix: only a string-like/array receiver's `.length` is a derived length; anything else carries the receiver's protection.
2. HIGH — round-4 F3 half-done: tags record the SURFACE spelling (`["PASSWORDHASH"]`) but the redactor compares exact-case → `SELECT PASSWORDHASH … return u` ships the hash. Normalise case at tag AND redactor AND flow (SQL identifiers are case-insensitive). The existing conformance case only tested the scalar path — add the row path.
3. HIGH (also on main) — SQL-expression / quoted / bracketed / subquery output columns get NO descriptor → `passwordHash||'' AS x`, `lower()/hex()/CAST/substr/coalesce/json_object/group_concat`, `pin+0 AS x` ship. Fix, fail-closed: any output column whose expression references a protected column (case-insensitively, incl. quoted `"passwordHash"`, `[passwordHash]`, backticks, table-qualified) OR whose source cannot be resolved → treat the row as `cols:"*"` (strip/refuse per the §14.8.9 row rule). Case-matching for this must be structural over the SQL you already parse, not a new text regex (contract Rule 7) — if only text is available at that point, justify in one line.
4. HIGH — round-4 F2: element-returning collection methods don't join the alias class: `arr.find(..).x = h`, `filter/at/pop/sort`, `Map.get`, `Object.values`, iterator `.next().value`, `WeakMap.get`, `Object.setPrototypeOf`.
NIT — `reveal("PIN")` is case-sensitive (fails closed — make it case-insensitive to match SQL).
STOP CONDITION (set now): if fixing one of these makes you reach for a smarter text heuristic, or a self-check finds a NEW leak of your own making, prefer the fail-closed over-approximation (treat as protected) over a smarter recognizer. Report every place you chose over-approximation.

HOLD these (verified good in round 4 — do not regress): F1 (keys all the way down), arithmetic-stays-protected, reveal() soundness, no regressions (examples 34/34, conformance 1094/1101 at round 4).

MEASURED MIGRATION: compile `examples/`, `samples/`, `conformance/cases/`, `docs/readme-snippets/`, `stdlib/` before (on origin/main) and after; report files whose diagnostics change (count + list) — any new E-PROTECT-006 in a real example is a finding to report, not silently migrate.

PHASE 3 — EMPIRICAL (do NOT mark DONE without it): a served-over-HTTP probe for each of findings 1-4 showing the response body before (on your merged base) and after. Then `bun test compiler/tests/unit compiler/tests/integration compiler/tests/conformance --bail` (0 fail) + `bun conformance/run.ts`.

`git push origin HEAD:worktree-agent-a8aefdb4c19a10c1a` is NOT what you do — push YOUR branch: `git push -u origin HEAD` (standing authorization). REPORT: worktree path, branch, FINAL SHA, files touched, per-finding reproduced?/fixed/over-approximated, SPEC text changed (quoted), migration list, suite numbers, deferred items. `git status` clean before DONE.
