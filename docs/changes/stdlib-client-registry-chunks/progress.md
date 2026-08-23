# progress — stdlib client registry chunks

Append-only. Newest entry at the bottom.

---

## 2026-08-23 — Startup + reproduction (BEFORE any source change)

**Done**

- Worktree verified: `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-a984d161a10032fd1`,
  toplevel matches, tree clean, `bun install` + `bun run pretest` green.
- Fetched `gaps/s368-stdlib-client-registry`, read `BRIEF.md` in full.
- Maps read: `primary.map.md` -> `dependencies.map.md` is the load-bearing one.
  It routes "runtime-chunk tree-shake gates" to **`codegen/emit-client.ts`**
  (`detectRuntimeChunks` :273, `POST_EMIT_HELPER_CHUNK_GATES` :2167) + `codegen/runtime-chunks.ts`
  (`CHUNK_DEPENDENCIES` :384), and states outright: *"This is the locus for any
  `ReferenceError: _scrml_* is not defined` in a shipped bundle."* That is correct and saved a
  search — the brief located `RUNTIME_CHUNK_ORDER` but not `detectRuntimeChunks`.

**Reproduced BY EXECUTION** (not grep) on base `82fb7e68`:

- `${ import { slug } from 'scrml:format' ... }` + client-reachable use.
- `bun run compiler/src/cli.js compile … -o …` -> **exit 0**, one unrelated `W-PROGRAM-001`.
- Emitted `fmt.client.js:18` -> `const { slug } = _scrml_stdlib.format;`
- Emitted runtime -> **zero** `chunk: stdlib-*` markers.
- happy-dom execution harness (`(0, eval)(runtime + '\n;\n' + client)`, two classic scripts,
  ONE shared scope) -> `VERDICT=DOA`,
  `TypeError: Cannot destructure property 'slug' from null or undefined value`, exit 1.
- Positive control `scrml:data` -> `VERDICT=OK`, exit 0.

**FULL 21-MODULE SWEEP — the brief's premise is REFINED, and the refinement is load-bearing.**

Every module was compiled with a client-reachable import + use, then EXECUTED:

| verdict | modules |
|---|---|
| OK (chunk present) | auth, crypto, data, host — 4 |
| **DOA at load** | cron, format, fs, http, math, mcp, oauth, path, process, random, redis, regex, router, store, test, time, compiler(*) — 17 |

(*) `compiler` has no `export function`, only `export const`; my sweep's probe skipped it.
Its chunk absence is the same defect — `_loadStdlibChunk`'s `constRe` would collect it fine.

**The refinement: ALL 17 are `CLIENT-LOWERED`, including every server-only module.**
`import { readFileSync } from 'scrml:fs'` used in a `click=` handler emits
`const { readFileSync } = _scrml_stdlib.fs;` into the client bundle and kills the WHOLE page —
with **zero** relevant diagnostics (only `W-PROGRAM-001`). §12.2 Trigger 3 escalation did NOT
suppress the client lowering here. So the class is not "17 modules are missing a chunk", it is:

> **the client import lowering (`emit-client.ts:2107`) is UNCONDITIONAL, while the chunk
> activation (`emit-client.ts:1129`) is CONDITIONAL. They read different artifacts, so they
> can disagree, and the disagreement is silent.**

That is limb 2's framing exactly, and it is stronger than the brief stated: the two sites that
must agree are the EMIT and the ACTIVATION, not merely a shim-file-exists probe.

Also found: the comment at `emit-client.ts:1130-1132` claims unknown module names mean *"the
import is dropped at emit time below"*. **That comment is FALSE** — `:2107` pushes the
destructure unconditionally. A stale comment was actively hiding the defect.

**Next**: limb 1 module set on the §12.2 Trigger 3 criterion; then limb 2; then limb 3.

**Blockers**: none.

---

## 2026-08-23 — Limb 1 landed (commit `00458b0e`)

**Done**

