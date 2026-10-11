You are a dispatched dev agent on the scrml compiler (impl#1, TS, compiler/src). PA session S462. Gap: g-impl1-markup-if-branch-memo-stale-render-s462 (HIGH), from docs/known-gaps.md on branch land/s462-given-presence-deprecate (PR #1392). Run `git fetch origin` and read that entry with `git show origin/land/s462-given-presence-deprecate:docs/known-gaps.md`. Your worktree is cut from origin/main, which does not have it yet.

FIRST: run `git fetch origin && git merge origin/main`. Archive this prompt verbatim to docs/changes/s462-markup-if-stale-render/BRIEF.md, then commit it together with a progress.md. Commit incrementally from then on; your branch and progress.md are your crash anchor. Code and its test go in ONE commit. Never use --no-verify and never disable hooks. Before each commit, wait until free memory is above 6GB and the load average is below 15. The pre-commit hook runs the full suite (around 2 minutes): use timeout 300000 and commit in the foreground.

BUG: any markup `${ if … }` lift whose branch does not flip does not re-render the reactive reads inside the branch body.
- Locus: compiler/src/codegen/emit-reactive-wiring.ts `emitLiftGroup` (~:672). "Guard 1 (branch)": `isSingleIf` → `genVar("lift_branch")` (~:710), then `if (_branch === <branchVar>) return;` (~:744). The guard exists to keep event listeners and input state (focus, typed text) when the branch is unchanged, but its early return also skips updating the body's reactive reads.
- Repro A (presence): `<x> = "a"` … `${ if (@x is given) { lift <p>${@x}</p> } }`. Setting @x = "b" leaves the <p> showing "a".
- Repro B: `<on> = true <n> = 0` … `${ if (@on) { lift <p>${@n}</p> } }` plus a button doing @n = @n + 1. The <p> stays at 0.

REQUIRED BEHAVIOUR: when the branch is unchanged, the body's reactive reads (text interpolations, attribute bindings) SHALL update, and listeners and input state SHALL survive. A full re-render is acceptable only if it provably keeps listeners and input state; a targeted update is preferred.
- Before you choose, find out how a non-lift markup interpolation updates in place; the fine-grained wiring probably already exists for non-if markup.
- Read the SPEC section on markup if/lift reactivity (search SPEC-INDEX.md for lift / §17 / reactive) in full before changing anything, and quote the governing sentence in your commit.
- Cover else-if and else chains, nested ifs, a `for` inside an if, and an input inside the branch keeping its typed value and focus while a sibling read updates.

TESTS: execute the compiled output in happy-dom (as the existing browser tests do) for both repros and the cases above. Add a conformance case. Also check bootstrap (compiler/self-host-v2): if impl#2 has the same guard, fix it or record an exact known-gaps entry.

GATES: run them all before reporting, including the CI-only ones:
- pre-commit (full suite)
- tracking tiers: `bun test compiler/tests/integration compiler/tests/lsp compiler/tests/commands`, after `bun run pretest`
- browser-baseline --check, as ci.yml runs it
- `bun scripts/s34-census.ts --check-new --base <merge-base>`
- host-global-scan --check
- facts, spec-index, bootstrap-conformance and severity --check (regenerate if needed)
- snippet-gate and corpus-compile-floor

Also run an emit-differential over the corpus (samples/, examples/, conformance) against base, and execute any sample whose output changed.

Resolve generated-doc merge conflicts by hunk, then regenerate. Never take one side's whole known-gaps.md, and restore master-list.md from origin/main. Write only inside your worktree; never use absolute paths into the main checkout.

REPORT: WORKTREE_PATH, FINAL_SHA, BRANCH, the approach you chose and why, the SPEC sentence quoted, gate results, and any corpus behaviour change.
