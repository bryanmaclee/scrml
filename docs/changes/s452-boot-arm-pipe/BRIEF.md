# BRIEF — s452-boot-arm-pipe (archived verbatim)

start at /home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-a6a94c9a36607e045

CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE (path-discipline incidents to date are non-zero).
1. `pwd` MUST start with /home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent- ; `git rev-parse --show-toplevel` == pwd; clean tree. `git fetch origin main`; `git merge-base HEAD origin/main` MUST equal `git rev-parse origin/main` (else `git merge --ff-only origin/main`; if that fails STOP). Expected base ≥ e7fb5fba5.
2. Every Read/Write/Edit uses an ABSOLUTE path under YOUR worktree root; never write under /home/bryan-maclee/scrmlMaster/scrml/ outside it; never `cd` into the main checkout.
3. NEVER `git stash`; NEVER `pkill -f`/`killall`.
4. `bun install`, then `bun run pretest` from your worktree cwd. Scratch under "$WT/.tmp/" (delete at end). TMPDIR if set → ~/.cache/scrml-agent-tmp/s452-boot-arm-pipe.
5. First commit: archive THIS ENTIRE PROMPT verbatim as docs/changes/s452-boot-arm-pipe/BRIEF.md (body `start at $(pwd)`); progress.md append-only. Code + tests in one commit. Never --no-verify. Pre-commit timeout 300000. Run git commands singly.
6. Push as `feat/s452-boot-arm-pipe` (normal push). Do NOT open/merge a PR.

MAPS: .claude/maps/primary.map.md (stamp d3e660a08; post-map: #1274 landed the bootstrap rulings round — one shared arm parser `parseArms` in compiler/self-host-v2/parse.scrml for `match` + `!{}`; a leading `|` on a `match` arm is E-PARSE-ARM; the legacy `|` and the paren-free binder after it parse in `!{}`). Report whether load-bearing.
AUTHORING scrml: read /home/bryan-maclee/scrmlMaster/scrml-support/docs/gauntlets/BRIEFING-ANTI-PATTERNS.md (read-only) and mirror surrounding bootstrap idiom exactly.
CONCURRENCY: a sibling dispatch adds the same lint + a `scrml fix` rule to impl#1 (compiler/src/) and migrates the corpus — do NOT touch compiler/src/, conformance/, examples/, samples/, stdlib/.

TASK: in the bootstrap compiler (compiler/self-host-v2/), emit **W-ARM-PIPE-LEGACY** (Info) once per `|`-led arm in a `!{}` handler (and once per `|`-led engine message arm IF the bootstrap parses message arms at all — report whether it does). SPEC: compiler/SPEC.md §19.4.5 (read IN FULL — the legacy rule, the "parses identically" requirement, the W-lint/E-code table) and §63.1–§63.2. The `|`-led arm must still lower to identical Core (it does today — prove it stays so); the lint is Info, so it must NOT close the artifact gate (`hasError` keys on severity — W-ARM-PIPE-LEGACY must be Info in the generated severity table: add/regenerate via scripts/gen-bootstrap-severity.ts after confirming the §34 row says Info). Update the §34 row's bootstrap "not yet emitted" status if the row states it per-implementation (cite the emit site by function name) — that is the ONLY SPEC.md edit allowed; run `bun run scripts/regen-spec-index.ts` + `--check`, `bun scripts/s34-census.ts --check-new`, `bun scripts/facts.ts --check`.
Tests (slice-m4, run BY PATH — see .github/workflows/ci.yml): the lint fires once per `|` arm (pipe-less arms: none), Core identical with/without the `|`, a program with only `|` arms still produces a Core, the paren-free binder after `|` still lints. Counter: `bun scripts/bootstrap-conformance.ts` PASS must stay ≥119 (an Info code on a case that doesn't expect it — check how the counter grades unexpected Info codes; report any case that moves and why); regenerate docs/bootstrap-conformance.md, `--check`. `bun scripts/gen-bootstrap-severity.ts --check` current.
FINAL REPORT (<350 words): FINAL_SHA (== pushed tip), files, tests, counter before/after with any case moves, `git status` clean.
