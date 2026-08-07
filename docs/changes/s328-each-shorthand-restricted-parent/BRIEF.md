## CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE (F4)

1. FIRST ACTION: `pwd`. It MUST start with `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-`. If it does NOT, STOP and report — do not write anything.
2. Confirm `git rev-parse --show-toplevel` equals that worktree root, and the tree is clean.
3. `bun install` (worktrees do NOT inherit `node_modules`; the pre-commit hook fails with "cannot find package 'acorn'" otherwise).
4. **Every Read/Write/Edit uses an ABSOLUTE path under the worktree root.** A relative path resolves against the MAIN checkout and leaks. Never `cd` into `/home/bryan-maclee/scrmlMaster/scrml`. Use `git -C "$WORKTREE_ROOT"` and `bun --cwd "$WORKTREE_ROOT"`.
5. Set `WORKTREE_ROOT` once and use it everywhere.

## ⚑ COMMIT IN THE BACKGROUND — this repo's post-commit hook will kill you otherwise

The local post-commit hook re-runs the ENTIRE test tree after pre-commit already ran the fast subset. **A foreground `git commit` goes silent for ~9 minutes and trips the 600s output-stream watchdog — this killed five agent runs last session.** So: run every commit with `run_in_background`, then poll `git -C "$WORKTREE_ROOT" log -1 --oneline` until it advances. Do NOT use `--no-verify` (forbidden without explicit authorization, and you do not have it).

## MAPS — REQUIRED FIRST READ

Read `.claude/maps/primary.map.md` (stamp `97576f35`) FIRST and follow its Task-Shape Routing to any additional maps for a codegen task. HEAD is `18fc0571`; the two commits past the stamp are docs-only, so the map is CURRENT. Treat map content as a verify-against-source HYPOTHESIS. Report whether the maps were load-bearing.

## FIRST COMMIT: archive this brief

Before any code change, write this ENTIRE prompt verbatim to `docs/changes/s328-each-shorthand-restricted-parent/BRIEF.md` in your worktree (single-quoted heredoc: `cat > … <<'BRIEFEOF'`) and commit it. Also create `docs/changes/s328-each-shorthand-restricted-parent/progress.md`, appended after every meaningful step.

---

# THE WORK — silent data loss in the S327/PR-#456 `<each>` `:`-shorthand mount path

PR #456 (`2031b2bf`) merged with **zero review**. A post-merge adversarial pass found four defects; you are fixing **ONE** — the data-loss regression. The others (expression-lowering asymmetry, a SPEC-contradicted rationale comment, a silent `catch`) are a SEPARATE follow-on that needs an operator ruling — **do not fix them here**, and do not make them worse.

**Every locus below is PA-LOCATED-VERIFY — a hypothesis from a review, not a traced path. Confirm or correct each and report whether it held, was refined, or was wrong.**

### The defect — CONFIRMED by PA reproduction

Hypothesised locus: the shorthand mount branch at `compiler/src/codegen/emit-each.ts:1147-1152`, and the guard that is missing from it — `_rcdataValueExpr` at approximately `:1110-1117`, which the review reports is gated on `!isShorthand` so the shorthand branch has **no restricted-parent guard at all**.

`interpMayYieldNode` is a **MAY**-analysis, and `fnBodyReturnsMarkup` puts a function into `_eachMarkupFnNames` if **any** of its returns is markup. So a MIXED-return function is treated as markup-yielding even on calls that return a plain string — and the mount path then wraps that string in a `<span data-scrml-mv>`.

**PA reproduction (re-run it, do not take it on trust):**
```scrml
type Row:struct = { id: string, name: string }
<rows>: Row[] = []
fn label(n: string) {
    if n == "" { return <i>none</i> }
    return n
}
<each in=@rows as it key=it.id>
    <textarea : label(it.name)>
</each>
```
emits:
```js
const _scrml_el_2 = document.createElement("textarea");
const _scrml_each_mv_3 = document.createElement("span");
_scrml_each_mv_3.setAttribute("data-scrml-mv", "");
_scrml_el_2.appendChild(_scrml_each_mv_3);      // ← mount span INSIDE the textarea
```

