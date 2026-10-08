# s459-alias-merge-main — merge main (incl. #1359 the ^{} allow-list) into the host-global alias, alias the new code, harden the gate

## CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE (do first; stop and report if any check fails)
1. `pwd` must start with `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-`. Call it WT.
2. `git -C "$WT" rev-parse --show-toplevel` == WT; `git -C "$WT" status --porcelain` empty.
3. `bun install` in WT; `bun run pretest` run PLAINLY from WT (never `bun --cwd <path> run`); confirm `samples/compilation-tests/dist/` exists.
4. Every Read/Write/Edit uses an ABSOLUTE path under WT. NEVER `cd` into /home/bryan-maclee/scrmlMaster/scrml. Use `git -C "$WT"`.
5. NEVER `git stash`. NEVER `pkill -f`/`killall` by pattern — kill only PIDs you started.
6. TMPDIR=$HOME/.cache/scrml-agent-tmp/s459-alias-merge per command; delete scratch before the final report.
7. First commit: `WIP(s459-alias-merge): start at $(pwd)`.

## MAPS — REQUIRED FIRST READ
`$WT/.claude/maps/primary.map.md` (stamp `8ce6d61b5`; main has since landed #1359 — the `^{}` allow-list: meta-eval.ts, codegen/meta-capture-rewrite.ts, emit-logic.ts case `meta`, runtime-template.js registries). Follow routing for codegen + runtime. Verify against source. Report whether load-bearing.

## Brief archival + crash recovery
Copy this brief verbatim to `$WT/docs/changes/s459-alias-merge-main/BRIEF.md` (second commit); append timestamped lines to `progress.md` beside it. Commit after EVERY meaningful change. Context budget: at ~650k tokens, commit, write progress.md, report.

## Base
`git -C "$WT" fetch origin` → `git -C "$WT" checkout -B s459-alias-merge worktree-agent-a6de1485d0e8ee3ac` (tip d09def0c9 — the host-global alias, S457 ruling 2a, round 3; S459 differential review LAND-WITH-NITS). Read `docs/changes/s457-host-global-alias/{BRIEF,progress}.md` and `docs/changes/s458-alias-r3/{BRIEF,progress}.md`. Then `git merge origin/main` (main = 49b7fcc1d, includes #1359).

## Step 1 — the merge (real 3-way; never take a side on a source file)
PA trial merge found conflicts in `compiler/src/codegen/emit-logic.ts` (alias's `_scrml_g.Object.freeze({…})` vs main's thunk `() => Object.freeze({…})` + new `emitInternalCaptureObject`), `compiler/src/runtime-template.js` (alias's `var _scrml_g = globalThis;` first line vs main's `Object.create(null)` registries), `docs/FACTS.md` (regenerate). Resolve so BOTH intents hold: main's semantics (per-run thunk; internal capture object; null-prototype registries) AND the alias rule (every compiler-emitted host-global reference outside the runtime goes through `_scrml_g`). Inside the runtime itself follow the alias branch's existing convention.

## Step 2 — alias the code #1359 added
#1359 added compiler emissions that reference host globals (e.g. `Object.freeze`, possibly `Object.create`, `Reflect`, timers in the runtime `meta` API). Run the gate `scripts/host-global-scan.ts --check` (its full 5-mode run) after the merge; every R1/R2/R3/R4 violation on main's new code must be fixed by spelling it through the alias, at the emitter (one reader — the alias branch's existing helper), not by gate exemption. Zero violations at the end.

## Step 3 — gzip budget
The SPA-counter runtime gzip gate is < 16384 B (default `gzipSync`); the alias branch measured 16382 B (2 B margin) BEFORE #1359, and #1359 changed the runtime. Measure after the merge (the runtime-size ratchet test + the counter shape — find both in compiler/tests). If it is over: report the numbers and the bytes each side added; do NOT raise the budget and do NOT minify/strip semantics to squeeze it — stop at that point and report (the budget is bryan's call). If under: report the margin.

## Step 4 — gate hardening (review nit N2, LOW)
`host-global-scan.ts` R1 skips a name when that word appears ANYWHERE in the author source (comments, strings, markup) — `usesName` is a word regex over raw text, so it under-reports (reverting one `_scrml_g.document` site produced only 9 hits; `document` appears in 20/71 examples). Also it `catch { continue; }`s a unit whose compile throws. Fix: judge "author wrote this name" from author CODE only (strip comments/strings/markup text — prefer a real tokenizer/parse of the logic over regex), and count/report thrown units instead of silently skipping (fail toward reporting). Prove the bite again: on a scratch COPY revert one `_scrml_g.document` emitter site → gate red with materially more hits than 9; restore → green.

## Verify
- Core suite `bun test compiler/tests/{unit,integration,conformance} --bail` = 0 fail; browser tier exactly as `.github/workflows/ci.yml` runs it; `bun conformance/run.ts` no regressions vs main.
- `bun scripts/host-global-scan.ts --check` exit 0; FACTS/SPEC-INDEX/state `--check` pass.
- Corpus differential main (49b7fcc1d) vs your tip: every artifact change is alias-spelling, the runtime alias line, worker IIFE, or library `_scrml/_global.js` import (the classes the S459 review enumerated); anything else explained.
- Re-run the review's Chromium check: user `const globalThis = 2`, `function fetch`, `function document`, server fns `Response`/`JSON` → page works (the alias review's `scripts/` under `/home/bryan-maclee/.cache/scrml-agent-tmp/s459-rev-alias/` has the probes — read-only, copy what you need). Plus one `^{}` runtime block on a page with a user `function fetch` — meta still works.
- Pre-commit runs the core suite — never `--no-verify`, never touch core.hooksPath.

## Final report
WT · final SHA · branch · each conflict + resolution · Step 2 sites aliased · gzip numbers · gate hardening + bite proof · test/differential/Chromium results (executed) · anything not done. Do NOT push.