- 9 client chunks added: `compiler` `format` `http` `math` `random` `regex` `router` `test` `time`.
  Wired set 4 -> 13. `RUNTIME_CHUNK_ORDER` + `CHUNK_MARKERS` + the `SCRML_RUNTIME` splice + 9
  `_loadStdlibChunk` calls.
- Membership DERIVED from §12.2 Trigger 3 (`route-inference.ts:ESCALATION_SERVER_ONLY_MODULES`),
  not curated. The 8 excluded — `cron` `fs` `mcp` `oauth` `path` `process` `redis` `store` — each
  carry a one-line reason in the deliberately-absent block.
- New exports `STDLIB_CLIENT_CHUNK_MODULES` + `hasStdlibClientChunk`, derived FROM
  `RUNTIME_CHUNK_ORDER` so limb 2's gate reads the same artifact that decides the outcome.
- `hasStdlibClientChunk` matches EXACTLY (no submodule root-inheritance) — see the second defect below.
- CHUNK_MARKERS contract re-verified: all 13 markers appear exactly once in `SCRML_RUNTIME`,
  extract non-empty content, and every chunk body parses standalone under acorn.
- Two chunk-count assertions updated (`c10-error-message-resolution`, `runtime-tree-shaking`) with
  a rationale saying WHY the count is load-bearing, plus a new SET pin and a
  server-only-modules-have-no-chunk pin. Code + test in ONE commit (they are one logical unit).

**Measured, by EXECUTION:** 21-module sweep 4 OK -> 12 OK. Positive control `scrml:data` still OK.

---

## 2026-08-23 — Limbs 2+3 landed (commit `9b868bca`)

**Done**

- `E-STDLIB-CLIENT-CHUNK-MISSING` (new §34 row, Error) in `emit-client.ts`, plus SPEC + SPEC-INDEX
  entries. `bun scripts/s34-census.ts --check-new` PASSES.
- `compiler/tests/browser/browser-stdlib-client-registry.test.js` — 31 tests that EXECUTE bundles.

**TWO PLACEMENT CORRECTIONS, both caught by measurement rather than review.** Recording them because
the reasoning is the transferable part:

1. **The gate was first placed at the emit site** (beside the `lines.push` in `emit-imports`) —
   which LOOKS like the co-located choice. Wrong: that push is not the final word, because
   `pruneUnusedClientImports` DROPS a lowered read whose names no client code references.
   `examples/23-trucking-dispatch/**` imports `scrml:store` and uses it only inside `?{}`-escalated
   server fns, so the read is emitted and then pruned and the shipped bundle is CORRECT. Gating at
   the push rejected **21 correct files**. Moved to a post-prune scan of the FINAL client text.
2. **The scan then matched the runtime's own comment** — `// \`const { x } = _scrml_stdlib.NAME;\`` —
   inventing a module named `NAME` and failing three clean files. Fixed by changing the scan's
   INPUT (excise the runtime span, exactly as the prune stage above already does), NOT by tightening
   the pattern.

**TWO FURTHER DEFECTS of the same class, found and fixed here:**

- **Submodule specifiers lower to a DIVISION.** `scrml:auth/jwt` -> `_scrml_stdlib.auth/jwt`, parsed
  as `_scrml_stdlib.auth / jwt`. Measured DOA, `ReferenceError: jwt is not defined`. The gate refuses it.
- **Submodule reads escaped the unused-import prune.** The prune's region regex matched the module
  segment as `[A-Za-z0-9_$]*` with NO slash, so `_scrml_stdlib.compiler/bs;` was never a removable
  region and survived even for a `server function`-only use — DOA with `ReferenceError: bs is not
  defined`. Surfaced because the new gate turned `stdlib-shim-resolution.test.js` §4 red on all 13
  `scrml:compiler/<stage>` cases; **that test asserted `errors == []` while reading only the emitted
  SERVER file**, so it had been sitting on top of a dead client bundle. Adjudicated by EXECUTION, not
  by assuming the gate over-fired. Regex widened with `(?:/[A-Za-z0-9_$]+)*`.

