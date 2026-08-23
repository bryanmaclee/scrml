# BRIEF — instrument-integrity-2026-08-22

> Archived verbatim at dispatch time.

Fix and audit the scrml project's **verification instruments**. Change-id: `instrument-integrity-2026-08-22`.

## 0. WHY THIS EXISTS

§62.2 makes the conformance corpus **the versioned contract**. The instruments that enforce that contract are less verified than the language they measure. **Seven instrument defects surfaced in one week**, each one a gate that passed while measuring the wrong thing or nothing:

- `conformance/run.ts` is set-based and **cannot express cardinality** — a diagnostic firing TWICE is invisible. A real double-fire regression survived `894/894`.
- `s34-census.ts` **treats a source COMMENT as an emitter** — writing an error-code token in two comments moved an honest spec-ahead row into IMPL-SITES (measured: 323/14 with the comments, 321/16 without).
- `s34-census.ts` **never verifies a named emitter symbol exists** — a row naming a deleted function passes, because the check is a regex for a backticked path. A stale symbol survived a whole round that way.
- `browser-baseline.ts` hit a `spawnSync maxBuffer` ceiling; ENOBUFS killed bun before its `N pass` line, so **a green tier read as a hard failure** and blocked every merge (since fixed).
- the todomvc harness fell back to the runtime SOURCE when the referenced runtime was missing from dist, so a **DOA build with a dangling `<script src>` stayed green** (fix built, awaiting a stamp).
- a build-matrix probe filtered `f.endsWith(".worker.js")`, which matches nothing under content-hashing — **one guarantee passed vacuously on 20 of 40 builds**.
- conformance `expected.json` **grep-hits were repeatedly counted as assertions** when the code appeared only in a `description`.

The through-line: **a check that cannot fail is worse than no check**, because it is read as evidence.

## 1. SETUP

```
git fetch origin
git checkout -B instrument-integrity origin/main    # main is a0e30329 and MOVES — re-fetch before you finish
```

A sibling operator lands on `main` continuously. **Rebase or merge; never file-delta.** Generated docs regenerate after the last content commit.

**Discipline:** commit and push after EVERY item; never `--no-verify` or override `core.hooksPath`; write only inside your worktree; do not touch `handOffs/*`, `master-list.md`, `hand-off.md`, `docs/known-gaps.md`. Create `docs/changes/instrument-integrity-2026-08-22/{BRIEF.md,progress.md}` (archive this brief verbatim). A `(fail) <name>` here may be a **timeout**, not an assertion — re-run in isolation.

## 2. BUILD — the two known defects

**(A) `conformance/run.ts` — cardinality.** Add an optional `codeCounts: { "E-X": 1 }` assertion to `expected.json`, checked exactly. Back-compatible: a case without the key behaves as today. Then **pin the invariant that motivated it** — add `codeCounts` to `conformance/cases/capability/inheritance-inherit-covers` and `inheritance-closest-wins-no-union` asserting `E-NESTED-PROGRAM-CONTEXT-NOMINAL: 1`, which is the assertion that would have caught the double-fire.

This widens the versioned contract's schema — document it where the corpus format is specified, and say plainly in `progress.md` that it is additive and why.

**(B) `s34-census.ts` — two blind spots.**
1. **Comment-as-emitter.** The emitter scan counts a code token appearing anywhere in a source file, including comments. Make it match a **push position** (the code appearing as an argument/property in a diagnostic construction) rather than a bare token. If a precise push-position match is not tractable, at minimum exclude `//` and `/* */` comment spans, and say which you did.
2. **Symbol existence.** A §34 row's emitter provenance names a symbol (e.g. `` `detectProtectedRawEgress` ``). Verify the named symbol **exists in the tree**; fail the `--check-new` gate if it does not. This is how a rename silently staled a provenance note. Be careful with the diff-scoping: `--check-new` is deliberately silent on the legacy corpus, and it must stay that way (a gate instantly red for reasons no change caused gets bypassed then deleted — the repo's own CI comment says so). New/changed rows only.

**Both need a two-sided bite proof**: construct the defect, show the gate RED; remove it, show GREEN. State both halves in `progress.md`.

## 3. AUDIT — every other gate, for vacuity

For each script below, answer one question and record it in a table in `progress.md`: **can this pass while measuring nothing?** Concretely — if its input were empty, missing, unparseable, or zero-length, would it report success?

`browser-baseline.ts` · `facts.ts` · `regen-spec-index.ts` · `snippet-gate.js` · `review-debt.ts` · `corpus-zero-debt.ts` · `issue-debt.ts` · `threads.ts` · `dpa-debt.ts` · `delta-lint.ts` · `state.ts` · `corpus-emit-differential.ts` · `perf-regression-check.ts` · `benchmark-perf-baseline.ts` · `source-text-regex-census.ts` · `dock-health.ts`

For each: **PROVE the answer by execution** — feed it an empty/missing input and record what it does. Do not reason from reading.

- Where a gate is vacuous and the fix is small and obvious, **fix it** with a bite proof.
- Where the fix is not small, **file it in `progress.md`** with the reproducer for the PA to route. Do not balloon this dispatch.
- `browser-baseline.ts` already refuses an empty set (`"Refusing to record or compare an empty set (that is the hollow-gate shape)"`) — treat that as the **reference pattern** and report which others do or do not have an equivalent.

## 4. VERIFICATION BAR

- Two-sided bite proof for every behavioural change.
- **Execute, don't grep.** For a gate, that means running it against a deliberately broken input and showing the exit code.
- Do not regress any currently-passing gate. Run the full gate set before and after and diff the results.
- Run `bun conformance/run.ts` and `bun scripts/s34-census.ts --check-new --base origin/main` after your last change.
- Fresh worktrees lack gitignored build artifacts — rule that ENV-GAP out before calling a failure a regression.

## 5. DELIVERABLE

Push and report: branch + final SHA; the two builds with their bite proofs; **the full vacuity table for all 16 scripts with executed evidence**; what you fixed vs filed; and whether the `codeCounts` addition is genuinely back-compatible (prove it — the existing corpus must be unchanged in outcome).
