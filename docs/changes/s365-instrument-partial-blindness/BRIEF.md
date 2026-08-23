Build round: **two operator rulings on measuring instruments.** Both close holes that a review found and the PA reproduced. One of them is a blocking CI gate that is currently partially blind on the real file.

## WORKSPACE — cut a FRESH branch off `origin/main` in an isolated worktree.
Use `isolation: "worktree"` semantics: you are provisioned a fresh worktree. **First action — STARTUP GATE; STOP and report if any fails:**
1. `pwd` MUST start with `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/`
2. `git rev-parse --show-toplevel` equals that path
3. `git status --short` clean
4. `git fetch origin && git checkout -b fix/s365-instrument-partial-blindness origin/main` — then confirm `git merge-base HEAD origin/main` == `origin/main`
5. `bun install` (a fresh worktree does NOT inherit `node_modules`; the pre-commit hook fails with "cannot find package 'acorn'" otherwise)

**PATH DISCIPLINE.** Absolute paths under YOUR worktree root only. **NEVER `cd` into `/home/bryan-maclee/scrmlMaster/scrml`** (live; three other agents are working). **Never `git stash`.** Never touch a sibling worktree.

---

## RULING 1 (Q7) — `delta-lint` is PARTIALLY blind, and `--fix` corrupts under that blindness

Both are filed HIGH: `g-delta-lint-partially-blind-on-emoji-kind-entries` and `g-delta-lint-fix-corrupts-log-under-partial-blindness` in `docs/known-gaps.md`. **Read both entries first** — they carry the full measurement.

**(1a) The partial blindness. PA-REPRODUCED against the live file, today:**
```
bracketed lines in live scope : 1402
ENTRY-matched                 : 1398
BRACKETED BUT UNPARSED        :    4     [561] [562] [565] [727]
```
The regex `/^\[(\d+)\]\s+(\S+)\s+·\s+(.*)$/` expects three tokens; the convention drifted to `[NNNN] <emoji> <kind> · body`, which is four. The gate prints `1398 entries … — PASS`, **exit 0**. It does not know those lines are entries. **`scripts/state.ts` carries the BYTE-IDENTICAL regex**, so the same four are invisible to the digest projection too — the silent-drop class the gate exists to catch, happening live while the gate reports clean.

**RULED: fix it.** The existing zero-population guard already computes `bracketed` and only consults it inside the `total === 0` branch. **Compare `bracketed` vs `total` unconditionally.** Fix BOTH files — `state.ts`'s copy is the same defect and leaving it is how the pair drifts apart.

⚑ **Decide deliberately and say which you chose:** widen the regex to accept the emoji form, or keep the regex strict and make the mismatch a hard refusal that names the offending lines. **The PA leans refusal-plus-widen: accept the real convention AND report any residual mismatch**, so the gate can never again conclude "nothing to check" from a shape it does not know. A silent widen alone would fix these four and hide the next drift.

**(1b) `--fix` corruption.** `maxSeq` is computed from VISIBLE entries only, so under partial blindness it renumbers a duplicate onto a number that already exists in the invisible region — manufacturing a real collision — and then reports PASS. **RULED: gate `--fix` on a clean parse. Refuse to renumber anything while `bracketed !== total`.**

⚑ **`--fix` has a SECOND known corruption mode, already recorded and NOT yours to fix here:** on a merge result it renumbers the wrong side (it keeps first-in-file order, blind to which side is already published). **Do not attempt to solve that** — but make sure your clean-parse gate does not read as having solved it. If a one-line warning in `--fix`'s output pointing at the merge hazard is cheap, add it.

**RULED SEPARATELY — do NOT run `--fix` on the real log, and do not renumber the 9 baselined historical duplicates.** They stay baselined. The tool gets fixed first. Touching `handOffs/delta-log.md` content is out of scope entirely.

## RULING 2 (Q6) — the `expect`-vocabulary container policy, decided once for the whole vocabulary

`conformance/run.ts`. A malformed *container* silently disables an assertion. Measured by a reviewer, 883-case runs each: `severity: {}` / `null` / `[]` → all PASS; `notCodePrefixes: []` / `null` / `""` → all PASS; **`notCodePrefixes: {}` → uncaught `TypeError: {} is not iterable` at `run.ts:230`, which takes down the ENTIRE 883-case run** instead of failing one case.

**RULED, for every key in the `expect` vocabulary — not per-key:**
- **An empty ARRAY `[]` is a NO-OP**, semantically identical to omitting the key. `notCodePrefixes: []` legitimately reads as "no families forbidden." Do not error on it.
- **A non-array / non-conforming container is a HARD ERROR** — `{}`, `null`, `""`, a number, a boolean. It is malformed under any reading.
- **`severity: {}` gets no special reading** — there is no interpretation of an empty severity map as an assertion. Hard error.
- **`notCodePrefixes: {}` must fail ONE CASE with a diagnostic, never abort the run.** A harness that dies on a malformed case file is a robustness bug independent of the policy.

Apply it uniformly across the vocabulary (`codes`, `notCodes`, `notCodePrefixes`, `severity`, `codeCounts`, and any sibling with the same shape). `codeCounts` already got this treatment — **reuse its idiom, do not mint a second pattern.**

---

## VERIFICATION — bite proofs are the deliverable
- **A bite-proof table for every gate/check you touch: corrupted input → RED, restored → GREEN, with commands and exit codes.** **Measure exit codes DIRECTLY (`cmd; echo $?`), never through a pipe** — `cmd | tail` reports tail's status. That trap has bitten this project twice this session, once while testing a gate for hollowness.
- For `delta-lint`, prove ALL of: pristine → 0 · real duplicate canonical → 1 · **partial drift with a duplicate inside the drifted region → RED** (this is the new case) · full separator drift → 2 · empty file → 2 · comments-only → 2 · the four live `[561]/[562]/[565]/[727]` lines now COUNTED (report the new `bracketed`/`total` figures — they should be equal at 1402).
- For `state.ts`, prove the digest projection now sees those four.
- For `conformance/run.ts`, drive real `runCase` calls for each container shape × each key; confirm the omitted-key control still passes and a legitimate assertion still fails on a wrong value.
- **Regression:** `bun --cwd="$WORKTREE" conformance/run.ts` must stay **883/883**, and `bun --cwd="$WORKTREE" run test` must show zero NEW failures vs `origin/main`. Separate timeouts from assertions **by duration** (~4 dev-watcher tests legitimately run ~10.3 s; the harness prints the same `(fail) <name>` for both).
- Run all six blocking CI gates at your final SHA and report each exit code.

## COMMIT DISCIPLINE
First commit: this brief verbatim to `docs/changes/s365-instrument-partial-blindness/BRIEF.md` (single-quoted heredoc) + `progress.md`. Crash anchor. Commit per unit; WIP expected. NEVER `--no-verify`; never alter a hook. Clean `git status` before DONE.

## REPORT
Final message = deliverable: which regex strategy you chose and why; the bite-proof table; the new bracketed/total figures; the container-policy table (key × container shape × before/after); gate exit codes; files touched; final SHA; anything deferred.
