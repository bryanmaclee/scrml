# s459-meta-emit-gate-merge — merge the final ^{} allow-list round into the runtime meta.emit gate, then build the `data-scrml-*` refusal

## CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE (do first; stop and report if any check fails)
Path-discipline incidents to date: several (S99 ×4, S456 ×1). Do not add one.
1. `pwd` must start with `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-`. Call it WT.
2. `git -C "$WT" rev-parse --show-toplevel` == WT; `git -C "$WT" status --porcelain` is empty.
3. `bun install` in WT; then `bun run pretest` run PLAINLY from WT (never `bun --cwd <path> run`, which silently no-ops) and confirm `samples/compilation-tests/dist/` was produced.
4. Every Read/Write/Edit uses an ABSOLUTE path under WT. NEVER `cd` into /home/bryan-maclee/scrmlMaster/scrml. Use `git -C "$WT"`.
5. NEVER `git stash` (shared across all worktrees). NEVER `pkill -f`/`killall` by pattern — kill only PIDs you started.
6. TMPDIR=$HOME/.cache/scrml-agent-tmp/s459-meta-emit (set per command; never inside a repo). Delete your scratch before the final report.
7. First commit: `WIP(s459-meta-emit): start at $(pwd)`.

## MAPS — REQUIRED FIRST READ
Read `$WT/.claude/maps/primary.map.md` first (stamp `8ce6d61b5`, 2026-10-08; main has since moved only by docs/SPEC-text commits #1355–#1358) and follow its Task-Shape Routing for codegen + meta. Treat map content as a hypothesis to verify against source. Report whether the maps were load-bearing.

## Brief archival
Copy this entire brief verbatim to `$WT/docs/changes/s459-meta-emit-gate-merge/BRIEF.md` and commit it as your second commit. Keep `$WT/docs/changes/s459-meta-emit-gate-merge/progress.md` (append-only, timestamped). Commit after EVERY meaningful change (WIP commits expected) — your branch + progress.md are your crash-recovery anchor. Context budget: if you pass ~650k tokens, commit, write progress.md, and report.

## Step 1 — base
`git -C "$WT" fetch origin` then `git -C "$WT" checkout -B s459-meta-emit-gate worktree-agent-aed308bedcd0a3822` (local branch in the shared repo; tip 228b0be22 — the runtime `meta.emit` gate, S458 ruling "a"). Read its `docs/changes/s458-runtime-meta-emit-gate/{BRIEF,progress}.md`.

## Step 2 — merge the final allow-list round
`git -C "$WT" merge worktree-agent-a8630d8539c6308b0` (tip a55464de4 — the `^{}` allow-list final fix round F1–F7; read `docs/changes/s458-meta-final/{BRIEF,progress}.md`). Then `git merge origin/main`. Resolve conflicts as real 3-way merges — never take a side wholesale on a source file. Generated docs (docs/FACTS.md, compiler/SPEC-INDEX.md, docs/known-gaps.md §0, docs/bootstrap-conformance.md): take either side then REGENERATE with their scripts (`bun scripts/facts.ts --write`, `bun run scripts/regen-spec-index.ts`, `bun scripts/state.ts --write`, and the bootstrap-conformance regen named in .github/workflows/ci.yml) and confirm each `--check` passes. Run the core suite. Commit.

## Step 3 — build the `data-scrml-*` refusal (bryan ruling S458, "your recs on all four", item 3 — verbatim)
> **`data-scrml-*` in emitted markup:** the `data-scrml-` attribute namespace is compiler-owned (runtime markers: `data-scrml-meta`, `-outlet`, `-each-mount`, `-gated`, …), like the `_scrml_` / `__scrml_` name reservation — a `data-scrml-*` attribute in `emit()` output (compile-time) and in runtime `meta.emit` output is REFUSED (compile-time: E-META-EVAL-002; runtime: the meta.emit gate refuses + §19.6.8 log). Whether author-written SOURCE markup may carry `data-scrml-*` is not ruled here — measure and surface at build.

- Compile-time: the allow-list branch already refuses non-plain `emit()` output with E-META-EVAL-002 — add `data-scrml-*` attribute names (case-insensitive, as the HTML parser would read them) to that refusal on the SAME reader that judges the rest of emit output. No second reader.
- Runtime: the meta.emit gate (this branch) judges `meta.emit(html)` output — add the same rule there, same reader as its other attribute checks; refusal = nothing written + §19.6.8 log, exactly like its existing refusals.
- Exempt-by-name lists are forbidden; this is a prefix rule over attribute names as the HTML tokenizer sees them (watch: uppercase, attributes with no value, attributes split by `/`, entity-encoded names are NOT decoded by HTML attribute-name tokenizing — confirm behaviour with the real parser your gate uses).
- SPEC: amend §22.4.1 / §22.5.1 (and E-META-EVAL-002's §34 row) with the rule, with a `> **Provenance:** ruling:user-voice-scrml.md S458 "your recs on all four"` line. Also apply the two CONFIRMED text changes from the same ruling item 4 if not already on the branch: (a) §22.5.1's `meta.emit` row drops the "escape-sequence normalization" claim; (b) §22.5's impl#1 note admitting a function for the bindings argument.
- Conformance: add a negative case for each (compile-time + runtime) and a positive case showing ordinary `data-*` attributes still pass, following the conformance/ data format already used for E-META-EVAL-002.
- MEASURE (do not change): how many corpus SOURCE files (samples/, examples/, stdlib/, conformance/) carry author-written `data-scrml-*` attributes outside `^{}`; list them in progress.md and the report — that is a separate ruling for bryan.

## Step 4 — verify
- Core suite: `bun test compiler/tests/{unit,integration,conformance} --bail` = 0 fail. Browser tier: run the browser-tier gate step exactly as `.github/workflows/ci.yml` invokes it.
- `bun conformance/run.ts` — no regressions vs the merged base.
- Corpus differential: compile the samples/examples corpus at the merged base (before Step 3) vs your tip; every diff must be explained (expected: none outside the new refusal).
- Pre-commit hook runs the core suite: never `--no-verify`, never touch core.hooksPath.

## Final report
WT path · final SHA · branch name · merge conflicts and how each was resolved · files touched by Step 3 · test/conformance/differential results (executed) · the source-markup `data-scrml-*` count · anything not done. Do NOT push.

## S459 addendum

PA addendum to your brief (s459-meta-emit-gate-merge) — add this as Step 3b after the data-scrml-* work; append it verbatim to your BRIEF.md under "S459 addendum". The base allow-list branch (a55464de4) is now PR #1359, landing to main as-is; these are its review nits, to land on YOUR branch:

1. MED (pre-existing, also on main): in a COMPILE-TIME `^{}`, `while`, `function` and `match` statements are silently dropped — `meta-eval.ts` `serializeNode` returns "" in its `default:` while reader 1 admits them (e.g. a `while (i<3)` loop building `<li>`s renders `<ul></ul>` with no diagnostic). Reproduce first. Then: grep SPEC §22 (esp. §22.4, §22.12) for whether these statements are legal in compile-time meta. If a governing sentence admits them → make the serializer EMIT them (conformance restoration). If none → refuse every statement kind the serializer cannot emit, with a diagnostic naming the kind (fail closed), and measure the corpus count. Either way: no statement kind admitted by reader 1 may be dropped — make that true by construction (the serializer's default case must refuse, not return "").
2. LOW: a `function wrap(){}` inside compile-time `^{}` reports "E-META-001 'wrap' is not available … not a local binding" — wrong cause; falls out of #1.
3. LOW: a runtime `^{}` reading `window` reports E-META-001 twice (both checkers) — report once.
4. LOW: the E-META-001 message for a plain `x = …` reassignment is broken ("…or declare a new `const` is not admitted…") — fix the wording.
5. LOW docs: §22.5.2 still says "The compiler SHALL emit `capturedBindings` as an object literal" while the ruled form emits a function (the §22.5 note) — reconcile §22.5.2 to the ruled form.
6. LOW (open from the prior review): `_SCRML_DEFAULT_MESSAGES` / `_SCRML_TAG_TO_VALIDATOR` are plain `{}` at runtime-template.js (~:4948, ~:4986) — use null-prototype objects (or the same author-keyed registry shape) so a key like "constructor" cannot read Object.prototype.
Report each with executed evidence. Rebase note: when #1359 merges, `git merge origin/main` should be a no-op for those files since you already merged a55464de4.
