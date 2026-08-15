# progress — dev-compile-throw-fail-closed (S346-bryan dispatch)

Append-only. Worktree: /home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-afdaf74d0741dc329
Branch: fix/dev-compile-throw-fail-closed (base 2709e540 = origin/main at cut).

## 1. Startup + brief location
- pwd / toplevel / clean tree verified; `bun install` ok; branch cut.
- BRIEF.md was NOT in the worktree (base 2709e540 predates it); it lives at 2030d2e8 on
  `brief/s346-briefs`. Checked out that single file into the worktree (no other content taken).
- Both ledger entries read in full (docs/known-gaps.md:233-241 at base).

## 2. Maps
- primary.map.md §Task-Shape Routing: no row for `scrml dev` / the watcher / compile-failure
  serving. build.map.md `scrml dev` flags row + test.map.md tier table (commands = tracking only,
  NOT pre-commit). Post-map landing on dev.js: ONE commit — 62f5007c (#518). Its tests are in
  compiler/tests/UNIT (dev-compile-failure-serves-error.test.js), pure-surface, no live server.

## 3. Traced (executed, not read-level) — pre-fix repro/e2e-prefix.js against the REAL CLI
- Throw origin: compiler/src/api.js:1097 `readFileSync(filePath)` (Stage-2 BS read, OUTSIDE the
  try/catch that starts at :1101). Unwinds through dev.js:329 (`compileScrml(...)` in runOnce, before
  :375 `noteCompileResult`) into the async debounce arrow at dev.js:962 -> unhandled promise rejection.
- Bun 1.3.14 behaviour: a bare script DIES (exit 1) on an unhandled rejection even with a live
  Bun.serve (repro/unhandled-serve.js) — BUT when the module has a pending top-level await (cli.js
  `await runDev()` -> `await new Promise(()=>{})`) Bun only LOGS it and the process survives
  (repro/unhandled-tla.js). So the ledger's "serves stale at 200" IS the real symptom: e2e shows
  proc alive, GET / = 200 stale after `rm entry.scrml`, and no recompile after restore or edit.
- fs.watch platform check (repro/watch-probe*.js): a per-FILE watch fires ONE last event on rm
  (`change`, NOT `rename`, under Bun) and is dead thereafter — recreate / in-place write / atomic
  save (tmp+rename) / vim-style rename all go unseen. A per-DIRECTORY non-recursive watch survives
  all of them; for an atomic save it reports the TMP name (`rename .entry.scrml.tmp.123`), so a
  `.scrml`-suffix filter on dir events would MISS editor atomic saves -> use inode/mtime snapshots.
