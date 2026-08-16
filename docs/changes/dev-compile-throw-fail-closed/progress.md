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

## 4. Pre-fix RED proof (both pins)
- New commands-tier suite compiler/tests/commands/dev-compile-throw-fail-closed.test.js run at
  6b9d8443 (pre-fix dev.js + only the port-log change): 0 pass / 3 FAIL —
  §1 fail-open (dev kept serving 200 after rm, ENOENT unhandled-rejection dump in output),
  §2 never recompiled after restore (watch died on delete),
  §3 second atomic save never picked up (per-file watch died on the first rename-over).

## 5. The fix
- Part 1 (fail CLOSED): `compileThrowDiagnostic(err)` (exported) maps a throw to ONE diagnostic in
  the exact shape formatDiagnostic/buildCompileErrorResponse already render. FS errors
  (code+syscall/errno/path) keep the OS code (ENOENT) + path + recovery hint; everything else is
  framed as a COMPILER DEFECT (validate-emit.ts precedent), code INTERNAL-COMPILER-ERROR
  (deliberately un-prefixed, matching the salvaged dead-session intent; an escaped error with its
  own string code keeps it), top-8 stack frames carried. runOnce wraps compileScrml in try/catch and
  routes the catch through the SAME noteCompileResult path (#518's) — no parallel error state.
  Contract: runOnce NEVER throws. On the catch path it returns
  { success:false, outputDir: opts.outputDir || dirname(input[0])/dist } mirroring api.js's default.
- Part 2 (recover LIVE): per-FILE watches replaced by ONE non-recursive fs.watch per DISTINCT
  source directory + per-file stat snapshots (mtimeMs/size/ino). Dir events carry unreliable names
  (atomic save reports the TMP name; probe-verified) so change detection stats the watched source
  set inside the debounce and recompiles only when a snapshot changed (present<->absent counts —
  delete AND restore both fire). No {recursive:true} anywhere: watch count = distinct source dirs
  <= source count (STRICTLY FEWER inotify watches than before; BUG-1 ENOSPC not reintroduced).
  dist/ is a subdirectory -> never fires the parent's non-recursive watch; even -o <sourcedir>
  can't loop because emitted .html/.js stats don't change any watched .scrml snapshot.
- Port log: `[dev] Serving ...` now prints server.port (the BOUND port) not opts.port, so
  `--port 0` (ephemeral, brief-mandated for shared boxes) is usable and readable-back.

## 6. Post-fix GREEN + extras
- commands tier: 187 pass / 0 fail (was 184/0 baseline; +3 new). New suite stable across 3 reruns.
- unit extension: #518's dev-compile-failure-serves-error.test.js grew §7 (5 tests) pinning
  compileThrowDiagnostic mapping + the served 500 through the REAL fetch handler. 46/0 across both
  dev unit suites.
- Bonus behavior (probe e2e-initial-throw.js): entry missing AT BOOT — pre-fix the process died
  before serving; post-fix dev comes up, serves 500 naming ENOENT+path, and recovers to 200 live
  when the file is created (deriveWatchFiles includes opts.inputFiles, so the entry dir is watched
  even when gather returned nothing).
