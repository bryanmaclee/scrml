## CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE
1. `pwd` MUST start with `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-`; `git rev-parse --show-toplevel` equals it; else STOP + report.
2. `git checkout -B s460-d1-land 01b1933cd` (local commit, shared object store); verify `git rev-parse --short HEAD` == `01b1933cd`. This is D1 round 7 merged with main 63423d5fa. Do NOT include `0c22fde5a` or later (round 8 — dropped by ruling).
3. `bun install`; `bun run pretest` plainly from the worktree dir.
4. Absolute paths under your worktree only; never `cd` into `/home/bryan-maclee/scrmlMaster/scrml`; no `git stash`; no pattern `pkill`/`killall`; never `--no-verify` / hooksPath override. `TMPDIR=/home/bryan-maclee/.cache/scrml-agent-tmp/s460-d1-land/` per command.
5. First commit: this prompt verbatim → `docs/changes/s460-d1-land/BRIEF.md` + `progress.md` (`WIP(s460-d1-land): start at $(pwd)`). Commit incrementally.

## MAPS
`.claude/maps/primary.map.md` — read first; loci are hypotheses.

## Task — make D1 round 7 landable (mechanics + gates; NO behaviour changes)
Ruling (bryan S460): D1 lands round 7. A separate reviewer is reviewing `01b1933cd` frozen; do not change behaviour — if a gate fails for a reason that needs a behaviour change, STOP and report rather than fixing.
1. `git fetch origin && git merge origin/main` (main has moved: #1364 dpa bank, #1365 ship-strip, #1366 wrap, and possibly #1367 meta.emit / #1368 gaps by the time you run). Resolve conflicts as real 3-way merges. Generated docs (`compiler/SPEC-INDEX.md` via `bun run scripts/regen-spec-index.ts`, `docs/FACTS.md` via `bun scripts/facts.ts --write`, `docs/bootstrap-conformance.md` and known-gaps §0 via their scripts) are REGENERATED, never picked by side. Record every conflict + resolution in progress.md.
2. Round 8 left SPEC/doc edits? Check `docs/changes/s459-d1-round8/` is docs-only (BRIEF + progress of a stopped round); keep them as history but add a one-line header note in that progress.md: "STOPPED and DROPPED — S460 ruling: D1 lands round 7".
3. Gates the S459 hand-off says were NOT run on this state — run ALL and record counts: pre-commit core gate; `bun conformance/run.ts` (0 FAIL); browser tier exactly as `.github/workflows/ci.yml`'s browser step; `bun scripts/host-global-scan.ts --check`; `bun run types:check` (it is a blocking CI step; if the baseline set changes, `--write` it in the same commit only if the change is caused by D1's own new code, and say so); runtime-size ratchet test.
4. Corpus differential: compile samples/ + examples/ + conformance/cases/ + stdlib/ on origin/main and on your merged head; report outcome changes (exit code / diagnostic codes) with files. Use `scripts/corpus-emit-differential.ts` if it fits (read its header).
5. Two residual SPEC deltas the S459 PA noted — DO NOT fix, but confirm and report each with a reproducer: (a) round 7 narrows under `show=` (vs §42.3.5 / S451 — gap g-impl1-show-narrows-s451); (b) `match` narrowing covers the whole match body.

## Report
Final SHA (the merged, gated head), conflicts + resolutions, gate counts, corpus differential, the two residual confirmations. Do NOT push or open a PR. Context budget ~300k.
