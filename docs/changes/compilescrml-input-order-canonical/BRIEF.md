# BRIEF — canonicalise `compileScrml`'s input order: same file SET → byte-identical artifacts (S346-bryan dispatch; QUEUED behind fix/flagship-hos-hermetic — both touch the compileScrml entry)

DONE-PROBE: grep -qE 'resolvedInputFiles.*sort|canonical(ise|ize).*input' compiler/src/api.js && ls compiler/tests/unit | grep -qiE 'input-order|order-canonical'

## The defect (HIGH — `g-compilescrml-input-order-dependent-emission`, S346; read the ledger entry IN FULL)
`compileScrml({inputFiles})` numbers routes / logic ids / fetch stubs in `inputFiles` ORDER
(`compiler/src/api.js:910` `resolvedInputFiles = inputFiles.map(f => resolve(f))` — never canonicalised;
`:979` the module-resolution `queue` inherits it). **PA-reproduced at `2709e540`:** the trucking app
FORWARD vs REVERSED → 79 of 115 emitted files differ, `app.server.js` `__ri_route__sessionStore_1` vs
`_63` — client and server route URLs disagree across two machines whose argv/glob order differs
(`LC_ALL=C` vs `en_US.UTF-8` collate `Board.scrml`/`board.scrml`/`_shared.scrml` differently). Reachable via
`scrml compile <file> <file> …`, `dev.js` explicit-file mode, every API consumer. `scrml compile <dir>` is
NOT affected — `scanDirectory` has ended `results.sort()` since `44c10543`; **PR #528's fix at
`api.js:147` is inert and its comment at `api.js:142-146` asserts a production claim that never held**
(the S345 CI witness was the TEST's own walk, #527).

## The fix (position where determinism is decided; the root — order-independent id minting — is its own arc)
1. Canonicalise at the entry: sort `resolvedInputFiles` by resolved absolute path, UTF-16 code-unit order
   (`.sort()` default — the same order the walks use; NOT `localeCompare`). Do it ONCE, before anything
   reads the list; make sure `:979`'s queue and every later consumer see the canonical order (trace where
   `resolvedInputFiles` flows: `git grep -n resolvedInputFiles compiler/src/api.js`).
2. **PRESERVE the entry-file semantics**: if `compileScrml` treats `inputFiles[0]` (or an `entry`/`entryFile`
   option) as THE entry / `<program>` root — find out; `grep -n 'entry' compiler/src/api.js` — sorting must
   not change which file is the entry. If the entry is positional, keep the entry first and sort the rest;
   say which it is in the report with the line.
3. Correct the #528 comment at `api.js:142-146` to the truth (dir form was already sorted; the order that
   mattered is the input list; now canonicalised here).
4. **Pin (the bite):** `compiler/tests/unit/compilescrml-input-order-canonical.test.js` — compile a
   multi-file fixture (`compiler/tests/fixtures/chunk-namespacing/wide` or the trucking example, whichever
   is fastest but MULTI-FILE with routes) FORWARD and REVERSED into two temp dirs (mkdtemp + `afterAll`
   rmSync — do not leak) and assert every emitted artifact is byte-identical; assert at least one
   `__ri_route__` URL is present so the pin cannot pass vacuously. Prove it RED before the fix (stash /
   parent) — 79 of 115 is the expected pre-fix delta on trucking.
5. Direction-of-change: run `scripts/corpus-emit-differential.ts` (read its header) — for every corpus
   fixture compiled through a SORTED walk this must be INERT (0 changed); report the count. Any non-zero
   is a finding: it means some path was already relying on an unsorted order.

## OUT OF SCOPE
Order-independent id minting (the root; file/point at the ledger). `scanDirectory`/`copyTree` (already
sorted). `docs/known-gaps.md`. The flagship-hos harness. If `fix/flagship-hos-hermetic` has landed on
main when you start, `git fetch` and branch from `origin/main`; if it has NOT, expect a rebase on
`compileScrml`'s entry region and resolve it as a real 3-way (never `--ours`/`--theirs`).

## MAPS — REQUIRED FIRST READ
`.claude/maps/primary.map.md` (stamp 4f034e13) §"Task-Shape Routing"; `build.map.md` (api.js pipeline
stages); `test.map.md`. Post-map landings on api.js: #528 (S345). Report the load-bearing finding.

## Mechanics (STARTUP VERIFICATION + PATH DISCIPLINE)
isolation: worktree. FIRST `pwd` starts with `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/`;
toplevel equals it; clean tree; else STOP. `bun install`. `git fetch origin && git checkout -b
fix/compilescrml-input-order-canonical origin/main`. Edit/Write on WORKTREE-ABSOLUTE paths; never the
main checkout; `bun --cwd`, `git -C`. Echo pwd in the first commit; commit per unit; append-only
`docs/changes/compilescrml-input-order-canonical/progress.md`; NEVER `--no-verify`; commit timeout ≥ 8
min; push `-u origin fix/compilescrml-input-order-canonical` early + at end.
Gates: the pin red→green proven; differential count reported (expected 0); contract gate 0 fail.

## Final report (raw data)
FINAL_SHA · branch · files touched · the entry-file semantics finding (positional or not, file:line) · every
consumer of `resolvedInputFiles` traced · pre-fix red count · differential count · maps finding.
