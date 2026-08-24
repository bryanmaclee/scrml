# BRIEF (archived verbatim at dispatch — 2026-08-24)

Dispatch: JS Codegen Engineer · isolation: worktree · base `origin/main` @ `cb5db9c9`
Worktree: `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-ae080f493c841f360`

---

## CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE (FIRST, before any edit)

1. `pwd` MUST start with `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-`. If not, STOP and report.
2. `git rev-parse --show-toplevel` MUST equal that path. `git status` MUST be clean.
3. Your base is `origin/main` @ `cb5db9c9`. Confirm `git merge-base HEAD origin/main` == `origin/main`.
4. `bun install` (fresh worktrees do NOT inherit node_modules — the hook fails "cannot find package 'acorn'").
5. `bun run pretest` (populates gitignored `samples/compilation-tests/dist/`). Use `bun run test`, NEVER bare `bun test`.
6. ABSOLUTE worktree-rooted paths on every edit. NEVER `cd` into `/home/bryan-maclee/scrmlMaster/scrml`. Use `git -C "$WORKTREE_ROOT"` / `bun --cwd "$WORKTREE_ROOT"`.

## ⚑ COMMIT DISCIPLINE — read this, a predecessor lost its work here

The previous agent on a sibling task stalled with a COMPLETE fix and 170 test lines **uncommitted**, its branch holding only the startup marker. **Commit after EACH meaningful unit, starting with your first.** First commit: `WIP(each-alias): start at $(pwd)`. Your branch is the only crash anchor; an uncommitted worktree that dies loses everything.

**⚑ Do NOT `git stash`.** A prior session on this repo destroyed real work with a mid-flight stash. If you need a before/after comparison, COMMIT first, then `git checkout HEAD~1 -- <file>` to step back and `git checkout <your-sha> -- <file>` to restore.

## ⚑ SIBLING DISPATCH LIVE — write-set constraint

Another agent is concurrently editing `compiler/src/type-system.ts`, `compiler/SPEC.md`, `conformance/`, and `compiler/tests/unit/multi-scrutinee-match-ss43.test.js`. **Do NOT edit any of those, and do NOT edit `compiler/src/ast-builder.js`.** If your fix genuinely requires one, **STOP and report** — do not edit it. Everything else is yours.

# The bug: `<each ... as NAME>` inside a `fn` body never binds NAME → ReferenceError kills the whole client bundle

Create `docs/changes/each-as-alias-in-fn-body-2026-08-24/` and keep `progress.md` there.
DONE-PROBE: repro (A) below executes in happy-dom with ZERO errors and renders both rows.
Gap: `g-each-as-alias-unbound-in-fn-body` (HIGH) — read its entry in `docs/known-gaps.md`.

## PA-VERIFIED BY EXECUTION on `cb5db9c9`. Reproduce all four BEFORE reading code.

**(A) BROKEN — `fn` body + `as` alias:**

    <program>
    <rows> = ["a", "b"]
    ${
        fn listing() {
            return <ul>
                <each in=@rows as it key=it>
                    <li>${it}</li>
                </each>
            </ul>
        }
    }
    <div>${listing()}</div>
    </program>

Compiles exit 0, ZERO diagnostics. Executed: **`ReferenceError: it is not defined`** at bundle eval; body renders `<div><span data-scrml-logic="_scrml_logic_1"></span></div>` — list absent, and everything after the throw is dead.

**(B) WORKS** — same fn body, drop `as it key=it` and use `${@.}` → renders `<li>a</li><li>b</li>`.
**(C) WORKS** — same `as it` alias but the `<each>` at TOP LEVEL (not in a fn) → renders.
**(D) WORKS** — top level + a markup-returning fn → mounts as `<li><span data-scrml-mv=""><span class="b">a</span></span></li>`.

**Trigger is exactly: the `as NAME` alias, inside a `fn` body.** NOT nesting — a plain single `fn` reproduces it. B/C/D are your non-regression controls and MUST still pass.

## The emitted difference — your verified entry point

