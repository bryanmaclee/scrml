# DISPATCH BRIEF — W2: implement W5b (library-mode `?{}` in-process emit) — Option A

**Change-id:** `tool-library-in-process-consumption-2026-07-05` (W2 impl). **Agent:** scrml-js-codegen-engineer, isolation:worktree.
**Ruling:** Option A + generalize (bryan S239). **This IS W5b** — the long-staged cross-file-`?{}`-resolve stage of F-AUTH-002 (§44.7.1). SCOPE: `docs/changes/tool-library-in-process-consumption-2026-07-05/SCOPE.md` (read §0, §3, §8, D8 — the empirical grounding).

**One sentence:** make an inline-`?{}` (SQL) library fn emit as a **plain in-process server-side exported binding** (its own `<db src>` handle + `?{}` → `await _scrml_sql.unsafe(...)`), NOT the E-CG-006 null-stub / HTTP-route form — so a `kind="tool"` (and any server-side/in-process consumer) can import + call it in-process. SPEC un-staging lands WITH the impl (Rule 4).

---

# CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE (S88/S90/S99/S126)
Worktree path: under `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-<id>/`.
1. `pwd` — MUST start with `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-`. If under any other repo → STOP, report (S90). Save as WORKTREE_ROOT.
2. `git rev-parse --show-toplevel` == WORKTREE_ROOT.
3. `git status --short` clean.
4. `bun install` (worktrees don't inherit node_modules — pre-commit `bun test` fails with "cannot find package 'acorn'" otherwise).
5. `bun run pretest` (gitignored `samples/compilation-tests/dist/`; browser tests need it). Use `bun run test` (chains pretest) for full-suite baselines.
**Path discipline:** apply ALL edits via Bash (`perl`/`python3`/heredoc) on worktree-absolute paths incl. the `.claude/worktrees/agent-<id>/` segment — NOT Edit/Write, NOT main-rooted paths. NEVER `cd` into the main repo; use `git -C "$WORKTREE_ROOT"`, `bun --cwd "$WORKTREE_ROOT"`, worktree-absolute paths. First commit msg includes verbatim `pwd`: `WIP(w5b): start at $(pwd)`.
**Commit discipline (S83):** after every edit → `git diff` → `add` → commit immediately (don't batch); `git status` clean before DONE.

# MAPS
`.claude/maps/primary.map.md` is STALE (watermark 66a3afb1; HEAD is now 94e156c5). Fire sites below are authoritative; treat maps as hypothesis. Use `bun scripts/dock.ts --units <file>` before editing each file; `--diff-scope 94e156c5..HEAD --owns <blocks>` post-landing for strays.

# SPEC — Rule 4 (read IN FULL before touching emit; the design is UN-STAGE, not invent)
- **§12.6 Library-mode Emission** (line ~7103) — a library body-escalated `?{}` fn SHALL emit as a plain server-side exported binding (no §12.3 route/fetch bundle). Its **impl-note (~line 7121)** carves out inline-`?{}` as "the staged pure-fn-library lifecycle of §44.7.1/§21.5.1 — does not yet emit cleanly." **You are implementing that.**
- **§44.7.1 Module-with-db-context (F-AUTH-002)** (line ~22889) — a pure-fn library file's `<db src>` is the `?{}`-resolution scope; the file OWNS its connection (a `<program db=>` in the importer does NOT override it). "The cross-file emission lifecycle is being implemented in stages — W5a auto-detect-library, **W5b cross-file-`?{}`-resolve**." **W2 = W5b.**
- **§21.5.1** (line ~14816) — "Until that contract is fully implemented … pure-fn files containing `?{}` server functions produce a hard error." → now implemented.
- **§64.5 / §64.5.1** (line ~34569) — the tool-import surface (E-TOOL-006). A tool imports the plain in-process db binding.
- **E-SQL-009** (§44.7 / §21.5.1; §34 line ~18156) — currently the "hard error until W5b" gate.

# THE TASK

## Impl (emit)
1. **`emit-library.ts` — make an inline-`?{}` fn emit as a plain in-process server binding.** Today it null-stubs it (`const rows = null; // client cannot evaluate _scrml_sql (E-CG-006); use a server-side function`) and/or fires E-CG-006 (fire sites: `emit-library.ts:182` route-wrapper note; `:575` + `:700` `E-CG-006: Server-only node found in library JS output`). Instead: emit the fn's real body with `?{}` lowered in-process — `await _scrml_sql.unsafe("...")` — and inject the module's OWN `<db src>` db handle (`import { SQL } from "bun"; const _scrml_sql = new SQL(<lib's src>)`). **REUSE the proven machinery in `emit-tool.ts`:** `buildDbHandleHeader` (the Bun.SQL handle from the file's `<db src>` via `collectDbScopes`) + `emitLogicNode` at `boundary:"server"` (the in-process `?{}` lowering) + runtime-helper inlining. A tool's OWN `?{}` already emits exactly this (verified: `const _scrml_sql = new SQL("sqlite:./t.db"); const rows = await _scrml_sql.unsafe(...)` → runs). Apply the same per-fn lowering to the library's exported fns.
2. **The db handle comes from the LIB's own `<db src>`** (§44.7.1 — the module owns its connection). Per-module handle (D2). If a tool + N libs point at the same db file → N connections (SQLite tolerates; acceptable v1 — note it).
3. **Two consumer surfaces (D5 generalize — both get the real callable):**
   - **Tool-dep `<base>.js`** — the A2 additive artifact the tool imports (codegen/index.ts, the `emitAsLibrary`/`buildHasToolEntry` path from the A/B landing `94e156c5`). Today it routes through the web-app `generateLibraryJs` → omits/null-stubs `?{}` fns. Route the `?{}` case to the in-process emit so `<base>.js` carries the real db callable.
   - **`.server.js` cross-file export (ss1 "module value exports")** — today null-stubs the db fn. Make it the real in-process callable (this is the server-module consumer half).
4. **`?{}` async → `export async function`** — a `?{}` fn is async; ensure the exported binding is `async` and the A/B Flag-C cross-import await-coloring (already colors `?{}` bodies async via `bodyHasForeignOrSql`) awaits it at the tool call site (verify it fires for a db lib fn, not just foreign).

## SPEC (un-stage — lands WITH the impl, Rule 4)
- **§44.7.1** — flip W5b from "scheduled for follow-up" → implemented (S239). Keep the module-owns-connection + one-`<db>`-per-file rules.
- **§12.6 impl-note (~7121)** — the inline-`?{}` case now emits cleanly as a plain server binding (remove the "does not yet emit cleanly" carve-out for the `?{}` case; the transaction case may stay staged if you don't cover it — scope to `?{}`).
- **§21.5.1** — "until fully implemented … hard error" → the contract is now implemented; E-SQL-009 stays for the GENUINE no-`<db src>` case only (a `?{}` fn in a file with NO `<db src>` block — that's still a hard error).
- **§64** — a short note (in §64.5.1 or a sibling): a `kind="tool"` importing a db-bound library fn calls it in-process (the imported `<base>.js` carries the real db binding per W5b); the tool + the lib each own their db connection.
- **D5 note** — a library's db fn is consumer-shaped: HTTP route for a browser client (unchanged), in-process binding for a server/tool consumer.
- If any un-stage needs a NEW §34 code or retires one, do it + surface in the report.

# ⚠️ BLAST RADIUS (this is why the adversarial gate matters)
`emit-library.ts` + the `.server.js` cross-file export path serve **BOTH** the tool-dep AND normal web-app server consumers. Making the `.server.js` cross-file db export REAL (null-stub → in-process callable) changes the web-app library path too (the D5 generalize). This is SAFE — the null-stub `const rows = null; … rows[0]` THROWS if called, so no working web app depends on it; making it real strictly unblocks a broken path. BUT you MUST verify:
- The **HTTP route still emits** for the browser client (the client fetches the `?{}` fn over HTTP — that path is UNCHANGED; §12.6 retains the route for explicit-`route=`/browser-mode).
- The **browser client artifact** (`<base>.client.js` + `_scrml_modules["...client.js"]`) is UNCHANGED (pure fns callable client-side; `?{}` fetched over HTTP).
- No web-app server/route emit regresses.

# VERIFICATION (mandatory before DONE)
## Phase 3 — R26 empirical (S138) via the CLI
1. **D8 repro (the core):** a db lib (`<db src>` + a `?{}` fn + a pure fn) + a `kind="tool"` that imports + calls the `?{}` fn. Compile via `bun compiler/src/cli.js compile tool.scrml`. Assert: `<lib>.js` EXPORTS the `?{}` fn as `export async function` with `await _scrml_sql.unsafe(...)` (NOT null-stub); `tool.js` imports it; **`bun dist/tool.js` RUNS the SQL in-process** (create a table + insert in the tool or lib, count it, print). Include a schema-setup fn (`ensureSchema()` — a `?{}` with no return, flogence's `ensureFspSchema` shape).
2. **flogence fsp-core shape:** a `<foreign lang>` + `<db src>` + `?{}` + `_{}` lib imported by a tool — the `?{}` fn runs in-process, the `_{}` inlines, the pure fn is callable. (This is flogence's real port target.)
DO NOT mark DONE without `bun dist/tool.js` running the imported db fn's SQL in-process.

## Adversarial (S215) — MANDATORY (emit-library blast radius)
Construct: a normal WEB APP importing a db lib fn (server-side + client-side — must NOT regress: client fetches over HTTP, the route still emits); a tool importing a db lib fn (real in-process); a `?{}` fn in a file with NO `<db src>` (E-SQL-009 STILL fires); a foreign+db combined lib in a tool; a lib with BOTH a `?{}` fn AND an explicit `route=` fn (the route one RETAINS its handler per §12.6). Run `/code-review` high on the diff (if not invokable in-agent, do a thorough manual adversarial self-review + say so + recommend PA run it).

## Full suite (S198)
Full `bun run test` (within-node re-baseline in-place if OVER-BUDGET). Report pass/skip/fail.

# SCOPE FENCE
- IN: `emit-library.ts` (the `?{}` in-process binding) + `codegen/index.ts` (routing the tool-dep + the `?{}` case) + `emit-tool.ts` (only if reused helpers need exporting) + the SPEC un-staging + tests + a conformance case.
- OUT (do NOT touch): clean-print primitive; type-system.ts freeze-blockers (fail-variant-arity, hostmethod-poison); E-ROUTE-001-on-tool. If you're in type-system.ts, STOP.
- Transaction-in-library (`<transaction>`) may stay STAGED if the `?{}` fix doesn't naturally cover it — scope to `?{}` (+ note transaction status).

# REPORT
WORKTREE_PATH · FINAL_SHA · FILES_TOUCHED · R26 CLI transcript (emitted `<lib>.js` for the `?{}` fn + `bun dist/tool.js` output showing SQL ran in-process) · web-app-no-regress evidence · full-suite counts · `/code-review` result · dock stray-check · SPEC un-stage summary (+ any §34 code change) · the E-SQL-009-still-fires-for-no-`<db>` check · deferred items · Maps: load-bearing finding or not.
