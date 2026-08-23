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

**Direction of change:** `newly-accepting` at the RUNTIME level (previously-DOA pages now run),
`inert` at the LANGUAGE level. Newly-rejecting only for programs whose emitted client bundle was
already guaranteed-dead.

**Next**: full-suite comparison vs the clean baseline; conformance; close the gap entry.

**Blockers**: none.
