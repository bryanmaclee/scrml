# BRIEF — S385 `<each>` opener scope check, ROUND 5

> Archived VERBATIM at dispatch time per the archive-BRIEF-at-dispatch protocol.

ROUND 5 of the S385 `<each>` opener scope check. Round 4's FIX IS CORRECT and stays. This round is about making the arc's CLAIMS true and pinning what it fixed.

# CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE (F4)

1. FIRST: `pwd`. MUST start with `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-`. Else STOP, write nothing.
2. Confirm `git rev-parse --show-toplevel` equals it; tree clean.
3. **Your worktree was cut from `origin/main`, NOT the branch to continue:**
   ```
   git fetch origin fix/s385-each-in-scope-check-r4
   git reset --hard FETCH_HEAD          # = e41dc6a3, round 4's tip
   ```
   Verify `git log --oneline -1` before real work.
4. `bun install`.
5. `bun run pretest` **plainly from the worktree CWD**. NOT `bun --cwd <path> run pretest` — bun treats that as a bare `bun run`, prints the script list and **exits 0 having built nothing**. Verify artifacts exist; exit code is not evidence.
6. Worktree-absolute paths for every write. NEVER `cd` into `/home/bryan-maclee/scrmlMaster/scrml`.
7. **NEVER `git stash`** — `refs/stash` is shared across every worktree; base-vs-build flips by FILE COPY only.
8. **Never `pkill -f`/`killall`** on a command string — every checkout shares it. Kill by PID captured at launch.
9. First commit: `WIP(r5): start at $(pwd)`.

# STATE — round 4 is verified good, by me, by execution

I compiled all three directions against round 4's tip myself:
- `in=@rows.map(r => \`id-${r}\`)` → **0 errors** (the false positive is gone)
- `in=@undeclaredHidden.map(x => \`${1}\`)` → **fires** (the suppression hole is closed)
- `in=@totallyUndeclaredName` → **still fires** (the arc's purpose survives)

The excision was the right call. Do NOT redesign it.

# TASK 1 — the regression that motivated round 4 is NOT PINNED. Pin it.

The test file has 14 `expectNoErrors` cases and **none of them is the F1 shape** — a template literal inside a lambda in an opener. The fix works and nothing stops it regressing. That is the same shape as the bug it fixed, one level up: a suite that reads as coverage and is not.

Add pinning cases for at least: a lambda with an expression body and with a **block** body; a **template literal nested inside a lambda** (the F1 shape, both `in=` and `key=`); destructured lambda params (`([k, v]) => …`); a long method chain; and a nested `<each>` whose inner opener references the OUTER alias. Each asserts clean.

# TASK 2 — the arc's COVERAGE CLAIM over-states what landed. This is the load-bearing item.

**I reproduced this myself on round 4's tip.** `${ const items = [1,2,3] }` + `<each in=@items as r>` compiles **exit 0, zero diagnostics**, and emits `_scrml_cs_reactive_get("items")` → `undefined` → the empty-guard fires → **the list renders empty forever.** That is verbatim the failure mode the arc's own comment says it closes.

Cause: `checkLogicExprIdents`'s `@`-branch falls back to `scopeChain.lookup(atBase)` on the BARE name, so any `@x` whose bare name is bound as a plain `const`/local/value-import resolves and stays silent.

**DO NOT FIX IT IN THIS ARC.** It is a PRE-EXISTING walker limitation — `${@items}` is silent too — so gating the `@`-branch on `kind === "reactive" | "import"` is **newly-rejecting** across a much wider surface than `<each>`, and owes its own measured migration and its own ruling. Round 4 already taught us what happens when a newly-rejecting change ships on a clean corpus differential alone.

**What to do instead: make the claims TRUE.** Narrow the over-stated coverage claim wherever it appears — the 172-line comment block in `type-system.ts`, `progress.md`, and the test-file header. State plainly which shapes are covered and that `@name` over a non-reactive binding is NOT. Then add a `test.todo` naming it, sited where a future author would otherwise assume coverage, and draft the gap in `GAP-DRAFTS.md` for me to file.

An over-claiming comment is the same defect class as an over-claiming SPEC row, and this project has shipped that twice already.

# TASK 3 — two low findings worth pinning, both verified by the reviewer

- **`key=@<asName>` is a false negative.** `<each in=@rows as x key=@x>` is accepted by the typer (the `@`-branch bare-lookup again, and `key=` is checked after the `as` binding). The CLI still rejects it at codegen (`E-CODEGEN-INVALID-LOGIC`), but `compileScrml({write:false})` — the **LSP path** — silently accepts. Add a pinning test recording the current behaviour and the divergence.
- **`E-TYPE-004` silently extended to a new site.** Routing `key=` through `checkLogicExprIdents` means it now calls `checkRowFieldAccessInExpr`, so `<each in=rows as u key=u.email>` over `?{ select id, name from users }` hard-fails where `main` exits 0. The reviewer verified the behaviour is CORRECT (and `select *` / aliases stay clean) — but neither the comment block nor the 941-line test file mentions it. Document it and add a test, so a future imprecision in SQL row-type resolution does not surface as a mystery fatal on `key=`.

# NOT TASKS — explicitly

- **Do NOT split the branch.** A reviewer flagged commit `4d60e71b route(s389-peter → bryan)` as an unrelated commit needing separation. **I checked: `git merge-base --is-ancestor 4d60e71b origin/main` exits 0 — it is already IN main, not a stray.** The landing diff vs `origin/main` is exactly two files (`type-system.ts`, the test). The note was wrong; ignore it.
- **Do NOT chase the component-prop finding** (`<List items=@rows.filter(...)/>` newly firing `E-SCOPE-001`). Net-positive versus main's ReferenceError, zero corpus usage. Note it in `GAP-DRAFTS.md`; the real gap is in `component-expander.ts` prop substitution and belongs to whoever owns that.
- **Do NOT write `known-gaps.md`.** It is PA-owned and I have a PR open against it. I already filed two of your predecessor's drafts (`EACH-KEY-DESTRUCTURE`, `EACH-ITER-SHAPE-UNFIRED`). Leave `EACH-OPENER-INTERPOLATION` and `VALIDATE-EMIT-SKIPPED-WHEN-WRITE-FALSE` drafted in `GAP-DRAFTS.md` plus the two new ones from tasks 2 and 3; I file them all.
- **Do NOT touch `SPEC.md` / `PIPELINE.md`.**

# GATES

1. Pre-commit suite; never `--no-verify`. Round 4's full-suite fail-name set was byte-identical to `origin/main` (54/54) — keep it that way.
2. 1005-file corpus differential vs `origin/main`. **State explicitly in your report that a clean differential is necessary and NOT sufficient** — that lesson is the whole reason this arc reached round 5.
3. `browser-baseline --check`.
4. Bite proof both directions: `in=@totallyUndeclaredName` still fires; every new pinning fixture is clean.
5. Re-run my three F-shapes above and report the numbers.

# PROCESS

- Write this brief VERBATIM to `docs/changes/s385-each-in-scope-check-r5/BRIEF.md` early and commit it.
- Commit after each meaningful unit; append to `progress.md`. **Your predecessor stalled mid-`progress.md`-append and lost nothing because it had committed each unit first — keep that discipline.**
- Report `WORKTREE_PATH`, `FINAL_SHA`, `BRANCH`, files touched, every gate with real numbers, and every claim you narrowed.
- If narrowing a claim reveals the arc covers less than you are comfortable landing, say so plainly rather than widening the fix to rescue the claim.
