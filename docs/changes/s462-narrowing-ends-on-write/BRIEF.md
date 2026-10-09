# BRIEF — s462-narrowing-ends-on-write

Change-id: `s462-narrowing-ends-on-write`. Dispatched S462 (2026-10-09). Agent: scrml-js-codegen-engineer, isolation worktree. Closes gap `g-narrowing-survives-writes-incl-callee-s460` (HIGH).

## The ruling (quote, do not reinterpret)
bryan, S462, "b" (scrml-support/user-voice-scrml.md §S462). Add to SPEC §42.3.5 (the narrowing rules; grep `#### 42.3.5`) this sentence, verbatim:
> "A write to the narrowed place — direct, in a nested block, or by a call that writes it or whose write set cannot be determined — ends the narrowing from that point; a later member access through it is E-TYPE-046."
with `> **Provenance:** ruling:user-voice-scrml.md S462 "b" · dd:scrml-support/docs/deep-dives/one-presence-test-dpa-070-2026-10-08.md (§6 caveat i)`.
Direction: NEWLY-REJECTING (E-TYPE-046 fires where it did not). Fail-closed: an unresolvable call (call through a function value / callback param / anything whose write set the compiler cannot compute) ENDS the narrowing of every narrowed cell in scope.

## Reproducer (verified by PA on main afe2e9212: exits 0, emitted JS reads `.name` off the cleared cell)
`docs/changes/s462-narrowing-ends-on-write/repro-narrow.scrml` — after the fix: E-TYPE-046 at `@user.name`, exit non-zero.

## Scope
1. SPEC sentence above + any §42.7 normative-statement entry + §34 E-TYPE-046 row wording if it names the trigger. Regenerate SPEC-INDEX/FACTS/bootstrap-conformance as needed.
2. impl#1: the narrowing reader. Locus (PA-located-verify, from the gap's own `searched:` field — NOT traced): `compiler/src/presence-narrowing.ts` (the one §42.3.5 reader landed S460 D1) and `compiler/src/type-system.ts` (E-TYPE-046 reader / discriminateCondition / if-stmt narrowing). Use an existing per-function write-set computation if one exists (grep for write sets / effect analysis in the dependency graph / E-EFFECT-WRITES-STATE machinery) — do not invent a second one if one exists (two readers = a bypass). Report held/refined/wrong.
   - Cases: direct write `@user = not` in the narrowed block; write in a nested block/loop; call to a function that writes `@user` (transitively); call through a function value / callback param (unresolvable → ends); call to a function proven NOT to write `@user` (narrowing survives); writes to a DIFFERENT cell (narrowing survives); the narrowing resumes after a fresh test (`if (@user)` again).
   - Narrowed LOCALS (`const u = …; if (u is given) …`) — a local can only be rebound by assignment in scope; handle direct reassignment; a call cannot write a local (closure capture aside — report what you do).
   - Applies to BOTH narrowing kinds that exist (E-TYPE-046 optional cells, E-TYPE-031 optional fn props) where the same reader governs.
3. Bootstrap (`compiler/self-host-v2/`): the PA was told it already ends narrowing on direct/callee/nested writes — VERIFY, and add the unresolvable-call limb if missing (or file a gap with `locus=`).
4. MEASUREMENT (required before reporting): compile the whole corpus (samples/, examples/, stdlib/, conformance/, the gauntlet-r25 sources in ../scrml-support/docs/gauntlets/) on base vs head; report every site that newly fires, split into (i) fires under the KNOWN-write limb, (ii) fires ONLY because of the unresolvable-call limb. List files+lines. Do NOT migrate non-zero corpus sites unilaterally — report them; the PA decides (a large (ii) count goes back to bryan). Conformance cases that newly fail: report, don't edit expected codes without stating why.
5. Conformance cases: positive + negative for each case in 2.
6. known-gaps: flip `g-narrowing-survives-writes-incl-callee-s460` to resolved only with the evidence; keep `locus=` accurate.

## In-flight siblings (expect shared-file merges at landing; the PA merges)
`s462-given-presence-deprecate` (SPEC §42.2.3, lint), `s462-is-some-deprecate` (SPEC §42.2.2a/§42.2.5/§55, may touch presence-narrowing.ts to make `is given` narrow everywhere). Don't touch their concerns. PR #1380 (given @cell lowering) — don't touch.

## Process (non-negotiable)
F4 startup gate · `bun install` + `bun run pretest` from the worktree CWD · commit after each change + append-only timestamped `progress.md` · first commit `WIP(s462-narrowing-ends-on-write): start at $(pwd)` · never `git stash` / pattern `pkill` / `--no-verify` / hooksPath · TMPDIR unset or `~/.cache/scrml-agent-tmp/s462-narrowing-ends-on-write/` · run the ci.yml browser-tier step + `bun run types:check` before reporting · past ~70% context: commit, progress.md, report.

## Report
WORKTREE_PATH · FINAL_SHA · files · locus held/refined/wrong · write-set source used · measurement table (i)/(ii) with files · bootstrap disposition · direction-setting choices for bryan's veto.
