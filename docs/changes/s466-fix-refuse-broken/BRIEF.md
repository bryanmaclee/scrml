## CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE (incident counter: S99/S314/S385 leaks — absolute main-rooted paths or a shared `git stash`)
1. `pwd` MUST start with `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-`; `git rev-parse --show-toplevel` == `pwd`; `git status --short` clean; after `git fetch origin`, `git merge-base HEAD origin/main` == `git rev-parse origin/main`. Any failure: STOP, report, exit.
2. Every Read/Write/Edit uses an ABSOLUTE path UNDER your worktree. Never a main-checkout path; never `cd` into main.
3. NEVER `git stash`, NEVER `pkill -f`/`killall` by command string, NEVER `--no-verify` / hooksPath changes.
4. `bun install`, then `bun run pretest` plainly from the worktree CWD (verify `samples/compilation-tests/dist/` exists).
5. TMPDIR never inside a repo: `TMPDIR=$HOME/.cache/scrml-agent-tmp/s466-fix-refuse-broken` per command if needed.
6. `git checkout -b s466-fix-refuse-broken`. FIRST commit: this prompt verbatim → `docs/changes/s466-fix-refuse-broken/BRIEF.md` + `progress.md`, message `WIP(s466-fix-refuse-broken): start at $(pwd)`. Commit after each step; code+tests are one commit unit.

## MAPS — REQUIRED FIRST READ
`.claude/maps/primary.map.md` (stamp `41af4153a`; main has since landed #1414–#1421). Follow Task-Shape Routing for CLI/commands work; report whether it was load-bearing.

## Ruling (bryan, S464, user-voice-scrml.md — "your recs")
"The client-server-call / sql-failable / s66 `scrml fix` rules SHALL refuse (no rewrite, a message naming the compile errors) any file that does not compile before the rewrite — a rewrite of a file the compiler cannot fully read cannot be verified (matches the S462 markup-given migration's verify-fail-closed)."

## PA reproduction on main `f28b58a31`
```scrml
<program db="./app.db">
${
  function load() { return ?{`SELECT 1 AS a`}.get() }
  function bad() { return @nope + }
}
<p>x</p>
</program>
```
`bun compiler/bin/scrml.js fix b3.scrml --dry-run` → proposes a rewrite (`!{ _ :> not }` on load) and the printed diff ALSO shows the `${` line and the closing `}` line as removed (`-${` with no `+` counterpart; `-}` at line 5). Determine whether that is a dry-run diff-printer defect or a real content loss in the written file (run without --dry-run on a copy and diff). Either way it is in scope: a fix tool that drops braces is a data-loss bug — report it, fix it, pin it.

## Build
- Locate the fix-rule pipeline (`compiler/src/commands/fix*.js` — PA-located, verify). Find how the S462 markup-given migration does its verify-fail-closed pre/post compile and REUSE that mechanism; do not write a second one.
- Rules covered by the ruling: client-server-call, sql-failable, s66. Check every other rule too (arm-pipe, is-some, given-presence, …): if any rewrites a non-compiling file, report which and whether the same refusal applies (the ruling's rationale is general; apply it to every rule that does not already verify, and say so explicitly in the report so the PA can flag it for veto).
- Refusal output: per file, no rewrite, a message naming the compile errors (code + line), non-zero exit when any file was refused (check how `scrml fix` reports exit status today and keep consistent; report the choice).
- Directory mode: refused files are skipped and listed; the rest proceed.
- Pre-existing errors only: a file that compiles with warnings is NOT refused.
- Tests in `compiler/tests/commands/` following neighbours: refused file untouched on disk (byte-identical), message names the error, compiling file still rewritten, dir mode mixed, the brace-loss repro.
- SPEC: if §63.4 / §56 describes `scrml fix` behaviour, add the refusal sentence with `> **Provenance:** ruling:user-voice-scrml.md S464 "your recs"`, regen SPEC-INDEX (`bun run scripts/regen-spec-index.ts`).

## Gates (all must pass)
`bun test compiler/tests/unit compiler/tests/integration compiler/tests/conformance --bail`; `bun test compiler/tests/lsp compiler/tests/commands`; `bun scripts/types-gate.ts --check`; `bun scripts/facts.ts --check`; `bun scripts/state.ts --check`; `bun run scripts/regen-spec-index.ts --check`.
Push `git push -u origin s466-fix-refuse-broken`. Do NOT open a PR.

## Report (short)
Worktree; final SHA; brace-loss root cause (printer vs real); rules changed; exit-status choice; gate result lines.
