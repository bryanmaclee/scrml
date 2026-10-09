## CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE
1. `pwd` MUST start with `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-`; `git rev-parse --show-toplevel` equals it; else STOP + report.
2. `git fetch origin && git checkout -B s460-onclient-shadow origin/main`; assert `git merge-base HEAD origin/main` == `git rev-parse origin/main` (expect `b4b94f3d6` or later).
3. `bun install`; `bun run pretest` plainly from the worktree dir.
4. Absolute paths under your worktree only; never `cd` into `/home/bryan-maclee/scrmlMaster/scrml`; no `git stash`; no pattern `pkill`/`killall`; never `--no-verify` / hooksPath override. `TMPDIR=/home/bryan-maclee/.cache/scrml-agent-tmp/s460-onclient/` per command.
5. First commit: this prompt verbatim → `docs/changes/s460-onclient-shadow/BRIEF.md` + `progress.md` (`WIP(s460-onclient-shadow): start at $(pwd)`). Commit incrementally; code + tests one commit.

## MAPS — REQUIRED FIRST READ
`.claude/maps/primary.map.md` + routing for channels (§38) / diagnostics. Loci are hypotheses.

## The ruling (bryan, S458 "your recs on all four", item 1 — verbatim record in `/home/bryan-maclee/scrmlMaster/scrml-support/user-voice-scrml.md` §S458)
"**`onclient:*` first-argument shadowing:** extend E-CHANNEL-005 (today `onserver:message` only — >1 parameter) to `onclient:*` calls with more than one argument; and a first-argument name that collides with a declaration in scope is an ERROR (no silent shadowing). Newly-rejecting; measure the corpus at build."
Origin (S458 review nit a): `onclient:open=onOpen(x, 1)` silently shadows a declared `x` — the handler parameter binding hides the outer declaration.

## Governing-sentence gate (do this FIRST, record it in progress.md)
Read SPEC §38 in full (channels; handler attributes `onserver:*` / `onclient:*`, the "handler attribute params are function-local locals" rule) and the §34 E-CHANNEL-005 row. Quote the governing sentences. The SPEC text must be amended to state the ruled rule (E-CHANNEL-005 scope extended to `onclient:*` with >1 argument; collision of the bound first-argument name with an in-scope declaration = error — name the code: reuse E-CHANNEL-005 if its meaning fits, else propose a new code and STOP to report before minting it). Carry `> **Provenance:** ruling:user-voice-scrml.md S458 "your recs on all four" item 1` inline at the amended section.

## Build
- Locate where E-CHANNEL-005 fires for `onserver:message` today (PA has NOT traced it — find it and report the path from parse to diagnostic) and extend it to every `onclient:*` handler. Decide "declaration in scope" from the symbol table / the parsed tree, never from regexing source text (project Rule 7). Cover: state cells, locals, function names, imports, `<each>` `as` aliases, outer handler params.
- Direction: newly-rejecting. **Measure the corpus by COMPILING** samples/, examples/, conformance/cases/, stdlib/ on base and head; report the count + files of newly-refused sources. If NON-ZERO: STOP before migrating anything and report the list (it becomes a ruling).
- Conformance: positive + negative cases for both limbs (arity, collision) on `onclient:*`; regression that `onserver:message` behaviour is unchanged.
- Gates: pre-commit core; `bun conformance/run.ts` 0 FAIL; `bun scripts/host-global-scan.ts --check`; `bun run types:check`; browser step per `.github/workflows/ci.yml`; regenerate SPEC-INDEX / FACTS / bootstrap-conformance by script if touched.

## Report
Final SHA, files, governing sentences quoted, locus found, corpus measurement (base vs head, command + counts), gate counts. Context budget ~300k.
