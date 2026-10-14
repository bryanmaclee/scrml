## CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE (incident counter: S99/S314/S385 leaks — absolute main-rooted paths or a shared `git stash`)
1. `pwd` MUST start with `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-`; `git rev-parse --show-toplevel` == `pwd`; `git status --short` clean; after `git fetch origin`, `git merge-base HEAD origin/main` == `git rev-parse origin/main` and origin/main MUST contain `4e8dea5e6` (#1418). Any failure: STOP, report, exit.
2. Every Read/Write/Edit uses an ABSOLUTE path UNDER your worktree. Never a main-checkout path; never `cd` into main.
3. NEVER `git stash`, NEVER `pkill -f`/`killall` by command string, NEVER `--no-verify`/hooksPath changes.
4. `bun install`, then `bun run pretest` plainly from the worktree CWD (verify `samples/compilation-tests/dist/` exists).
5. TMPDIR never inside a repo: `TMPDIR=$HOME/.cache/scrml-agent-tmp/s466-timer-field-write` per command. Machine is memory-constrained: targeted tests while iterating, full gates once at the end.
6. `git checkout -b s466-timer-field-write`. FIRST commit: this prompt verbatim → `docs/changes/s466-timer-field-write/BRIEF.md` + `progress.md`, message `WIP(s466-timer-field-write): start at $(pwd)`. Commit after each step; code+tests one unit.

## MAPS — REQUIRED FIRST READ
`.claude/maps/primary.map.md` (stamp `41af4153a`, stale by #1414–#1422 incl. #1418 which introduced the timer structs). Report whether load-bearing.

## Bug — gap `g-timer-struct-field-write-from-function-body-throws-s464` (MED; read the entry in docs/known-gaps.md in full)
`scrml:time` `debounce(fn, ms)` / `throttle` return a `Debouncer`/`Throttler` STRUCT (SPEC §41.21, landed in #1418). Writing a field from a function body — `function setD() { @d.delay = 10 }`, `@s.a.b.delay = 10` — compiles clean then throws at runtime: `cannot write .delay of a Object in place; it is a value. Assign the whole cell.` That advice is wrong: assigning a copy yields a DEAD timer (the timer state is identity-keyed on the struct object). The same write inside an attribute handler mutates in place and works — two paths disagree. Reviewer locus (PA-located — VERIFY): `compiler/src/runtime-template.js` `_scrml_deep_set_copy` (~:2615) refuses any non-plain prototype; the timer struct is built on its own prototype so `_scrml_deep_reactive` leaves it unwrapped. Reviewer probe: `/home/bryan-maclee/.cache/scrml-review-vf-r4/t/c7.scrml` (read-only; copy it).

## Decide by the SPEC (governing-sentence gate)
Read SPEC §41.21 IN FULL and quote the sentence(s) that say what a field write on a Debouncer/Throttler means (the gap notes §41.21 says the fields read "as any struct" and `delay` IS the wait). Two candidate fixes from the gap: (A) the write takes effect on the live timer (in place, prototype kept, reactive notify fires), or (B) refuse at compile time with a timer-specific code. Pick the one the quoted sentence requires. If §41.21 says fields are writable/readable "as any struct", that is (A). If the SPEC is silent or contradicts itself, STOP and report with the quotes — do not invent semantics. Whichever: the function-body path and the attribute-handler path must behave IDENTICALLY (one write path, not two), and the runtime message must never advise the dead-copy fix.

## Tests
Execute (happy-dom or the runtime directly): `@d.delay = 10` from a function body and from a handler both change the live timer's wait (a pending `run(d, …)` honours the new delay per the SPEC's wording); nested `@s.a.b.delay = 10`; a plain struct field write still works exactly as before; a non-timer non-plain-prototype object still refuses as before (don't widen the refusal hole beyond timer structs — identify them by their brand/prototype, not by field names).

## Gates (all must pass)
`bun test compiler/tests/unit compiler/tests/integration compiler/tests/conformance --bail`; `bun test compiler/tests/lsp compiler/tests/commands`; `bun test compiler/tests/*.test.js`; `bun scripts/types-gate.ts --check`; bootstrap slice (`bun scripts/lint-no-default-arm.js && bun test ./compiler/self-host-v2/slice-m1/ ./compiler/self-host-v2/slice-m2/ ./compiler/self-host-v2/slice-m3/ ./compiler/self-host-v2/slice-m4/ ./compiler/self-host-v2/slice-codec/`); `bun scripts/facts.ts --check`; `bun scripts/state.ts --check`; `bun run scripts/regen-spec-index.ts --check`; `bun scripts/browser-baseline.ts --check`. If the runtime shell size ratchet (S459) trips, report the delta.
Update the gap entry (status, locus=, prov=) + `bun scripts/state.ts --write`. Push `git push -u origin s466-timer-field-write`. No PR.

## Report (short)
Worktree; final SHA; governing sentence quoted; A or B and why; locus held/refined/wrong; gate lines.