**Why this is data loss, not cosmetics.** HTML defines a `<textarea>`'s value as its child **text** content (Text nodes only). With an element child, `textarea.value` is `""` in a conformant browser — the adopter's text silently disappears. Any `innerHTML`/SSR serialize-and-reparse turns the span into literal escaped text.

**Why the author's tests passed:** happy-dom's `.value` getter falls back to `textContent`, masking it. **Your verification MUST NOT rely on happy-dom for this property.** Assert the DOM SHAPE directly — `childElementCount`, `firstChild.nodeType` — or assert on the emitted code, rather than on `.value`.

`<option>` has the same shape (text-only content model). The review reports `<option>` was already affected on the LONGHAND path since S297, so `<option>` is a pre-existing class newly extended to shorthand, while `<textarea>` is shorthand-exclusive and NEW. **Verify that split before deciding scope** — it decides whether your fix is a regression-repair or also a pre-existing-bug fix, and those get classified differently.

## THE FIX — direction, not prescription

The shorthand branch must reach parity with longhand: inside a restricted-content parent, take the RCDATA/`.value` path (or otherwise refuse to inject an element child) instead of mounting a span. **Verify how the longhand branch decides this and mirror the decision rather than inventing a second predicate** — this repo has an active bug family caused by near-duplicate predicates that disagree (three disagreeing async classifiers; two near-identical server-only-module predicates 2,638 lines apart). **One source of truth, consumed by both branches, is the fix; a second parallel check is the bug.**

Do NOT re-architect `interpMayYieldNode` into a MUST-analysis. That is a larger design question and is out of scope.

## MANDATORY GATES

1. **Governing-sentence gate (pa-base §1 Rule 4).** Read SPEC §17.7 (`<each>`) and §4.14 (`:`-shorthand) **IN FULL** via `offset:`/`limit:` before changing behaviour. QUOTE the governing sentence, or record explicitly which sections you searched and that none governs.
2. **Direction-of-change (pa-base §8).** Classify: inert / newly-rejecting / newly-accepting / semantics-changed. Restoring correct textarea content is likely semantics-changed toward the contract; say so with evidence.
3. **Measured migration.** GREP the corpus (`samples/`, `examples/`, `conformance/cases/`, `docs/website/`) for `:`-shorthand bodies inside restricted-content parents (`<textarea>`, `<option>`, `<title>`, `<style>`, `<script>`) and REPORT THE COUNT AND FILES before landing. Assumed-zero is not measured-zero.
4. **Conformance cases are a MERGE-BLOCKER.** Add cases pinning the fixed behaviour for BOTH `<textarea>` and `<option>` in shorthand, plus a shorthand-vs-longhand PARITY case. Run `bun conformance/run.ts`.
5. **The `0/7260 byte-identical` differential that #456 shipped on was a COVERAGE ARTIFACT** — the corpus contains no file combining `:`-shorthand with a same-file markup-returning fn, so the differential measured the wrong axis and was honestly clean. If you run a corpus differential, state explicitly what population it covers and what it CANNOT see.
6. **Empirical (R26), by execution.** Recompile real sources and inspect emitted output; execute where behaviour matters. `bun compiler/bin/scrml.js compile <src> --output-dir <tmp>`. Corpus: `samples/compilation-tests/`, `examples/`, `scrml-support/docs/gauntlets/gauntlet-r25/dev-*.scrml`. **Do not mark done without an empirical pass.**
7. Full local suite: `bun run test` (chains `pretest`; `bun test` alone gives ~130 false failures).

## SCOPE FENCE

Touch `compiler/src/codegen/emit-each.ts` and its tests/conformance cases. **Do NOT touch `compiler/src/codegen/emit-logic.ts`** — a sibling agent is working there right now. If the correct fix needs a file outside emit-each.ts + tests, STOP and report rather than widening.

## REPORT BACK

Worktree path · final commit SHA · files touched · quoted governing sentence (or recorded search) · direction-of-change · the corpus count with file list · the `<textarea>`-new vs `<option>`-pre-existing split, verified · whether each PA-asserted locus held/refined/was-wrong · empirical evidence (emitted output before/after; DOM-shape assertions NOT happy-dom `.value`) · suite + conformance results · anything you could NOT close. Commit after every meaningful unit; clean `git status` before reporting DONE.
