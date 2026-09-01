# BRIEF — S393 fix round on PR #805 (verbatim dispatch prompt)

- **Dispatched:** 2026-09-01, S393-bryan
- **Agent:** `scrml-js-codegen-engineer`, model `opus`, `isolation: "worktree"`
- **Target branch:** `fix/each-match-in-if-else-chain-collector-descent` @ `3e8a7a4a`
- **Why:** the S239 adversarial pass on #805 returned two confirmed defects. Defect 1 was
  PA-reproduced two-sided before dispatch; defect 2 is relayed and marked as such in the brief.

---

You are running a FIX ROUND on an open pull request in the scrml compiler. The PR's adversarial (S239) review found two confirmed defects; you are fixing those two and nothing else.

# CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE (do this FIRST, before anything else)

1. `pwd` and echo it. It MUST start with `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-`. If it does not, STOP and report — do not write anything.
2. `git rev-parse --show-toplevel` MUST equal that same worktree path.
3. `git status --porcelain` MUST be empty.

⚑ **YOUR WORKTREE WAS CUT FROM `origin/main`, NOT FROM THE PR BRANCH.** The PR's work is NOT in your tree yet. Step one of actual work is:

```
git fetch origin fix/each-match-in-if-else-chain-collector-descent
git reset --hard FETCH_HEAD
git log --oneline -3          # expect the top commit to be a wrap(s392-peter) commit
git rev-parse HEAD            # expect 3e8a7a4a33d534553bbdb646eec8a5914834acaf
```

If that SHA does not match, STOP and report — someone pushed to the branch and this brief's premises need re-deriving.

4. `bun install` (a fresh worktree does NOT inherit `node_modules`; without it the test hook fails with "cannot find package 'acorn'").
5. Do NOT run `bun run pretest` via `bun --cwd <path> run pretest` — that form SILENTLY NO-OPS and exits 0. Run `pretest` plainly from the worktree CWD if you need browser fixtures. You almost certainly do not for this task.

**Path discipline, every edit, no exceptions:**
- Use Edit/Write on **worktree-absolute paths only**. Never a relative path, never a path under `/home/bryan-maclee/scrmlMaster/scrml/` that is not under your worktree.
- **NEVER `cd` into the main checkout.** Use `git -C "$WORKTREE_ROOT"` and worktree-absolute paths.
- ⚑ **NEVER use `git stash`.** `refs/stash` lives in the shared common `.git` directory, so a stash here lands on the SAME stack as the main checkout's and other live agents'. Whoever pops next takes whichever entry is on top regardless of which tree made it. This has already caused a cross-worktree work-mixing incident on this project. Do base-vs-build flips by FILE COPY into a scratch directory instead.
- ⚑ **NEVER run a bare `pkill -f` / `killall` on a command string.** Every checkout on this machine shares the same command strings, so `pkill -f "bun test ..."` will kill a suite running in another worktree or in main, silently. Kill by a PID you captured at launch, or not at all.
- Commit after each meaningful unit (WIP commits are expected and fine) and keep an append-only `progress.md` at the worktree root with timestamped lines: what you just did, what is next, blockers. The branch plus `progress.md` are your only crash-recovery anchor.
- Never use `--no-verify`. Never modify `core.hooksPath` or disable any hook. If the pre-commit gate blocks you, report it — do not route around it.

# MAPS — REQUIRED FIRST READ

Read `.claude/maps/primary.map.md` first and follow its "Task-Shape Routing" section to any additional map it names for a codegen task.

⚑ **The maps are STALE and you must treat every map claim as a hypothesis to verify against source.** They are stamped at commit `2ec2ce3a`; `origin/main` is at `adc61f15`. Landings since the map stamp that touch your area: `#800` (a test-guard inversion), `#801` (`scripts/worktree-sweep.ts`), `#802` (SPEC §17.6 value-form amendment plus `emit-control-flow.ts`, `emit-each.ts`, `emit-html.ts`), `#803`/`#804`/`#806` (docs). **#802 in particular touched two of the three files you are about to edit.** Report whether the maps were load-bearing for you, including "not load-bearing" — that feedback is tracked.

# CONTEXT

PR #805 fixes a real HIGH: an `<each>` or `<match>` inside an `if=` branch that has an `else` sibling emitted ZERO renderers plus two FALSE `E-DG-002`. The fix descends `branches[].element` + `elseBranch` in six walks. That core fix is sound — 18,077 unit + 3,479 integration pass, and a 1,005-file corpus differential showed the only semantic deltas were removals of *false* `E-DG-002`.

Do not revert or redesign it. Two defects were found alongside it.

# DEFECT 1 (BLOCKING) — value-form `if` in an RCDATA body now injects an element child, zeroing `textarea.value`

**PA-REPRODUCED BY EXECUTION, two-sided.** Reproducer:

