change-id: s440-date-in-cell-and-eq (impl#1 fix — authorized by bryan's S440 ruling #8 as an explicit exception to the S435 TS policy)

## STARTUP + PATH DISCIPLINE (incident counter 0)
`pwd` starts with `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-`; clean; `git fetch origin && git merge --ff-only origin/main`; assert merge-base == origin/main; `bun install`; `bun run pretest` (plain). Absolute worktree paths; never `cd` into main; Edit/Write only; no `git stash`; no `pkill -f`. First commit archives THIS PROMPT verbatim to `docs/changes/s440-date-in-cell-and-eq/BRIEF.md`; incremental commits + append-only progress.md; code+tests one commit; Bash timeout 600000 for commits; never `--no-verify`.

## MAPS
`.claude/maps/primary.map.md` first; verify against source; report load-bearing or not.

## THE BUGS (found by the S440 JS-WAT gauntlet; finder-executed on main 7e4bc8155 — reproduce FIRST, a finding you can't reproduce is reported as such)
1. **A `Date` in a reactive cell breaks the page.** `<d> = new Date(2020, 0, 1)` — the cell set wraps it: `_scrml_cs_reactive_set("d", _scrml_deep_reactive(new Date(2020,0,1)))` (PA-verified emission). `_scrml_deep_reactive` wraps the Date in a Proxy, so every Date method (`getTime`, `toISOString`, …) throws `TypeError` (internal-slot methods reject a Proxy receiver). Rendering `${@d}` throws inside `_scrml_boot`, aborting boot, so SIBLING displays stay blank.
2. **Every Date `==` every other Date.** `<a> = new Date(2020,0,1)` · `<b> = new Date(1999,5,5)` · `<eq> = @a == @b` → emits `_scrml_structural_eq(get(a), get(b))`; structural_eq falls to its struct branch, a Date has no own enumerable keys → TRUE.
Loci (PA grep, NOT traced): `compiler/src/runtime-template.js` (both `_scrml_deep_reactive` and `_scrml_structural_eq`), `compiler/src/codegen/runtime-chunks.ts` (chunking), server side `compiler/src/codegen/emit-server.ts` (a server copy of structural_eq?). Reproducers from the finder (read-only; copy them): `/tmp/claude-1000/-home-bryan-maclee-scrmlMaster-scrml/3e14d469-cec8-4ced-83bb-42a85712efb3/scratchpad/wat/B-numbers/p/b12*.scrml`.

## RULING CONTEXT (bryan S440 #8)
*"fix both impl#1 bugs now … and `date`/`timestamp` are VALUE types (immutable, structural `==` by instant), consistent with §66.10."* So: `==` between two Dates compares the INSTANT (`getTime()`), and an invalid Date (NaN time) — decide per dpa-037 status: it is unruled, so treat two invalid Dates as NOT equal (NaN semantics) and record it as a choice in progress.md. Read §45 IN FULL first and quote the sentence you implement.

## THE FIX (root, not position)
- `_scrml_deep_reactive` must not Proxy-wrap built-in objects with internal slots. At minimum: Date, RegExp, Map, Set, WeakMap, WeakSet, Promise, typed arrays, ArrayBuffer, DataView, Error, URL/URLSearchParams if present. The finder suspected RegExp/Map/Set have the same failure — PROBE each and cover every one that breaks. Prefer an allow-list of what IS proxied (plain objects + arrays) over a deny-list. Report which classes broke before.
- `_scrml_structural_eq`: Date by instant; also check RegExp (source+flags), and that Map/Set are not all-equal the same way (report; the §59 value map has its own path — don't touch it).
- Both client and server copies (find every copy; the same function emitted twice is the usual place for a half-fix).
- A write through a Date cell: Dates are values (ruling), so `@d.setFullYear(…)` mutating in place is the §66.10 divergence impl#1 carries — do NOT add a new mechanism; just ensure it no longer throws, and record what it does.

## VERIFY
Runtime tests (happy-dom) that render `${@d}`, call `@d.getTime()`, compare Dates, and that a sibling display still renders when a Date cell is present; the same for each other class you un-proxy. `bun test compiler/tests/unit compiler/tests/integration compiler/tests/conformance`; `bun conformance/run.ts`; browser suite if touched (`bun run test` includes it). Corpus: compile `examples/ samples/ conformance/` before/after and diff emitted runtime/JS — explain every changed file (a runtime-template change changes every bundle's runtime chunk hash; say so and show the diff is only these helpers). REPORT: FINAL_SHA, classes that broke, the fix, test counts, corpus explanation. Clean tree.
