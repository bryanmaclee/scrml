- 2026-09-23T21:37:49-06:00 start at /home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-a65be3aac4fb5a48c
- 2026-09-23T21:42:26-06:00 REPRODUCED on .scratch/fx (compile other.scrml src/app.scrml -o src/dist; compile src/app.scrml; dev src/app.scrml -> 0-byte src/x.db; compile -> E-PA-004). Also reproduced on rsync copy of flogence. Trigger: stale multi-root artifact src/dist/src/app.server.js emits sqlite:src/x.db (ss19#9 re-relativization, base=root); dev loadServerRoutes imports EVERY *.server.js under serveDir; Bun.SQL creates file.
- 2026-09-23T21:56 ROOT CAUSE (full chain, reproduced on .scratch/fx2 = adopter shape):
  1. `compile src/` where src/ports/tool.scrml imports ../../lib.scrml (flogence: src/ports/graph-read-tool.scrml
     imports ../../graph-read.scrml) -> computeOutputBaseDir (api.js:231) = common ancestor = REPO ROOT.
  2. emit-server.ts ~6530 (ss19 #9 re-relativization): source dir src/ != base root -> the runtime literal for
     src/app.scrml's db="./x.db" becomes `sqlite:src/x.db` (file-relative resolve, re-relativized to base).
     The SAME source compiled alone (`compile src/app.scrml`, base = src/) emits `sqlite:./x.db`.
  3. That multi-root output lands at src/dist/src/app.server.js; a later single-file compile writes
     src/dist/app.server.js beside it. Neither cleans the other.
  4. `dev src/app.scrml` -> loadServerRoutes (dev.js:321) imports EVERY *.server.js under serveDir
     (findOutputFiles, recursive) incl. the stale src/dist/src/app.server.js. Child cwd = launch cwd (repo root).
     Module-init `new SQL("sqlite:src/x.db")` -> Bun creates 0-byte root/src/x.db. (Not the compiler: PA opens
     readonly + existsSync-gated.)
  5. Next compile: protect-analyzer resolves src="./x.db" file-relative -> src/x.db now EXISTS (0 bytes) ->
     opened instead of the shadow schema -> E-PA-004.
  Underlying: compile-time (file-relative) and runtime (literal opened CWD-relative, literal itself
  compile-unit-dependent) never agree for this adopter; the adopter's `./flogence.db` works only because
  runtime cwd = repo root while compile falls through to the shadow schema.
- GOVERNING SENTENCE: none found. Searched §8.1.1 (L6500-6560: "A plain path without prefix ... SHALL be
  treated as sqlite:./app.db" — prefix only, no base), §44.1/44.2/44.7/44.7.1, §4.12.2/§4.12.6, §39
  (L22620/22638/22674 "database path is read from the enclosing <program db>", §39.7, §39.8 "alongside the
  database path"), §52 (only <db src="app.db"> example L33997), §34 E-PA-001..007 rows, §41 (L23956 defines
  "project root = directory containing the <program> file" for vendor: only). grep "relative" x db/sqlite/src.
  => resolution base is a RULING. Stopped at diagnosis for that part; no resolution change made.
- a0cf97ae: E-PA-004 names resolved abs path + src= + base dir; ZERO-BYTE front-loaded; tests.
