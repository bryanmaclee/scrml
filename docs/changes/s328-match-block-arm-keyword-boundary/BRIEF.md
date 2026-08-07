## CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE (F4)

1. FIRST ACTION: `pwd`. It MUST start with `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-`. If it does NOT, STOP and report — do not write anything.
2. Confirm `git rev-parse --show-toplevel` equals that worktree root, and the tree is clean.
3. `bun install` (worktrees do NOT inherit `node_modules`; the pre-commit hook fails with "cannot find package 'acorn'" otherwise).
4. **Every Read/Write/Edit uses an ABSOLUTE path under the worktree root.** A relative path resolves against the MAIN checkout and leaks. Never `cd` into `/home/bryan-maclee/scrmlMaster/scrml`. Use `git -C "$WORKTREE_ROOT"` and `bun --cwd "$WORKTREE_ROOT"`.
5. Set `WORKTREE_ROOT` once and use it everywhere.

## ⚑ COMMIT IN THE BACKGROUND — this repo's post-commit hook will kill you otherwise

The local post-commit hook re-runs the ENTIRE test tree after pre-commit already ran the fast subset. **A foreground `git commit` goes silent for ~9 minutes and trips the 600s output-stream watchdog — this killed five agent runs last session.** So: run every commit with `run_in_background`, then poll `git -C "$WORKTREE_ROOT" log -1 --oneline` until it advances. Do NOT use `--no-verify` (forbidden without explicit authorization, and you do not have it).

## MAPS — REQUIRED FIRST READ

Read `.claude/maps/primary.map.md` (stamp `97576f35`) FIRST and follow its Task-Shape Routing to any additional maps for a codegen task. HEAD is `18fc0571`; the two commits past the stamp are docs-only, so the map is CURRENT. Treat map content as a verify-against-source HYPOTHESIS. Report whether the maps were load-bearing — "not load-bearing" is a valid and useful answer.

## FIRST COMMIT: archive this brief

Before any code change, write this ENTIRE prompt verbatim to `docs/changes/s328-match-block-arm-keyword-boundary/BRIEF.md` in your worktree (single-quoted heredoc: `cat > … <<'BRIEFEOF'`) and commit it, so the landing carries its own instructions. Also create `docs/changes/s328-match-block-arm-keyword-boundary/progress.md` and append a timestamped line after every meaningful step.

---

# THE WORK — two defects in the S326/PR-#447 match block-arm lowering

PR #447 (`33eda05f`, "match block-arm in value position lifts its tail expr to the result") merged with **zero review**. A post-merge adversarial pass found four defects; you are fixing **two**. The other two (F1 four-unfixed-paths, F4 server-context) are a SEPARATE follow-on arc — **do not fix them here**, but do not break them either.

**Every locus below is PA-LOCATED-VERIFY — a hypothesis produced by reading a review, not a traced execution path. Confirm or correct each one and REPORT whether the hypothesis held, was refined, or was wrong.**

### Defect 1 (primary) — the keyword-prefix boundary bug. CONFIRMED by PA reproduction.

