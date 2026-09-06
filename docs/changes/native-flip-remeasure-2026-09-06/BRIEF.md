# BRIEF — native-flip-remeasure-2026-09-06 (archived verbatim at dispatch time)

Re-measure the native-parser default-flip failure count at HEAD, and COMMIT the harness so it never has to be re-derived again.

change-id: `native-flip-remeasure-2026-09-06`

**This is a MEASUREMENT dispatch, not a fix. Do not fix flip failures. Do not flip the default. The deliverable is a number, a decomposition, and a re-runnable harness.**

## WHY — this serves a standing operator ruling with a re-trigger condition

bryan froze the TS native-parser transition at S222 ("fix only adopter-blockers") and later ruled the V1 path explicitly: *drain the BS/Acorn bug-farm, keep the native parser as the self-host oracle but OFF the V1 path, don't do M5/M6.* One of the three grounds was that **the BS tail is finite once the language freezes** — and he attached a meter to it, verbatim:

> *"if verify-harden stops showing a declining divergence count, the tail isn't finite → M5 earns its cost."*

**That meter has never been read since it was set.** Today an adopter-routed BS-fragility bug (`g-engine-state-child-apostrophe-breaks-parse`) took FIVE adversarial rounds and could not be closed — four of the five each introduced a NEW silent-drop of the same class, because the legacy flat body-scanners cannot represent a nested grammar. The native parser is immune to that class by construction (it has a real body-mode machine). So the meter may have just read the wrong way, and bryan wants the number before deciding.

**Your output decides nothing.** It feeds his ruling. Report honestly even if the answer is "the tail is shrinking fine, the pause holds."

## CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE (F4)

1. `pwd` MUST start with `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-`. If it is `/home/bryan-maclee/scrmlMaster/scrml` you are in the SHARED checkout — STOP.
2. `git rev-parse --show-toplevel` equals that root; `git status` clean.
3. `git merge-base HEAD origin/main` == `origin/main`.
4. `bun install` — a fresh worktree does not inherit `node_modules`.
5. `bun run pretest` — run it PLAINLY from the worktree CWD. ⚑ `bun --cwd <path> run pretest` prints the script list and **exits 0 having done nothing**; verify `samples/compilation-tests/dist/` artifacts actually appeared.
6. `WORKTREE_ROOT="$(pwd)"`, echo it. First commit: `WIP(native-flip-remeasure): start at <that pwd>` **and write this entire prompt verbatim to `docs/changes/native-flip-remeasure-2026-09-06/BRIEF.md`** (single-quoted heredoc).

Edit via Edit/Write on worktree-absolute paths only. NEVER `cd` into the shared checkout. ⚑ **NEVER `git stash`** — `refs/stash` is shared across worktrees here. ⚑ **NEVER a bare `pkill -f` / `killall`** — other agents run suites and every checkout shares the command string; kill by PID captured at launch. Commit incrementally; append to `progress.md`.

## THE MEASUREMENT

**The flip:** `compiler/src/api.js` routes on `const useNativeParser = parser === "scrml-native"` (locate by SYMBOL — `useNativeParser` / `parser === "scrml-native"`; the S161 record cites `api.js:630` and that line number is three months stale). The S161 harness made the default `parser` resolve to `"scrml-native"` in a throwaway worktree and ran the suite.

**The two runs, and the control is not optional:**
1. **CONTROL** — suite at HEAD, unflipped. **This MUST be the known-good baseline.** Today's measured truth on `main`: full `bun run test` = **54 failing**, and that failure set is stable (I ran both sides of an unrelated change and got byte-identical sets). If your control does not reproduce ~54, STOP and report — a control that does not match means the harness is measuring something else, and the whole number is void. S161's control was 0 because it scoped differently; scope yours however you like, but **state the control number and prove the delta is flip-attributable.**
2. **FLIPPED** — same suite, default parser = `scrml-native`.

