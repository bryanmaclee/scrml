# BRIEF — s464-quoted-handler-refused (dispatched by S464 PA, 2026-10-12). change-id: s464-quoted-handler-refused

## Ruling (verbatim, scrml-support/user-voice-scrml.md §S464)
bryan: "I might have jumped the gun here. to clarify, scrml says that onclick= expects unquoted logic, correct?" … "(a) Compile error".
A QUOTED value with no `${…}` on an `on…` event attribute (same name test as SPEC §5.2 rule 1: any attribute whose lowercased name begins with `on`, EXCEPT the exact whole names `one`, `online`, `onboarding`) is a compile error whose message names the unquoted forms (`onclick=fn()`, `onclick={ … }`, `onclick=${…}`). Supersedes §5.2 rule 1's sentence "A quoted event attribute with no `${…}` stays a static string" — for EVENT attributes only (static `href=`/`to=` strings are untouched). Rejected: a raw-JS escape hatch.

## Why
impl#1 writes `onclick="alert(1)"` as an HTML attribute the BROWSER runs as raw JavaScript, unchecked by scrml (types, placement, auto-await, guards); the bootstrap (compiler/self-host-v2) silently empties it. Two readers of one thing → the ruling makes it one rule.

## Work
1. Read SPEC §5.1, §5.2 (rule 1, ~compiler/SPEC.md:1824-1876) and §5.2.2–§5.2.3 in full first.
2. impl#1: refuse. The sibling check for quoted `${…}` handlers (E-ATTR-INTERP-EXECUTABLE) lives near `compiler/src/attr-injection-sink.ts` / `compiler/src/validators/attribute-interpolation.ts` (PA-located-verify — the symptom is the evidence, the locus a hypothesis; report whether it held). Reuse the SAME `on…` name test (one reader, not a second list). Cover every position §5.2 rule 2 enumerates: top level, component bodies, slot content, `<each>` rows, engine state-children, `<match>` arms, `lift` markup, `^{ emit(…) }` markup, and an undeclared call-site attribute written onto an expanded component root.
3. Error code: if an existing code fits exactly, use it; otherwise propose a NEW name in the report and use `E-ATTR-QUOTED-HANDLER` provisionally, flagged as needing the owner's OK (a new code name is the owner's call).
4. ⚑ NOT inside raw content: `<pre>`/`<code>` bodies and other §4.17 raw-content text (e.g. conformance/cases/raw-content/* contain `onerror="…"` as DISPLAY TEXT) are not attributes and must not be refused — add a test proving it.
5. Bootstrap (compiler/self-host-v2): gap `g-bootstrap-braced-nonhandler-value-and-quoted-handler-silently-empty-s462` (handler half) — make it refuse with the same code instead of emitting an empty listener, if the bootstrap has a diagnostic path there; otherwise file the precise locus and leave it.
6. SPEC: amend §5.2 rule 1 (Provenance line, supersedes clause), §34 row, a conformance negative case. Measure the corpus (compile); the PA's rough grep found ~5 uses in 4 conformance files — migrate genuine handler uses to unquoted forms; report each.

Done when: pushed branch `s464-quoted-handler-refused`, pre-commit gate green.

## Rules (all dispatches)
- Commit after each change (WIP commits fine); append timestamped lines to your change's `progress.md`. First commit: archive THIS brief verbatim as `docs/changes/s464-quoted-handler-refused/BRIEF.md`, message `WIP(s464-quoted-handler-refused): start at $(pwd)`. Push your branch to origin at least once mid-way and at the end.
- Governing-sentence gate: quote the SPEC sentence(s) your change implements in progress.md + the final report. Any surface change carries a `> **Provenance:**` line at the amended SPEC section (`ruling:user-voice-scrml.md S464 "<verbatim>"`).
- Newly-rejecting changes: MEASURE corpus impact by compiling (not grepping) samples/, examples/, stdlib/, conformance/, benchmarks/; report counts + files. Prove each new test FAILS without the fix.
- Generated docs (`docs/known-gaps.md` §0, `docs/FACTS.md`, `compiler/SPEC-INDEX.md`, `docs/bootstrap-conformance.md`): regenerate with their scripts (`bun scripts/state.ts --write`, `bun scripts/facts.ts --write`, `bun run scripts/regen-spec-index.ts`, `bun scripts/bootstrap-conformance.ts --write`), never hand-edit. Other PRs land on main while you work: `git merge origin/main` before your final push; resolve generated docs by regenerating, gap entries by keeping both sides.
- Keep tool output small (pipe through tail/grep). Scratch in `<worktree>/.tmp/`; TMPDIR=~/.cache/scrml-agent-tmp/s464-quoted-handler-refused/ set per command; delete .tmp before reporting. Never `git stash`; never a bare `pkill -f`/`killall`; never `--no-verify`. Do NOT open or merge a PR — the PA reviews and lands.
- MAPS: `.claude/maps/primary.map.md` (stamp 41af4153a; ~10 commits behind HEAD — treat as a hypothesis, verify against source). Report whether it was load-bearing.

## CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE (incidents so far this session: 0)
1. `pwd` must start with `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-`; `git rev-parse --show-toplevel` must equal it; tree clean. If not → STOP and report.
2. `bun install`, then `bun run pretest` from the worktree CWD (NOT `bun --cwd <path> run`, which silently no-ops).
3. Every Read/Edit/Write uses an absolute path UNDER your worktree. Never write to `/home/bryan-maclee/scrmlMaster/scrml/<anything not under .claude/worktrees/agent-…>`. Never `cd` into the main checkout; use `git -C <worktree>`.

## Final report
Worktree path, final SHA, branch pushed, files touched, governing sentences, corpus counts, tests (before/after), deferred items, maps load-bearing?
