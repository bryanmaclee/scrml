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