TOP-LEVEL (correct) — the alias BECOMES the parameter and is rebound per item:

    (it, _scrml_each_idx) => it,
    (it, _scrml_each_idx) => { ... let it = _scrml_resolve_item(_mount, _scrml_each_key_1); ... }

INSIDE A FN BODY (broken) — params are the GENERIC name while the body still references the alias:

    (_scrml_each_item, _scrml_each_idx) => it,
    (_scrml_each_item, _scrml_each_idx) => { ... let _scrml_each_item = _scrml_resolve_item(...);
                                             ... String(badge ( it )); }

Grep the emitted artifact for the alias: it occurs ONLY as a USE, never a declaration.

## Locus — PA-LOCATED, VERIFY. Report held / refined / wrong.

Located by reading EMITTED OUTPUT, not by tracing source. Hypothesis: the fn-body `<each>` is emitted through a path that skips lowering the top-level path runs. Evidence it is broader than the alias: the callee comes out as bare `badge` instead of the registered `_scrml_badge_1`, and a markup-returning fn is `String(...)`-ified rather than mounted.

Start at `compiler/src/codegen/emit-each.ts` and trace which pass handles an `<each>` reached from inside a fn body vs from top-level markup. A prior session instrumented `emit-each.ts:1406` and found `_eachMarkupFnNames` NULL there because "that pass runs outside the emit-each :3555/:3690 set/clear window" — a HYPOTHESIS about a sibling symptom, not established fact for the alias. Verify before relying on it.

## Scope

**Fix the alias binding — that is the crash and the required outcome.** If the same root also fixes the bare-callee / `String(...)` markup-mount symptom, take it and say so (tracked as `g-each-nested-in-fn-body-markup-fn-stringifies`). If it does not, do NOT force it — a correct narrow fix beats a speculative wide one; report what you learned.

## Owed with the fix

1. **A merge-blocker test, BITE-PROVEN** (fails before, passes after — show both). It MUST EXECUTE the bundle in happy-dom, not inspect emitted text: this repo's most-repeated lesson is "emitted ≠ runs". Follow `compiler/tests/browser/browser-conditionals.test.js` (`GlobalRegistrator` + `SCRML_RUNTIME` + eval + `DOMContentLoaded`). ⚑ Put your test in a NEW file — do not edit existing shared test files a sibling may hold.
2. **Non-regression coverage for B, C and D.**
3. **A MEASURED corpus count** — how many `.scrml` across `samples/ examples/ stdlib/ benchmarks/ conformance/` have an `<each ... as NAME>` inside a `fn` body. Report the number AND the files. Assumed-zero is not measured-zero; and note corpus-zero bounds BLAST RADIUS only, it is not evidence the shape is unwritten.
4. **`bun scripts/corpus-emit-differential.ts`** — you are touching an emit path, so capture base @ `cb5db9c9` and head, diff, and report the verdict. Usage in the script header. Expect and explain any artifact diffs.
5. Full `bun run test` as a SET-DIFF against your own base measurement (known baseline ~53 fails: self-host ×3 / self-compilation / session / browser tier), never a raw count.

## Direction-of-change — state it explicitly

Making previously-crashing code work is **newly-accepting at runtime**. Justify it as a conformance RESTORATION by quoting the governing sentence that already makes `<each ... as name>` legal (SPEC §17.7; PRIMER §6.3 lists `as name` among the four canonical shapes). If you cannot find such a sentence, say so — that outcome converts this into a ruling and you should stop and report rather than proceed.

## MAPS — REQUIRED FIRST READ

Read `.claude/maps/primary.map.md` FIRST, then follow its "Task-Shape Routing" to the maps for this shape (expect `domain.map.md` + `structure.map.md`). Map watermark: commit `728bdc92`; your base `cb5db9c9`. The only `compiler/src` change since the watermark is a COMMENT-ONLY edit to `emit-each.ts`, so the maps are current for your surface. Treat map content as a verify-against-source hypothesis, and report whether they were load-bearing — "not load-bearing" is a useful answer.

## Reporting

Never `--no-verify`; never override `core.hooksPath`. Clean `git status` before DONE. Report: worktree path, final commit SHA, files touched, locus verdict (held/refined/wrong), measured corpus count, differential verdict, and anything deferred.
