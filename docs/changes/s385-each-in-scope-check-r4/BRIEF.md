ROUND 4 of the S385 `<each>` opener scope check. You are continuing another agent's branch. Round 3 is confirmed DO-NOT-LAND.

# CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE (F4)

1. FIRST ACTION: `pwd`. It MUST start with `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-`. If not, STOP and report — write nothing.
2. Confirm `git rev-parse --show-toplevel` equals that root and the tree is clean.
3. **Your worktree was cut from `origin/main`, NOT from the branch you must continue.** First real step:
   ```
   git fetch origin fix/s385-each-in-scope-check
   git reset --hard FETCH_HEAD          # = 33076d91, round 3's tip
   ```
   Verify `git log --oneline -1` before proceeding.
4. `bun install` (worktrees do not inherit `node_modules`).
5. Run `bun run pretest` **plainly from the worktree CWD**. Do NOT write `bun --cwd <path> run pretest` — bun silently treats that as a bare `bun run`, prints the script list and **exits 0 having built nothing**. Verify the artifacts exist; exit code is not evidence.
6. Absolute worktree paths for every Read/Write/Edit. NEVER `cd` into `/home/bryan-maclee/scrmlMaster/scrml`. Use `git -C "$WORKTREE_ROOT"`.
7. **NEVER `git stash`.** `refs/stash` lives in the SHARED common `.git` dir, so your stash and every sibling worktree's land on the same stack and whoever pops next takes the top entry regardless of which tree made it. Round 3 used stash (balanced, no damage — I checked) but there is still a recovery note at `stash@{1}` from when this race cost us work at S385. Do base-vs-build flips by **FILE COPY**.
8. **Never `pkill -f` / `killall` on a command string** — every checkout shares it and you would silently kill a suite or commit hook in another tree, leaving no trace on your side. Kill by PID captured at launch.
9. First commit message: `WIP(r4): start at $(pwd)`.

# MAPS — REQUIRED FIRST READ

Read `.claude/maps/primary.map.md` and follow its Task-Shape Routing. **Currency, measured:** maps are stamped at `0dd659a1`; `origin/main` is `d02adb68`, 35 commits ahead. Treat map content as a verify-against-source hypothesis. Report whether the maps were load-bearing — "not load-bearing" is a valid answer.

# WHAT THE ARC IS

`<each in=@undeclaredName>` was a silent false NEGATIVE: an undeclared iterable compiled clean and lowered to a live `_scrml_reactive_get` returning undefined, so the list rendered empty forever at exit 0. Round 3 added a scope check over the opener expression in `compiler/src/type-system.ts` (+150), reusing the shared walker, with an `in=`/`of=` before-push vs `key=` after-push ordering split and an `iterShape` gate. **That core design is correct and stays.**

# THE THREE FINDINGS — I REPRODUCED ALL THREE MYSELF BY EXECUTION

## F1 — HIGH. A false-positive regression on code that compiles today. This is why round 3 does not land.

```scrml
<program>
    ${ <rows> = [1, 2, 3] }
    <ul>
        <each in=@rows.map(r => `id-${r}`) as x>
            <li>${x}</li>
        </each>
    </ul>
</program>
```

- `origin/main`: compiles clean, exit 0.
- round 3: **`error [E-SCOPE-001]: Undeclared identifier \`r\``**.

`forEachIdentInExprNode` deliberately does not descend into a `lambda` body — that guard is what keeps `in=@rows.filter(n => n > 1)` clean, and §3 of round 3's own test pins it. The raw-text `readSites` scan at `type-system.ts:12806` has no such guard: it reaches into the lambda body and feeds the interpolation contents to the walker as outer-scope reads. **PA-located, verify it yourself** — re-derive the line rather than trusting it.

## F2 — MEDIUM. Same line, opposite direction: it reopens the hole this arc exists to close.