**BITE PROOF — limb 2** (exit codes measured DIRECTLY, never through a pipe):

| step | compile exit | code fires |
|---|---|---|
| baseline | 0 | no |
| de-register `stdlib-format` | 1 | yes |
| restore | 0 | no (restore byte-clean vs HEAD) |

**MERGE-BLOCKER PROOF — limb 3** (`bun test` exit measured directly):

| step | exit | pass/fail |
|---|---|---|
| baseline | 0 | 93 / 0 |
| de-register `stdlib-format` | 1 | 89 / 3 |
| restore | 0 | 93 / 0 |

The 3 red are the partition test + both chunk-set pins, each naming the cause.

**MEASURED MIGRATION (assumed-zero was not accepted).** Pre-filtered `samples/ examples/
conformance/ stdlib/ compiler/tests/ benchmarks/ docs/` to the 62 `.scrml` files that import an
unwired module or any submodule — the only files on which the gate CAN fire — and compiled each
individually. **HITS = 0.** (First, mis-sited, version of the gate gave HITS = 22; that is what
exposed correction 1.)

**Direction of change: NEWLY-REJECTING** (corrected in review; the original `inert at the language
level` was wrong — limb 2 adds an error, so source that compiled can now be refused, and no
measurement makes that something else). Separately, and NOT part of the classification:
previously-DOA pages now run, and measured migration is 0 over a conservative 63-file superset of
at-risk files out of 171 stdlib importers. Migration-zero is a blast-radius fact.

**Next**: full-suite comparison vs the clean baseline; conformance; close the gap entry.

**Blockers**: none.

---

## 2026-08-23 — Final verification

**Full suite** (`bun run test`, which chains `pretest`), compared against a baseline captured on the
CLEAN base BEFORE any source change — the brief's requirement not to assume the baseline:

| | pass | fail | skip | todo |
|---|---|---|---|---|
| baseline (clean base `82fb7e68`) | 30357 | 55 | 216 | 1 |
| after all three limbs | 30391 | 53 | 216 | 1 |

**NEW failures vs the clean baseline: ZERO.** Two baseline failures no longer fail
(`TodoMVC §0/§1 — dist not compiled`), an artifact of the post-commit hook having compiled
`benchmarks/todomvc/dist/` in the meantime; not a change in behaviour.

**Conformance**: `bun conformance/run.ts` -> **883/883 pass, exit 0**.

**A transient failure that was NOT ours, recorded because the diagnosis is the reusable part.** The
first post-change full run showed one new red:
`Self-host: block-splitter parity > selfHostModules.splitBlocks slot works in compileScrml`. Because
it named `splitBlocks` — the exact symbol in the submodule-prune fix — it looked like ours. It is not:

- the stack pointed at `/home/bryan-maclee/scrmlMaster/scrml/compiler/src/runtime-template.js:1157`,
  i.e. **MAIN's checkout, not this worktree** — `self-host-smoke.test.js` resolves `projectRoot`
  via `findMainProjectRoot()` BY DESIGN, because the `compiler/self-host/dist/` artifacts are
  gitignored and only built in main;
- main's line 1157 no longer matches the text that failed to parse (the backticks in that comment
  are gone), so a concurrent session was editing main's `runtime-template.js` DURING the run;
- the test passes in isolation, and the re-run full suite is clean.

Lesson worth carrying: a self-host test failing in a worktree may be reporting on MAIN's tree. Check
the PATH in the stack before attributing it.

**No leakage into main, verified three ways:** the new test file does not exist in main; main's
`runtime-chunks.ts` still has 4 stdlib chunks (not 13); main's `SPEC.md` has zero occurrences of
`E-STDLIB-CLIENT-CHUNK-MISSING`.

**DEFERRED — each with its reason, so it can be re-derived:**