Hypothesised locus: `compiler/src/codegen/emit-logic.ts:4538`, inside `_matchArmResultIsBlockBody` (a helper INTRODUCED by #447):

```js
if (/^(const|let|var|return|if|for|while|do|switch|lift|throw|fail|on\b)/.test(t)) return false;
```

The `\b` is INSIDE the alternation, so it guards only `on`. Any tail identifier merely PREFIXED by a keyword is misclassified as a statement head, the arm tail is never lifted, and the arm's result variable is never assigned.

**PA reproduction (do not take on trust — re-run it):** two arms differing ONLY by identifier name:
```
.Low  :> { const shade = "alpha"; shade }        →  _scrml_tilde_4 = shade;  →  "alpha"   ✓
.Low  :> { const formatted = "beta"; formatted } →  let _scrml_tilde_8 = formatted;  →  null ✗
```
The tail is lifted into a FRESH tilde var nobody reads, while the arm's real result var is never assigned.

Hit set is common and includes: `formatted`, `format*`, `formData`, `doc`, `document`, `domNode`, `doubled`, `done`, `letter`, `constant`, `varName`, `returnValue`, `ifCount`, `iface`, `switchState`, `lifted`, `throwaway`, `failCount`, `whileLoop`.

**Severity — this is a REGRESSION, loud→silent.** `gh pr diff 447` shows the helper and this regex are `+` lines, so pre-#447 the form failed the compile with a loud error. Post-#447 it compiles clean and yields a wrong value at runtime.

**Candidate fix (verify, do not assume):** move the `\b` OUTSIDE the group — `/^(const|let|var|return|if|for|while|do|switch|lift|throw|fail|on)\b/`. Reason through the backtracking yourself and confirm `onClick` still does NOT match (that is why the original author added `\b` to `on` at all) while `on foo` still does.

### Defect 2 (secondary, same helper region) — empty block arm yields `{}` instead of void.

Hypothesised loci: the guard at `emit-logic.ts:4518` and the dead handler at `:4561`.

`{ }` parses as an empty OBJECT LITERAL (`node.kind === "object"`), so `_matchArmResultIsBlockBody` returns `false` and the verbatim path emits `_scrml_tilde_N = { };`. SPEC §18.5 says an arm with no trailing expression produces **void**. Consequence: `const r = match k { 1 :> { } _ :> "gray" }` yields `r === {}` — a DEFINED, truthy value, so an adopter's absence check never fires (`{}` is not `not`; see §42.1.1).

Meanwhile line ~4561 — `if (!inner) return "// §18.5 empty block arm — result is void"` — appears to be UNREACHABLE, fenced off by the 4518 guard. The author wrote the void handling and blocked it. Verify this before changing anything.

## MANDATORY GATES

1. **Governing-sentence gate (pa-base §1 Rule 4).** Both defects change what a program MEANS. Before fixing, read SPEC §18.5 **IN FULL** via `offset:`/`limit:` and QUOTE the governing sentence in your report — or record explicitly "searched §18.5, §18.0.1, §18.7 — no governing sentence found." A remembered rule or a primer is NOT a governing sentence.
2. **Direction-of-change (pa-base §8).** Classify each fix: inert / newly-rejecting / newly-accepting / semantics-changed. Both are likely **semantics-changed toward the contract** (conformance restoration) — but you must produce the sentence that makes it restoration rather than a widening.
3. **Measured migration for Defect 2.** Before changing empty-arm behaviour, GREP THE CORPUS for empty block arms (`samples/`, `examples/`, `conformance/cases/`, `stdlib/`) and REPORT THE COUNT AND FILES. Assumed-zero is not measured-zero. If the count is non-zero, STOP and report rather than migrating unilaterally.
4. **Conformance cases are a MERGE-BLOCKER for a claimed surface.** Add cases under `conformance/` pinning BOTH defects. For Defect 1 the case MUST use a keyword-prefixed identifier (`formatted`, `doc`, …) — #447's own two new cases used `base`/`b`, which DODGE this bug, and that is precisely why it shipped. Run `bun conformance/run.ts`.
5. **Empirical verification (R26) — not "tests pass".** After the fix, recompile real sources and inspect EMITTED OUTPUT, and where behaviour matters EXECUTE it (this repo has repeatedly shipped code that emits a correct-looking marker and throws at load). Compile command: `bun compiler/bin/scrml.js compile <src> --output-dir <tmp>`. Real corpus: `samples/compilation-tests/`, `examples/`, and `scrml-support/docs/gauntlets/gauntlet-r25/dev-*.scrml`. **Do NOT mark done without an empirical pass showing the symptom is gone AND no adjacent shape broke.**
6. Full local suite: `bun run test` (chains `pretest`, which populates the gitignored browser fixtures — `bun test` alone yields ~130 false failures).

## SCOPE FENCE

Touch `compiler/src/codegen/emit-logic.ts` and its tests/conformance cases. **Do NOT touch `compiler/src/codegen/emit-each.ts`** — a sibling agent is working there right now. If you believe the correct fix requires a file outside emit-logic.ts + tests, STOP and report rather than widening.

## REPORT BACK

Worktree path · final commit SHA · files touched · the quoted governing sentence (or recorded search) · direction-of-change per defect · the Defect-2 corpus count with file list · whether each PA-asserted locus held/refined/was-wrong · empirical evidence (emitted-output before/after, executed where relevant) · suite + conformance results · anything you could NOT close. Commit after every meaningful unit; a clean `git status` before you report DONE is mandatory.