```scrml
${
  type Row:struct = { id: int, name: string }
  <rows>: Row[] = []
  fn badge(t: string) { return <span class="b">${t}</span> }
}
<ul>
  <each in=@rows as it key=it.id>
    <li><textarea>${ if (it.name) { badge(it.name) } else { badge("x") } }</textarea></li>
  </each>
</ul>
```

Compile with `bun compiler/bin/scrml.js compile <src> --output-dir <tmp>` and read the emitted `.client.js`:

- **On `origin/main` (no #805):** `_scrml_each_tn_6.textContent = String((it.name ? _scrml_badge_1(it.name) : _scrml_badge_1("x")))`
- **On this branch:** `document.createElement("span")` + `setAttribute("data-scrml-mv","")` + `appendChild` — an ELEMENT child inside the `<textarea>`.

**Why that is data loss:** a `<textarea>` (and RCDATA generally) with an element child reads `value === ""`. This project already measured that in real Chromium — see the header of `compiler/tests/browser/g-each-shorthand-rcdata-parent.browser.test.js`.

**Root, PA-located — VERIFY IT, do not trust it.** `eachRcdataValueExpr` (`compiler/src/codegen/emit-each.ts`, around :824-829) only accepts a logic child whose `body[0].kind === "bare-expr"`. An `if-stmt` therefore yields a null `_rcdataValueExpr`, so the interp falls through to the generic child recursion — and this PR's newly-set `interpExprNode` makes `markupCapable` true there (around :1475), emitting the mount. Report whether that hypothesis held, was refined, or was wrong.

**The guard already exists and is not threaded here.** `_isRcdataBody` is computed at `emit-each.ts:1139` and IS consulted on the `:`-shorthand path at `:1214` (`if (shMarkupCapable && !_isRcdataBody)`) and `:1220`. The longhand logic-child branch has no equivalent. Mirror the existing guard rather than inventing a second mechanism.

**Scope note:** `<option>` also flips to the mount path here, but that matches the ternary's existing main behaviour and is deliberate per s328 — it is NOT part of this fix. Do not change it.

# DEFECT 2 — the if-chain descent went into six walks but not the each lints

**Reviewer-reported; PA has NOT independently reproduced this one. Verify it before fixing.** Claimed reproducer: `<ul><each in=@todos><li>${@.name}</li></each></ul>` with no `key=`, placed under an `if=`/`else` chain.

| shape | main | this branch |
|---|---|---|
| plain | `E-DG-002`, `W-EACH-KEY-001` | same |
| lone `if=` | `W-EACH-KEY-001` | same |
| `if=`/`else` | 2x false `E-DG-002`, no key lint | **no diagnostic at all** |

Before this PR the missing lint was inert, because the `<each>` emitted zero renderers. Now it compiles to a real `_scrml_reconcile_list` with index-identity reconcile — wrong DOM reuse on reorder and delete — and the adopter gets nothing.

Fix the each key lint (`compiler/src/lint-w-each-key.js`, reported at :56 and :156) by **reusing the same descent this PR already added**, not by writing a seventh ad-hoc copy. If a shared helper is the natural shape, extract one and have the PR's existing six sites and this one call it — but only if that refactor is emit-inert.

⚑ **The reviewer named four MORE sites with the same blind spot:** `lint-w-each-promotable.js:64`, `lint-w-map-iteration-order.js:48` and `:78`, `commands/promote.js:828` and `:1572`. **Do NOT fix those in this round.** Verify whether each genuinely has the blind spot and **report the list with your findings** — they will be filed as their own arc. Scope discipline matters more here than completeness.

# WHAT YOU OWE

1. Both defects fixed, each with a regression test that is **BITE-PROVEN**: show it RED before your fix and GREEN after. A test you cannot make fail is not a test.
2. **Before narrowing or gating any check, count what it stops looking at.** Defect 1's fix makes a code path stop emitting a mount in some cases — state the population it now skips and confirm every member of it is genuinely RCDATA.
3. **Empirical verification, not just "tests pass."** Re-compile real corpus sources on your post-fix tree and confirm (a) the `<textarea>` reproducer above now emits the `.value`/text path, and (b) nothing else changed. A corpus differential over `samples/`, `examples/` and `conformance/cases/` is the right instrument if you can run it in bounded time; if not, say what you ran instead.
4. Run the touched unit and integration files, plus `bun conformance/run.ts`. Do NOT run the full `bun run test` suite — it is slow and other agents are active on this machine.
5. Commit onto the PR branch's history in your worktree. Report the final SHA, the exact files touched, and anything you deferred.

# REPORTING RULES

- Mark every claim **VERIFIED-BY-EXECUTION** (paste the command and the real output) or **INSPECTION-ONLY**. Never blur them.
- If a premise in this brief turns out to be wrong, say so plainly and stop rather than working around it. Two of the loci above are PA-asserted hypotheses, and this project has a recorded history of briefs naming the wrong file.
- Report what you did NOT check.