```scrml
<each in=@undeclaredHidden.map(x => `${1}`) as r>
```
Zero `E-STATE-UNDECLARED` on round 3. `targets = readSites.length > 0 ? readSites : [trimmed]` **replaces** rather than **adds**, so any `${…}` anywhere in the opener suppresses the check on the iterable itself.

## F3 — the reviewer was WRONG and round 3 was RIGHT. Recorded so you do not re-litigate it.

A reviewer claimed `key=${@a}-${r}` "compiles with zero `E-` diagnostics" and emits unparseable JS. I ran it: it fails **loud** with `error [E-CODEGEN-INVALID-LOGIC]` and writes no output — matching round 3's own report. I discarded the reviewer's framing.

**The load-bearing half stands and it decides the fix:** `${…}` is not a working opener form, so the `readSites` block buys NO coverage while causing F1 and F2.

# THE FIX

Delete the `readSites` / `targets` block; always check `trimmed` as a single expression through the existing `parseExprToNode` + walker path, which already handles the lambda guard correctly. That closes F1 and F2 together. Re-work §9 of the test accordingly — it currently pins a diagnostic for a construct that cannot work either way. If a diagnostic for `${…}` in an opener is wanted, the honest one is "not a valid opener form" and that is a SEPARATE arc, not this one.

**Everything else in the diff lands as-is.** This is a scoped excision, not a redesign.

# ⚑ THE PART THAT MATTERS MOST — the safety claim has to change

This arc is the first exercise of a new PA ruling mandate whose third condition is *"corpus impact MEASURED ZERO, derived by COMPILING the corpus."* Round 3 satisfied it — **0 of 1005, positive-controlled** — and it was **NOT SUFFICIENT**, because no corpus file happens to put a template literal inside an `<each in=>` lambda. That is `pa-base` §8's coverage-removal blind spot: the inputs that would trip a newly-rejecting change are precisely the ones nobody has written yet. Our corpus is also 100% LLM-authored, so it carries almost no ergonomic diversity.

**Round 4 owes an ADVERSARIAL SHAPE SET, not just a corpus re-run.** Enumerate the shapes a scope check over an opener expression could plausibly false-fire on and build a fixture for each. At minimum:

- arrow lambda with expression body, and with a block body
- a template literal nested inside a lambda (F1)
- destructured lambda params (`([k, v]) => …`)
- the `as`-alias name referenced in `key=`
- `@.` and `@.field` forms
- long method chains (`.filter(...).map(...).slice(...)`)
- a nested `<each>` whose inner opener references the OUTER alias
- `of=` count form with an expression

Each gets an `expectNoErrors` case (round 3's helper is the right instrument — its case list was just too narrow). **State in your report that a clean corpus differential is necessary and not sufficient.** Do not let 0-of-1005 stand alone as the safety claim.

# GATES

1. Pre-commit suite. Round 3: 30730 pass / 55 fail against a base of 30703 / 57. Never `--no-verify`.
2. 1005-file corpus differential vs `origin/main` — round 3 was 0 newly-failing / 0 newly-passing / 0 code-set changes. Re-run it.
3. `browser-baseline --check` — round 3 PASS.
4. **Bite proof in BOTH directions:** the original `<each in=@undeclaredName>` bug must still fire, AND every adversarial fixture must be clean. A gate that has never failed is indistinguishable from one that cannot fail.
5. F1 and F2 fixtures must flip: F1 clean after, F2 firing after.

# PROCESS

- Write this brief VERBATIM to `docs/changes/s385-each-in-scope-check-r4/BRIEF.md` early and commit it.
- Commit after each meaningful unit; append to `progress.md`. Rebase onto current `origin/main` before final gates.
- Report `WORKTREE_PATH`, `FINAL_SHA`, `BRANCH`, files touched, every gate with real numbers, and whether the PA-located line held.
- Round 3's two `GAP-DRAFTS.md` entries and the `test.todo` conversion (a passing test that was passing for a bad reason) are good work — keep them. I file the gaps PA-side.
- If the excision turns out to break something round 3 relied on, STOP and report rather than reintroducing a text scan.
