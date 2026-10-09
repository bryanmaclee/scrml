# BRIEF — s460-presence-a-prime (verbatim dispatch prompt)

## CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE
1. `pwd` MUST start with `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-`; `git rev-parse --show-toplevel` equals it; `git remote -v` names `bryanmaclee/scrml.git` (NOT scrml-support); else STOP + report.
2. `git fetch origin && git checkout -B s460-presence-a-prime origin/main`; assert `git merge-base HEAD origin/main` == `git rev-parse origin/main`.
3. `bun install`; `bun run pretest` plainly from the worktree dir (`bun --cwd <p> run` without `=` silently no-ops).
4. Absolute paths under your worktree only; never `cd` into `/home/bryan-maclee/scrmlMaster/scrml`; no `git stash`; no pattern `pkill`/`killall`; never `--no-verify`/hooksPath override. `TMPDIR=/home/bryan-maclee/.cache/scrml-agent-tmp/s460-presence/` per command.
5. First commit: this prompt verbatim → `docs/changes/s460-presence-a-prime/BRIEF.md` + `progress.md` (`WIP(s460-presence-a-prime): start at $(pwd)`). Commit after each phase; code + tests one commit; timestamped progress lines.

## MAPS — REQUIRED FIRST READ
`.claude/maps/primary.map.md` + routing for SPEC edits and `compiler/self-host-v2/` (the bootstrap). Loci are hypotheses.
## Writing scrml (the bootstrap is scrml source) — read BOTH before any code, re-read before each phase
`/home/bryan-maclee/scrmlMaster/scrml-support/docs/gauntlets/BRIEFING-ANTI-PATTERNS.md` and `docs/articles/llm-kickstarter-v2-2026-05-04.md`. Match the surrounding bootstrap code's idiom exactly.

## The ruling (bryan, S460 "a′, go") — verbatim record: `/home/bryan-maclee/scrmlMaster/scrml-support/user-voice-scrml.md` §S460, entry "RULED — a′, go". Summary:
- bare `x` in a condition (logic if/while/ternary test; markup if=/else-if=) of type `T | not` = typed presence test (`""`/`0`/`false` present), narrows where true (S440 Q1 / S442 kept);
- bare `bool` = boolean test; any other KNOWN type = E-COND-NOT-BOOLEAN (S440 #4(c)); bare `bool | not` = error naming both fixes (S442);
- NEW: bare `x` whose type the compiler CANNOT resolve = ERROR naming the fixes (annotate it, or write `x is given` / `x == true`). Supersedes S440 Truthiness Q2 "silence where the type is unknown" FOR CONDITIONS;
- explicit pair for value positions / compounds: `x is given` / `x is not`; `!`/`&&`/`||` booleans only (S440 Gotcha Q2 kept).
- NOT ruled, do NOT implement: retiring `is some`, retiring `given`-as-presence, the §55 validator name. Leave `is some` working wherever it works today.
Background + evidence: `/home/bryan-maclee/scrmlMaster/scrml-support/docs/deep-dives/one-presence-test-dpa-070-2026-10-08.md` (§1, §2 governing text, §6 caveats, §11 defects) and `.../dpa-070/s460-measure/RESULTS.md`.

## Phase 0 — governing-sentence gate (record in progress.md; QUOTE each)
Read IN FULL: SPEC §42 (esp. §42.2.2a, §42.2.4 `is given`, §42.3.5, §42.4, §42.10), §17.1 (if=/show=), §5.2 (atomic unquoted values), §7.2.2 if it states condition rules, and every place S440 #4(c)/Q1/Q2 or S442 landed as SPEC text (grep `E-COND-NOT-BOOLEAN`, `provable-or-silent`, `presence test`). List each sentence the ruling CHANGES and each it KEEPS. Note the SPEC self-contradictions dpa-070 D12 lists (§42.2.2a vs §42.3.5; §42.4 "not is falsy" wording) — resolve those touched by this ruling consistently with it.
## Phase 1 — SPEC text
Amend §42 (+ §17.1 example `if=@errorMessage` — rewrite to a ruled form; + §34 rows) to state the ruling normatively. The NEW unresolved-type error: reuse E-COND-NOT-BOOLEAN if its §34 meaning fits ("condition is not a boolean or a `T | not` presence test") with a distinct message for the unknown-type case, else propose a new code (e.g. `E-COND-TYPE-UNKNOWN`) — choose, and justify in progress.md. Every amended section carries `> **Provenance:** ruling:user-voice-scrml.md S460 "a′, go" · supersedes: ruling:user-voice-scrml.md S440 Truthiness Q2 (conditions only)`. Status: Nominal on impl#1 (impl#1 keeps today's behaviour per S440 Q2 — say so in the text); normative for the bootstrap. Regenerate SPEC-INDEX / FACTS by script.
## Phase 2 — conformance cases (`conformance/cases/`, DATA not TS — read existing case format first)
Codes-half for: typed presence admitted (`T | not` bare in if / if= / else-if= / ternary / while), bool admitted, int/string/array bare → E-COND-NOT-BOOLEAN, `bool | not` bare → error, UNRESOLVED-type bare (unannotated function parameter; a foreign/host value) → the new error, `x is given` / `x is not` in value positions admitted, `!x` on `T | not` refused. Mark impl#1 divergence the way existing bootstrap-only cases do (find the convention; e.g. xfail for impl#1) — do not make impl#1 fail.
## Phase 3 — bootstrap typer (`compiler/self-host-v2/analyze.scrml`; dpa-070 cites :322-326, :8960, :9023-9040 — verify)
Change the provable-or-silent path for CONDITIONS to provable-or-error: a bare condition whose type is unresolved fires the error. Keep the S440 provable-or-silent behaviour for every NON-condition rule. Fix the stale comment at ~:9023-9038 (dpa-070 P1/P2). Bootstrap tests: extend `slice-m2/typer-s440.test.js` (or sibling) with each Phase-2 shape. If the bootstrap cannot parse a shape (it lacks `is some`; check whether it parses `is given` / `is not`), do NOT add parser features beyond `is given`/`is not` — if those are missing and small to add, add them; else STOP and report.
## Phase 4 — measure + gates
Run the bootstrap over its own test corpus / self-host sources to count new errors (report; a non-zero count in the bootstrap's own sources must be fixed by annotating, and listed). impl#1 corpus must be byte-identical (it is unchanged) — prove with a differential on samples/examples/conformance/stdlib. Gates: pre-commit core; `bun conformance/run.ts` 0 FAIL; bootstrap test suites per `.github/workflows/ci.yml` (self-host-v2 / bootstrap-conformance steps — run exactly; regen `docs/bootstrap-conformance.md` by script); `bun run types:check`; host-global-scan.

## Report
Final SHA, governing sentences changed/kept, the code choice, files, conformance cases added, bootstrap self-count of new errors, impl#1 byte-identity proof, gate counts. Context budget ~500k — commit per phase so a crash loses little.
