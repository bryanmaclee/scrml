## CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE (incident counter: the S99/S314/S385 leaks — every one was an absolute main-rooted path or a shared `git stash`)
1. `pwd` MUST start with `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-`; `git rev-parse --show-toplevel` == `pwd`; `git status --short` clean; `git merge-base HEAD origin/main` == `git rev-parse origin/main` (after `git fetch origin`). Any failure: STOP, report, exit.
2. Every Read/Write/Edit uses an ABSOLUTE path UNDER your worktree root. Never a main-checkout path; never `cd` into main.
3. NEVER `git stash`. NEVER `pkill -f`/`killall` by command string. NEVER `--no-verify` or hooksPath changes.
4. `bun install`, then `bun run pretest` plainly from the worktree CWD (verify `samples/compilation-tests/dist/` exists afterwards).
5. `TMPDIR` never inside a repo; use `TMPDIR=$HOME/.cache/scrml-agent-tmp/s466-server-param-defaults` per command if needed.
6. Branch: `git checkout -b s466-server-param-defaults`. FIRST commit: write this entire prompt verbatim to `docs/changes/s466-server-param-defaults/BRIEF.md` + a `progress.md`, message `WIP(s466-server-param-defaults): start at $(pwd)`. Commit after every meaningful step; append timestamped lines to progress.md. Code + its tests are ONE commit unit (never leave a transiently red commit).

## MAPS — REQUIRED FIRST READ
Read `.claude/maps/primary.map.md` first (stamp `41af4153a`, 2026-10-12; main has since landed #1414–#1421 — #1416 attribute-writer backstop, #1419 plain-fn placement + server-bundle binding closure, #1417 statement-markup refusal + emitted-JS parse floor). Follow its Task-Shape Routing for codegen/server work. Treat map content as a hypothesis; report whether it was load-bearing.

## The bug — gap `g-server-function-param-default-calling-fn-returns-null-s464` (HIGH, docs/known-gaps.md)
Every server-placed function loses its parameter defaults. PA-reproduced on main `f28b58a31` today:
```scrml
<program db="./app.db">
${
  server fn g(m: string, k: string = "zz") -> string { return k + m }
  function go() { return g("x") }
}
<out> = ""
<button onclick={ @out = go() }>go</button>
<p>${@out}</p>
</program>
```
`bun compiler/bin/scrml.js compile app.scrml --output-dir out` → `out/app.server.js` route handler has `const k = _scrml_body["k"];` and the string `"zz"` appears nowhere in the server bundle. Expected `"zzx"`; actual `null`-ish. The gap entry (read it in full) also reports: the in-process peer callable is emitted `async function g(m, k)` with the default dropped; `function inner(k = a(5))` called as `inner()` from a server function → `200 null` (expected 6); and a default that calls an `@`-reading fn (`fn rd() { return @n }` + `fn f(m, k = rd())`) on the server path gets no E-REACTIVE-003 and answers null.

Locus (PA-located — VERIFY, it is a hypothesis from a symbol grep, not a trace): `compiler/src/codegen/emit-server.ts` — `_scrml_body[...]` binding lines near the non-SSE handler (~:5381, ~:5670) and the SSE path (~:4922 comment); plus wherever the in-process peer callable's parameter list is emitted. There may be more paths (CPS stubs, channel handlers, library/tool mode `emit-library-shared.ts` / `emit-tool.ts`, exported module fns). Find ALL paths that emit a server function's parameter list or binds its params, and report whether the hypothesis held, was refined, or was wrong. Prefer ONE shared helper that emits a parameter (with its default lowered in server mode) over per-site patches — a per-position fix is a bug generator.

## Semantics to decide by the SPEC, not by guess (governing-sentence gate)
Before changing behaviour, QUOTE the governing SPEC sentence(s) (`compiler/SPEC.md`, search §7 function forms, §12 route inference, §12.5 server returns, §48 fn) that say a parameter default applies. If you find none, write "searched §X, §Y — no governing sentence" in progress.md and STOP with a report — do not invent semantics. Things to settle against the SPEC and report explicitly:
- When the default applies over HTTP: missing key vs `not`/absent value (`{"__scrml_absent":true}` envelope, §57) vs JS `undefined`. JS semantics: default applies only for `undefined`. scrml has no `undefined`; `not` is the absence value. Report what you chose and the sentence that decides it; if the SPEC is silent on `not`-passed-explicitly, implement "missing argument ⇒ default" only, leave explicit `not` as `not`, and flag it as an open question.
- Default expressions are evaluated on the server in server mode; one that reads reactive state (`@x`, directly or through a called fn) must be E-REACTIVE-003 (the §6.6.9 "Every read position counts (S464)" rule) — use the existing one `@`-reader (`compiler/src/at-refs.ts`), do not add a second reader.
- Default evaluation order and evaluation-per-call (each call evaluates fresh, left-to-right, later defaults may read earlier params).

## Tests
Unit/integration tests that EXECUTE the emitted server code (in process AND over the HTTP route handler) for: literal default, default calling a pure `fn`, default reading an earlier param, missing vs present arg, `server fn` and server-placed plain `function` (escalated by `?{}`), CPS-split function if it binds params, exported fn called from another file, and the `@`-reading default → E-REACTIVE-003. Put them in `compiler/tests/integration/` or `unit/` following neighbours.

## Verification (do NOT report DONE without these)
- Empirical: recompile the repro above and grep the server bundle for the default; execute it (load the server module and call the handler) and show `"zzx"`.
- R26: recompile real sources — `examples/`, `samples/compilation-tests/`, and `scrml-support/docs/gauntlets/gauntlet-r25/dev-*.scrml` (read-only path `/home/bryan-maclee/scrmlMaster/scrml-support/...`, write outputs under `$HOME/.cache/scrml-agent-tmp/s466-server-param-defaults/`) on base (origin/main, a detached tree you create under `.claude/worktrees/`, symlinked node_modules) and on your branch; report artifact diffs count and every newly-failing file (direction-of-change: this should be semantics-changed only where a server fn has a default; anything else is a regression).
- Gates (all must pass): `bun test compiler/tests/unit compiler/tests/integration compiler/tests/conformance --bail`; `bun scripts/types-gate.ts --check`; bootstrap slice (`bun scripts/lint-no-default-arm.js && bun test ./compiler/self-host-v2/slice-m1/ ./compiler/self-host-v2/slice-m2/ ./compiler/self-host-v2/slice-m3/ ./compiler/self-host-v2/slice-m4/ ./compiler/self-host-v2/slice-codec/`); `bun test compiler/tests/lsp compiler/tests/commands`; `bun scripts/facts.ts --check`; `bun scripts/state.ts --check`; `bun run scripts/regen-spec-index.ts --check`; `bun scripts/corpus-compile-floor.ts --check`.
- Update the gap entry in `docs/known-gaps.md` (status, locus= precise, prov=) and regenerate with `bun scripts/state.ts --write`; if you add a SPEC sentence, add a `> **Provenance:**` line and regen SPEC-INDEX.
- Push: `git push -u origin s466-server-param-defaults`. Do NOT open a PR (the PA reviews first).

## Report (final message, short)
Worktree path; final SHA; governing sentence(s) quoted; locus hypothesis held/refined/wrong + the full list of emit paths fixed; HTTP absent-vs-not decision; R26 differential summary; gate result lines; open questions.