**flip-attributable failures = FLIPPED minus CONTROL, as SETS not counts.** Use `comm` both directions and report NEW and GONE separately. A count alone hides a swap.

## ⚑ COMMIT THE HARNESS — this is half the deliverable

The roadmap records that the earlier **429** figure is **non-reproducible and retired, because no flip-harness was ever committed**, and S161 then had to rebuild one as a throwaway. That is the obligation-and-probe-resolve-to-different-artifacts failure, and it has now cost two re-derivations. **Land a committed, re-runnable harness** (a script under `scripts/`, or a documented test-mode env var — your call, argue for the shape you pick) so the next person reads the meter with one command instead of reconstructing it. If you conclude a committed harness is genuinely the wrong shape here, say so with reasons rather than silently skipping it.

## THE BASELINE TO COMPARE AGAINST — S170 (2026-06-07), ~230 sessions stale

Trajectory: **1,150 (S161) → ~790 (S162) → 605 (S166) → 525 (S170 W1) → ~508 (S170 W2)**, zero true regressions throughout.

S170 buckets: MISSING-FIELD emit-shape **~296** (dominant) · engine-statechild **~116** · FIELD-SHAPE-other ~21 · each-match-promotion ~11 (residual) · legacy-stage-probe ~14–18 (test-only).

**Decompose your number the same way** — S162's reframe was that the residue is ~6 parser FAMILIES, not N file-fixes, and that framing is what makes the number actionable. If your buckets do not map onto the S170 ones, say so; a changed shape is itself a finding.

## CROSS-AXIS, ALREADY MEASURED TODAY — do not re-derive, but do reconcile

The swap gates on TWO axes. I ran the AST-diff axis today at `f2338816`:

`compiler/tests/parser-conformance-within-node.test.js` → **1012 files, 1012 with divergences, 98,830 total.** Histogram: KIND-NAME 2,849 · FIELD-SHAPE 10,768 · **MISSING-FIELD 30,892** · EXTRA-FIELD 12,124 · COUNT-LENGTH 1,001 · SPAN-COORD 41,196 · NESTED-SHAPE 0 · **PARSE-FAILURE 0**.

Two things to note and reconcile against your behavioural number: **PARSE-FAILURE 0 means the native parser PARSES the whole corpus** — the gap is bridge/promotion fidelity, not parsing. And **SPAN-COORD is 41,196 of the 98,830 but the roadmap's standing policy is TOLERATE** (it costs ~0 test failures and must not be allowed to mislead prioritisation). Say explicitly whether the behavioural residue still tracks MISSING-FIELD emit-shape the way S170 found.

## WHAT I ACTUALLY NEED, in priority order

1. **The number**, with its control and the set-delta.
2. **Direction versus 508** — down, flat, or up. This is the meter. If it is flat or up after three months of BS-patching, that is the finding and it should lead your report.
3. **The family decomposition**, and whether the shape changed.
4. **The committed harness**, so this is the last re-derivation.
5. **Your honest read on effort-to-flip** — a session count or an hour band, with the basis stated. The S111 charter priced the whole front-end at ~239–518h / midpoint ~380h, but much has landed since and that figure is not a remaining-work estimate. Label it INFERRED; a bad estimate labelled as one is useful, an unlabelled one is not.

## SCOPE — out

Do NOT fix flip failures. Do NOT change the default parser outside your throwaway harness. Do NOT touch `compiler/native-parser/` source — it is transition-FROZEN by ruling, adopter-blockers only, and this dispatch is not one. If you find a defect while measuring, FILE it in your report; do not fix it.

## REPORT BACK — under two pages, no narration

Numbers first, prose second. Label every claim `verified by execution` / `verified by reading <file> at <symbol>` / `INFERRED — not measured`. Locate by SYMBOL, never a remembered line. State anything that contradicts this brief — including if the S170 baseline turns out to be unreproducible or mis-scoped, which would itself be the finding. No `--no-verify`, and never override `core.hooksPath`.
