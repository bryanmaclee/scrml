# s459-uq-merge-main — merge main (host-global alias #1361 + ^{} allow-list #1359 + README + private) into the unquoted-values + `event` branch

## CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE (do first; stop and report if any check fails)
1. `pwd` must start with `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-`. Call it WT.
2. `git -C "$WT" rev-parse --show-toplevel` == WT; `git -C "$WT" status --porcelain` empty.
3. `bun install` in WT; `bun run pretest` PLAINLY from WT (never `bun --cwd <path> run`); confirm `samples/compilation-tests/dist/` exists.
4. ABSOLUTE paths under WT for every Read/Write/Edit; NEVER `cd` into /home/bryan-maclee/scrmlMaster/scrml; `git -C "$WT"`.
5. NEVER `git stash`; NEVER `pkill -f`/`killall` by pattern. Scratch under $HOME/.cache/scrml-agent-tmp/s459-uq-merge (TMPDIR there per command if allowed).
6. First commit: `WIP(s459-uq-merge): start at $(pwd)`.

## MAPS — REQUIRED FIRST READ
`$WT/.claude/maps/primary.map.md` (stamp `8ce6d61b5`; main since: #1359 ^{} allow-list, #1176 README, #1360 private, #1361 host-global alias — `_scrml_g`, codegen/host-global-alias.ts, fn-name-rename.ts, scripts/host-global-scan.ts). Verify against source; report whether load-bearing.

## Archival + crash recovery
Copy this brief verbatim to `$WT/docs/changes/s459-uq-merge-main/BRIEF.md` (second commit); timestamped progress.md beside it; commit after each meaningful change. Context budget: at ~650k tokens commit, write progress, report.

## Base
`git -C "$WT" fetch origin` → `git -C "$WT" checkout -B s459-uq-merge worktree-agent-a8c25b28dfe69bc8d` (tip 417fa38a3 — S457 rulings 3a/4a: one shared reader `compiler/src/unquoted-attr-value.ts` for unquoted attribute values read WHOLE; `E-EVENT-UNBOUND` on the final emitted client text via `codegen/listener-event-check.ts`; reviewed READY at S458). Read `docs/changes/s457-unquoted-values-and-event/{BRIEF,progress}.md` and `docs/changes/s458-uq-determinism/{BRIEF,progress}.md`. Then `git merge origin/main` (6fcde7f7e).

## Step 1 — the merge (real 3-way; never take a side on a source file)
~20 source files overlap with main (alias touched emit-channel/client/each/event-wiring/lift/logic/variant-guard/worker, fn-name-rename.ts, codegen/index.ts, several browser/unit pins). Resolve so BOTH intents hold: the alias rule (every compiler-emitted host-global reference outside the runtime goes through `_scrml_g`) AND this branch's semantics (unquoted values read whole; `event` refused in bare/inline-block handlers; the wrapper parameter renamed out of the user namespace; E-EVENT-UNBOUND judged on the FINAL emitted client text). Generated docs: regenerate (`bun scripts/facts.ts --write`, `bun run scripts/regen-spec-index.ts`, `bun scripts/state.ts --write`, the bootstrap-conformance regen named in ci.yml) and confirm each `--check`.

## Step 2 — the follow-up the alias unblocks
Per this branch's progress.md: "remove the host-global exception in `ref()`" once the alias lands — the branch carried a temporary host-global name exception (`isHostGlobalName` / fixed host-global list in fn-name-rename.ts or the event check) because compiler host-global refs used to be bare. Now they are `_scrml_g.<name>`. Remove the exception if, and only if, every compiler-emitted host-global reference the check could see is now aliased; prove it with the alias gate (`bun scripts/host-global-scan.ts --check` exit 0) and E-EVENT-UNBOUND's own tests. If any exception is still needed, keep it and state exactly which reference needs it.
⚑ `_scrml_`-prefix trust (S459 lesson): the alias merge earlier this session widened a fail-closed reader that admitted any `_scrml_*` name (the §22.12 boundary). Check every reader THIS branch adds or touches (listener-event-check.ts, unquoted-attr-value.ts, fn-name-rename.ts) for a `_scrml_` prefix admission that `_scrml_g.<host>` could now satisfy where the bare host name was refused — e.g. does E-EVENT-UNBOUND treat `_scrml_g.event` / `_scrml_g` as compiler-owned? Report each reader: SAFE / WIDENED (fixed).

## Verify
- Core suite `bun test compiler/tests/{unit,integration,conformance} --bail` = 0 fail (+ root `compiler/tests/*.test.js`); browser tier exactly as ci.yml; `bun conformance/run.ts` no regressions vs main; `bun scripts/host-global-scan.ts --check` exit 0; gzip SPA counter runtime still < 16384 (`v0-3-x-spa-tree-shake-phase-b.test.js`) and the ratchet passes — if this merge pushes the counter over, STOP and report numbers (do not touch the budget).
- Corpus differential main (6fcde7f7e) vs your tip: every outcome/artifact change is this branch's intended semantics (the S458 differential is in its progress.md — compare classes), none from the merge.
- Pre-commit runs the core suite — never `--no-verify`, never touch core.hooksPath.

## Final report
WT · final SHA · branch · conflicts + resolutions · Step 2 outcome · `_scrml_` sweep table · gates + differential (executed) · gzip numbers. Do NOT push.
