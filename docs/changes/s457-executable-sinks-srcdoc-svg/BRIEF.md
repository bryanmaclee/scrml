# BRIEF — s457-executable-sinks-srcdoc-svg (S457) — HIGH, security

CHANGE-ID: `s457-executable-sinks-srcdoc-svg`. Agent: scrml-js-codegen-engineer, isolation worktree.

Two executed sinks from the S457 URL-guard Chromium review (both on base too). Read SPEC §5.2 IN FULL (rules 1-3; rule 3 is
the S457 runtime guard, `compiler/src/runtime-url-guard.js`) and the S456/S457 rulings in
`/home/bryan-maclee/scrmlMaster/scrml-support/user-voice-scrml.md` §S456 ("your recs on 1 and 2") and §S457.
1. `g-srcdoc-unquoted-expression-not-refused-s457` (HIGH): `<iframe srcdoc=${@u}>` compiles clean and runs the data as HTML;
   S456 refuses only quoted `srcdoc="${…}"` (E-ATTR-INTERP-EXECUTABLE). The ruling's purpose ("JavaScript is never built from
   interpolated text"; srcdoc is an HTML document) covers every form that puts data into srcdoc: unquoted `${}`, `=@cell`,
   `<each>` rows, component props reaching a srcdoc, `^{emit}`. Refuse them all with E-ATTR-INTERP-EXECUTABLE (newly-rejecting;
   measure corpus impact by compile — STOP and report if non-zero). Same question for event attributes in their unquoted
   expression form: `onclick=${…}` is the SANCTIONED handler form (a function), so it is NOT refused — check only that no other
   unquoted path builds handler TEXT from data.
2. `g-svg-animation-and-meta-refresh-url-sinks-s456` (HIGH, Chromium-confirmed): `<set attributeName="href" to="${@u}">`
   (also `<animate>`, `values`, `from`, `by`; `xlink:href`) animates an href to a data value → `javascript:` runs on click. Under
   the S457 ruling (runtime guard on data-supplied URL attribute writes), an animation value attribute whose element's
   `attributeName` names a URL-valued attribute IS a URL attribute write. Route those writes through `_scrml_safe_url` (for
   `values`, each `;`-separated entry), and apply rule 2's compile-time literal-scheme refusal to them too. If `attributeName`
   is itself dynamic, fail closed (guard the values). Also: the expression form `to=${@u}` is reported silently DROPPED — fix or
   refuse loudly (do not leave it silent). `<meta http-equiv=refresh>`: Chromium refuses javascript: there; record, no change.
   Extend `runtime-url-guard.js` (ONE reader/one table); amend SPEC §5.2 (rule 2/3 text) with provenance.
Verification: browser (happy-dom) + if available Chromium (`bunx playwright`) execution showing no dialog; byte-identical
controls; corpus differential; conformance cases pinning both.

## CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE (F4) — path-discipline incidents to date: 4 (S99) + S385 stash race + S456 cookie-jar leak

1. `pwd` — MUST start with `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-`. Otherwise STOP and report.
   `git rev-parse --show-toplevel` must equal `pwd`. `git status --short` must be clean.
2. Your base: `git fetch origin && git merge-base HEAD origin/main` must equal `git rev-parse origin/main`; if not, `git merge --ff-only origin/main`.
3. Fetch your brief: `git fetch origin brief/s457b && git checkout FETCH_HEAD -- docs/changes/s457-executable-sinks-srcdoc-svg/` then commit it as your first commit:
   `WIP(s457-executable-sinks-srcdoc-svg): start at $(pwd)` (the PA verifies the worktree prefix in this message).
4. `bun install` (worktrees do not inherit node_modules), then `bun run pretest` run plainly from the worktree CWD
   (NOT `bun --cwd <path> run …` — that silently no-ops). Verify `samples/compilation-tests/dist/` was populated.
5. Every Read/Edit/Write uses an ABSOLUTE path under YOUR worktree root. Never `cd` into `/home/bryan-maclee/scrmlMaster/scrml`
   (the main checkout). Use `git -C "$WT"`. Write NOTHING outside your worktree (scratch: `$WT/.tmp/`, delete before your final report).
   `TMPDIR` must NOT point inside any repo — leave it unset.
6. NEVER `git stash` (the stash is shared across every worktree). Base-vs-build flips by FILE COPY.
7. NEVER `pkill -f` / `killall` on a command string — kill only PIDs you started.
8. Commit after every meaningful change (WIP commits fine); keep `docs/changes/s457-executable-sinks-srcdoc-svg/progress.md` (append-only, timestamped).
   A clean `git status` + committed branch tip before your final report is mandatory. Do not push; the PA lands.
9. Do NOT edit these shared, PA-owned docs: `docs/known-gaps.md`, `docs/FACTS.md`, `compiler/SPEC-INDEX.md`, `docs/changelog.md`,
   `master-list.md`, `hand-off.md`, `docs/pr-reviews.md`, `handOffs/**`. Put the gap-entry text you would write (new entries,
   status flips with resolved-by) in your final report; the PA applies it. (Brief 3 is the one exception, named there.)
10. Never `--no-verify`, never change `core.hooksPath`, never disable a hook. If the pre-commit hook fails, fix the cause or report.

## MAPS — REQUIRED FIRST READ
Read `.claude/maps/primary.map.md` first (stamp `ba2712973`, 2026-10-07; HEAD since then adds only the S456 wrap + maps PRs —
no source change), follow its Task-Shape Routing to the 2-4 maps for your task, treat map content as a hypothesis to verify
against source. In your final report say which map entry was load-bearing (or "not load-bearing").

## Rules of the house (short)
- SPEC `compiler/SPEC.md` is normative. Read the governing section IN FULL (offset/limit) before changing behaviour.
- A locus named below is a PA HYPOTHESIS (located, not traced). Verify it; report whether it held, was refined, or was wrong.
- No `null`/`undefined` in scrml source; `not` is absence. No try/catch/async/await in scrml source.
- Before DONE: run `bun test compiler/tests/unit compiler/tests/integration compiler/tests/conformance` (0 fail is the contract)
  plus `bun conformance/run.ts`, and the empirical check named in your brief (an emitted-artifact check, not "tests pass").
- Final report: worktree path · branch · FINAL_SHA · files touched · tests run + results · empirical check output ·
  direction-of-change class (inert / newly-rejecting / newly-accepting / semantics-changed) with the measurement ·
  gap-entry text for the PA · anything deferred.