1. **Submodule client imports are REFUSED, not SUPPORTED.** `scrml:auth/jwt` used client-side now
   produces a clear compile error instead of a blank page, but a client-safe submodule still cannot
   be imported client-side at all. REASON: making it work needs a NESTED registry namespace
   (`_scrml_stdlib["auth/jwt"]` or a flattening scheme) plus a matching change to the import
   lowering — a design decision about the registry's shape, not a bug fix, and outside this brief's
   three limbs. Refusing is correct and safe in the meantime; nothing that previously worked stopped
   working, because it never worked.
2. **`auth` and `crypto` carry client chunks despite being escalation-server-only** under the §12.2
   Trigger 3 criterion. REASON: pre-existing since S95 Bug 18, and REMOVING a chunk is a behaviour
   removal (programs that load today would stop loading), which is out of scope for a dispatch
   scoped to adding them. Worth a decision of its own: the shim loader strips their `bun` imports so
   a client call ReferenceErrors at the CALL rather than killing the page, which is a defensible
   design — but it does ship those shim bodies into the browser, and that is a confidentiality
   question somebody should answer deliberately rather than inherit.
3. **`W-STDLIB-SHIM-MISSING` is now provably unfireable** — all 21 shims exist on disk, so its
   `existsSync` probe never returns false. REASON: retiring or re-pointing it is a §34 catalog
   decision (the freeze-denominator / FALSE-CLAIM triage arc owns that call, per
   `scripts/s34-census.ts`), and this dispatch was scoped to ADD the gate that reads the right
   property, not to retire the one that reads the wrong one. It is now strictly redundant for the
   client axis; it may still have server-axis value if a shim is ever deleted.
4. **The stale comment at `emit-client.ts` claiming unknown stdlib names are "dropped at emit time"**
   was left in place at limb 1 and is now moot (the gate refuses them before it matters). REASON: it
   sits inside `detectRuntimeChunks`, adjacent to the surface a concurrent session was declared to
   own; not worth a collision for a comment.

**Blockers**: none. All three limbs complete.

---

## 2026-08-23 — LAND-CONDITIONAL review round

Five items back from the adversarial pass. All five closed; the HIGH is closed with its own bite
proof in both directions.

### HIGH — string-literal false fire (`ee85ebe0`)

**Reproduced independently before changing anything**, per the repro-first rule — I did not take the
reviewer's reproducer on trust. Valid scrml, ZERO stdlib imports:

    <tip> = "the registry slot is _scrml_stdlib.wombat"

-> exit 1, hard error naming `scrml:wombat` (a module that has never existed), instructing the
adopter to add `stdlib-wombat` to `RUNTIME_CHUNK_ORDER` in the compiler's own source.

**This is the class I already fixed once and closed only the instance.** Excising the runtime span
handled the runtime's own `_scrml_stdlib.NAME` comment; ANY `_scrml_stdlib.` text in a non-code
position still read as a registry access. Fixed with `maskStringLiteralSpans` — the helper BOTH
sibling stdlib scans already use (`:2941` chunk prune, `:3763` read-line prune) and that mine was
the only one of the three to omit. Applied AFTER the runtime excision, because the RT markers are
line comments the `indexOf` must still find.

**Scope MEASURED, not assumed** (probe matrix, every fixture valid scrml with no stdlib import):

| position | before | after |
|---|---|---|
| string literal, one name | FIRES | clean |
| string literal, two names | FIRES | clean |
| single-quoted string | FIRES | clean |
| adopter `//` comment | clean | clean |
| regex literal | clean | clean |

So string literals were the entire live FP surface — scrml comments do not survive into emitted
client JS and no emitted regex carries the token — and masking them closes the class without
reaching for a heavier code/comment fence. I checked the comment and regex positions rather than
assuming the reported shape was the only one.

**Bite proof, gate** (exit codes measured DIRECTLY, never through a pipe):
baseline `exit=0` silent -> de-register `stdlib-format` -> `exit=1` fires -> restore -> `exit=0` silent.

