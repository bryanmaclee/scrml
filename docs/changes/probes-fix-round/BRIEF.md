# BRIEF — probes fix round (ruling-debt + inbox-stranded)

> Archived verbatim at dispatch time per the archive-BRIEF-at-dispatch protocol.
> (The brief mandated a single-quoted heredoc; the worktree-isolation guard refused the
> redirect as "too complex to verify", so this was written with the Write tool instead —
> same verbatim round-trip for `$` and backticks.)

---

Fix round on two detection probes in the scrml project. An adversarial review returned LAND-WITH-NOTED-RISK with two HIGH findings; I reproduced both myself by execution. Your job is to close them, plus two smaller ones, without changing what the probes are FOR.

## CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE (do this first, abort if it fails)

1. `pwd` — it MUST start with `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-`. If it does not, STOP and report; do not write anything.
2. `git rev-parse --show-toplevel` must equal that same worktree root.
3. `git status --short` must be clean.
4. **Your worktree is cut from `origin/main`, NOT from the branch you need.** Run:
   `git fetch origin runtime-size-and-probes && git reset --hard FETCH_HEAD`
   Then confirm `git rev-parse --short HEAD` == `5a8f2375`. That commit is your base.
5. `bun install` (a fresh worktree does not inherit `node_modules`).
6. NEVER `cd` into `/home/bryan-maclee/scrmlMaster/scrml` (the main checkout). Use `git -C "$WORKTREE_ROOT"` / `bun --cwd "$WORKTREE_ROOT"` / worktree-absolute paths. Every Write/Edit targets an absolute path under YOUR worktree root. A relative path resolves against the main checkout and is a leak.
7. Commit after each meaningful unit — WIP commits are expected, the branch is your crash anchor. Push after every commit. Also keep `docs/changes/probes-fix-round/progress.md` (append-only, timestamped) updated as you go.
8. First commit: archive this ENTIRE prompt verbatim to `docs/changes/probes-fix-round/BRIEF.md` using a single-quoted heredoc (`cat > ... <<'BRIEFEOF'`) so `$` and backticks round-trip.
9. NEVER use `--no-verify` and NEVER override `core.hooksPath`. If the pre-commit gate blocks you, report it — do not work around it.

## The two files

`scripts/ruling-debt.ts` and `scripts/inbox-stranded.ts`, plus their registration in `scripts/boot.ts`.

**What they are for.** The project diagnosed its bottleneck as DELIVERY: finished work that no probe reads. `ruling-debt` detects a ruling written up but never banked into `handOffs/dpa-queue.md` — the one file the deliberation satellite actually drains. `inbox-stranded` detects an inbox message committed on a branch that never reached `main`, so it is invisible to every other checkout. The governing doctrine both serve: **an obligation and the probe that reads it MUST resolve to the SAME artifact.**

Both are DETECTION, never control. They must never gate, never block a merge, and always exit 0. Do not change that.

## F1 — HIGH. A failed enumeration reports a confident ✓. I reproduced this:

```
$ SCRML_SUPPORT=<a directory with no docs/> bun scripts/ruling-debt.ts
ruling-debt — 0 ruling-shaped artifacts in scrml-support/docs · 0 referenced by the dPA queue · 0 BANKED OUTSIDE THE DRAIN PATH
  ✓ every ruling-shaped artifact is reachable from handOffs/dpa-queue.md.
exit=0
```

`inbox-stranded.ts` has the same shape: its `git()` helper returns `""` on every non-zero exit, so a `git log` failure yields `0 messages · 0 delivered · 0 STRANDED` and a ✓.

This is the exact failure class these probes exist to close — a check reporting green while reading nothing. A treeless clone, a corrupt pack, a permissions change, or a moved sibling repo turns both into permanent decorative green.

**Fix:** distinguish "enumerated successfully and found nothing" from "could not enumerate." When the enumeration failed or its source is missing/unreadable, print a loud marker (NOT ✓) that names what could not be read, and say so in the summary line. Keep exit 0.

## F2 — HIGH. `ruling-debt` resolves its doc surface up to the canonical root but not its queue path.

`resolveSupport()` deliberately walks up to find `scrml-support`; `QUEUE` (around line 64) is built from `ROOT` without the same treatment. So the answer depends on which tree you run from. I reproduced it — same probe, same instant:

