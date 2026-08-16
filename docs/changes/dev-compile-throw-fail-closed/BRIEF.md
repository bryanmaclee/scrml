# BRIEF — `scrml dev` fail-closed on a compileScrml THROW + re-armed watcher on delete/rename (S346-bryan dispatch)

DONE-PROBE: grep -qE 'catch' compiler/src/commands/dev.js && grep -rqE 'throw|ENOENT|fail-closed|fail closed' compiler/tests/commands/*dev* 2>/dev/null

## The two defects — SAME FILE, one arc (read both ledger entries in `docs/known-gaps.md` IN FULL first)
1. **`g-dev-compile-throw-fail-open` (HIGH, S345).** PR #518 (adopter #517) made `scrml dev` stop serving a
   stale/partial bundle when `compileScrml` RETURNS diagnostics. When it THROWS — `ENOENT` on an entry deleted
   or renamed under the watcher, or ANY uncaught compiler internal error (the failure most likely in flight
   while an adopter iterates) — the throw unwinds past `noteCompileResult` in `runOnce`, `compileFailure` stays
   `null`, the #518 short-circuit never fires, and dev serves the LAST-GOOD/PARTIAL bundle at HTTP 200 for a
   tree that no longer compiles. Fail-OPEN — the exact class #518 was meant to close, one path over.
2. **`g-dev-watcher-dies-on-delete-rename-permanent-500` (MED, S345).** A watched source file deleted or
   renamed under dev's watcher KILLS its watch — no recompile ever fires for that path again. Post-#518 (correct
   refusal to serve stale) the consequence upgraded from "stale app, no hot reload" to a PERMANENT 500 on a
   project that has since been fixed; restart is the only recovery.
Loci: `compiler/src/commands/dev.js` — the ledger names `runOnce` / `noteCompileResult` / the #518 short-circuit
and the per-file watch registration. PA-located from the ledger, NOT traced: verify how execution reaches each
before editing, and report if the locus was wrong.

## The fix — fail CLOSED, recover LIVE (FORK RULE row 2)
1. A THROW inside the compile step is a compile FAILURE: catch at the `runOnce` boundary, route it through
   the SAME `noteCompileResult`/`compileFailure` path #518 built (do not add a parallel error state), and
   serve the real error at the request exactly like the returns-diagnostics case. The served body must NAME
   the thrown error (message + `code` for ENOENT + the file path). Uncaught internal errors are still
   compiler defects — say so in the served body (the `validate-emit.ts` "COMPILER DEFECT" framing is the
   precedent) but never serve stale.
2. Watcher liveness: a delete/rename must not kill the watch. Either watch the containing DIRECTORY (Bun/Node
   `fs.watch` on a dir survives child rename/unlink; verify on this platform) or re-arm the per-file watch on
   the next successful compile / on `rename` events. The property to pin: after `rm entry.scrml; git checkout
   entry.scrml` (delete then restore) dev recompiles and serves 200 again WITHOUT restart.
3. Tests in `compiler/tests/commands/` (that tier is EXCLUDED from pre-commit — run it yourself:
   `bun test compiler/tests/commands`; look at #518's tests for the harness pattern). Pin: (a) a thrown
   compile → HTTP non-200 with the error named, never the previous bundle; (b) delete-then-restore → recovers.
   Both must be RED on the pre-fix code — prove it and say so.

## OUT OF SCOPE
`compiler/src/api.js` (another agent is in it — read only). The serve/build commands. `docs/known-gaps.md`.

## MAPS — REQUIRED FIRST READ
`.claude/maps/primary.map.md` (stamp 4f034e13) §"Task-Shape Routing", `build.map.md` (commands), `test.map.md`.
Post-map landings: #518 (S341) is INSIDE the map window? — check `git log --oneline 4f034e13..origin/main --
compiler/src/commands/dev.js` and read whatever landed. Report the load-bearing finding.

## Mechanics (STARTUP VERIFICATION + PATH DISCIPLINE)
isolation: worktree. FIRST `pwd` starts with `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/`;
toplevel equals it; clean tree; else STOP. `bun install`. `git checkout -b fix/dev-compile-throw-fail-closed`.
Edit/Write on WORKTREE-ABSOLUTE paths; never the main checkout; `bun --cwd`, `git -C`. Echo pwd in the first
commit; commit per unit; append-only `docs/changes/dev-compile-throw-fail-closed/progress.md`; NEVER
`--no-verify`; commit timeout ≥ 8 min; push `-u origin fix/dev-compile-throw-fail-closed` early + at end.
Gates: both new pins red-then-green proven; `bun test compiler/tests/commands` green; contract gate
`bun test compiler/tests/{unit,integration,conformance}` 0 fail. If the dev server needs a port, pick an
ephemeral one (0) and read it back — never a fixed port (concurrent agents share this box).

## Final report (raw data)
FINAL_SHA · branch · files touched · where the throw actually unwound (traced, file:line) · the watcher
mechanism chosen + the platform check · both bite proofs · whether either ledger locus was wrong · maps finding.