**Bite proof, new FP tests** (`bun test` exit measured directly):
baseline `exit=0` 36/0 -> delete the mask line -> `exit=1` **32/4**, the 4 red being exactly the FP
cases -> restore -> `exit=0` 36/0.

**21-module execution matrix UNCHANGED**: 12 execute OK (+ `scrml:compiler` verified separately =
13), 8 refused loudly with exit 1, 0 silent DOA.

### Test file moved INTO the commit gate (`ee85ebe0`)

`.git/hooks/pre-commit:39` runs `compiler/tests/{unit,integration,conformance}` + root `*.test.js`.
`compiler/tests/browser/` is NOT in that set — so the merge-blocker proving this feature is not DOA
was itself outside the merge gate. Verified by reading the hook, not by assuming.

Browser-tier placement is **not** load-bearing: 14 integration tests already register happy-dom the
same way, including this feature's own predecessor
`integration/bug-18-scrml-stdlib-client-import.test.js`. So I moved the WHOLE file
(`browser/browser-stdlib-client-registry.test.js` -> `integration/stdlib-client-registry.test.js`)
rather than only the newest regression — all 37 tests now run on every commit. Relative import depth
is identical between the two tiers, so no path edits were needed.

### Source location on the diagnostic (`035773f2`) — the "optional" item, taken

A hard error with no `-->` line is not something to ship, especially beside a sibling WARNING that
has one. Two things were wrong and the SECOND is what actually suppressed it:

1. no span was captured — now recorded at the lowering site in `emit-imports` (the only place the
   import AST node is in hand) and carried to the gate through a module-name -> span map, because
   the gate must fire against the FINAL emitted text, which has no source positions;
2. `commands/compile.js:formatError` reads TOP-LEVEL `filePath` / `line` / `column`, **not**
   `span.*`. Verified by inspecting the emitted diagnostic object: `span.file` was correctly set and
   `filePath` was `undefined`, so the `-->` branch could never be taken.

Now renders `--> …/fs.scrml:2:12` with the source-context caret on the import line. The test pins the
EXACT line (2), not `> 0` — a `> 0` assertion would pass against the old hard-coded 1 — and asserts
the top-level fields, because asserting only `span.*` would go green while the adopter still saw
nothing.

**Pre-existing, NOT fixed here, recorded so it is findable:** item (2) affects every `CGError` raised
in `emit-client.ts` (`E-CG-001` / `E-CG-006` render the same way). Fixing it globally is a
shared-formatter change beyond this dispatch.

### Stale attributions (`035773f2`)

`runtime-chunks.ts:163` and `:341` credited the code to `(api.js)`, a leftover from the pre-move
placement; it lives in `emit-client.ts`. Swept src + SPEC.md + SPEC-INDEX.md + known-gaps.md rather
than fixing only the two reported lines — those two were the only occurrences.

### Direction-of-change corrected

The reviewer is right and my original wording was wrong. `inert at the language level` cannot be
true of a branch that adds an error: source that previously compiled can now be refused. The FP
above is the proof — it could only exist because the branch rejects.

Corrected to **newly-rejecting**, with the blast-radius fact kept separate: measured migration 0 over
a conservative 63-file superset of at-risk files out of 171 stdlib importers.

**And a limitation of my own measurement, recorded because it is the reusable part:** the original
at-risk pre-filter was IMPORT-based, so it could not have found a fire that needs no import — and it
did not; the FP came from a hand-written reproducer in review. **A pre-filter derived from the
INTENDED trigger cannot find a fire caused by an UNINTENDED one.** Filter since widened to include
any `.scrml` carrying `_scrml_stdlib.` text (63 files, still 0 hits; the one corpus match has it
inside a `//` comment naming the already-wired `auth`).

### Process note against myself

One commit this round landed as a pure rename with **0 insertions** because I wrote
`git add <old-path> <new-path> 2>/dev/null` — the stale path made `git add` fail, the redirect
swallowed the error, and NOTHING was staged. Caught by checking `git show --stat` after the commit
rather than trusting the exit code, and amended. Do not swallow `git add` stderr.