```
default (worktree-resolved queue, 277,273 B):   0 referenced · 3 BANKED OUTSIDE
canonical queue pinned (320,123 B):             2 referenced · 1 BANKED OUTSIDE
```

The error runs both ways: a worktree whose branch carries a newer queue entry reads GREEN while `main`'s queue lacks it — which is the delivery bug the probe exists for, one level up.

**Fix:** resolve the queue off the same canonical root the doc surface uses, so the probe answers about the real queue regardless of the tree it runs from. `scrml-support/dpa-scrml.md` names that queue **by absolute path** — that sentence is the obligation; make the probe read the same artifact. Keep the existing `SCRML_DPA_QUEUE` env override working (it is what let me isolate this).

## F3 — a DECISION, already made; implement it.

`ruling-debt`'s docstring calls the `authority-needed:` front-matter field *"the stronger signal."* It is mandated by NOTHING — the review measured exactly 3 files carrying it, and zero contracts, templates, or process docs that require it. A real ruling filed in a third location without the field is invisible to the probe (the reviewer proved this with a fixture).

**Ruling (mine, on the project's fork rule — root-fix and fail-closed both point the same way): MANDATE the field rather than soften the claim.** Two parts, and the second is the one that makes it real:

1. Add the requirement to `../scrml-support/dpa-scrml.md` — a ruling-shaped artifact SHALL carry `authority-needed:` in its front matter. Keep it short and put it where a DD author will actually meet it. **NOTE: `scrml-support` is a SIBLING REPO — do NOT edit it from your worktree.** Instead, write the exact proposed text into `docs/changes/probes-fix-round/DPA-SCRML-AMENDMENT.md` in your worktree and I will apply it. Say so in your report.
2. Make the mandate DETECTED, not hoped for: `ruling-debt` should also count and name ruling-shaped artifacts (front matter carrying `rung:` / `routes-to:` / `requested:`) that are MISSING `authority-needed:`. The review measured 9 such artifacts today, all legitimately queued — so report them as a separate advisory line, not as debt. A rule whose compliance nobody can read is the thing this whole probe family exists to prevent.

## F5 — MEDIUM. The linkage test is a bare substring over a 318 KB prose file.

Around lines 131-135, an artifact counts as "banked" if its filename appears ANYWHERE in the queue. The reviewer showed a passing prose mention — *"we should get around to queueing it one of these days"* — permanently silences the probe. Measured skip-rate on day one: 2 of 3.

Worse, `scripts/dpa-debt.ts` reads the **authoritative TABLE** in that same file and only the table. So one file has two reading rules, and a ruling "queued" with a prose line and no table row is green on one probe and invisible to the other — the same obligation-vs-probe mismatch, now inside a single file.

**Fix:** tighten `ruling-debt`'s linkage to the same TABLE surface `dpa-debt.ts` already treats as authoritative. Read `scripts/dpa-debt.ts` first and reuse its anchor rather than inventing a second one. If a legitimately-banked artifact is referenced only in prose today, that is a real finding to report — do not paper over it.

## F9 — LOW/MED. `ruling-debt` prints N but never M.

It reports how many ruling-shaped artifacts it found, never how many files it walked (~822). Its sibling `inbox-stranded` does report totals, and that is why F1's silent zero is unreadable there. Make `ruling-debt` report `N of M` too.

## Verification you owe before reporting DONE

- **Prove the bite of each fix, two-sided.** For every finding above: reproduce the OLD broken behaviour, apply the fix, show it now reports correctly, and show the healthy path still reports correctly. Paste real commands and real output. A fix you have not seen fail before and pass after is unproven.
- Run `bun scripts/ruling-debt.ts`, `bun scripts/inbox-stranded.ts` and `bun scripts/boot.ts` from BOTH your worktree and with the canonical paths pinned, and show they now agree.
- Confirm both probes still exit 0 in every state, including the error states from F1.
- Do not change what either probe DETECTS beyond what is written above. Do not add a gate. Do not make anything blocking.

## Report

The findings you closed with two-sided proof; anything you could NOT close and why; any place my brief's stated locus was WRONG (say so plainly — the brief's line numbers are my hypothesis, not verified fact, and a previous dispatch on this project correctly falsified the PA's stated root); and the proposed `dpa-scrml.md` amendment text.
