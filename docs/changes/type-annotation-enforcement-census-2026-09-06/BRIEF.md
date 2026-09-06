Measure how much of scrml's type-annotation surface is ENFORCED versus DECORATIVE. Producer census by execution.

change-id: `type-annotation-enforcement-census-2026-09-06`

**This is a MEASUREMENT dispatch. Do not fix anything. The deliverable is a census, a method, and a committed probe.**

## WHY — this is the operator's own question, from his own twenty lines

bryan hand-wrote ~20 lines of scrml today. It is the FIRST scrml ever written by a human — the entire 2,400-file corpus is LLM-authored, so it has never exercised human writing patterns. In those 20 lines he hit this, PA-reproduced by execution at `f2338816`:

```scrml
fn bad(a: number, b: string) -> number {
   return a * b
}
log(bad("QQQ","x"))
```

**Compiles clean. ZERO diagnostics.** Emits `_scrml_bad_1("QQQ", "x")` and `return a * b`. A string is passed into `a: number`; the body multiplies a number by a string; the declared `-> number` is never reconciled with what the body returns.

His words: *"That was 100% of the sample of what I attempted with the type system, not confidence inspiring."* He is weighing whether the language is salvageable. **This measurement is an input to that judgment, so its honesty matters more than its optimism.** If the answer is "most of it is enforced and he hit the one hole", say that. If the answer is "the annotation surface is largely decorative", say that just as plainly.

## CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE (F4)

1. `pwd` MUST start with `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-`. If it is `/home/bryan-maclee/scrmlMaster/scrml` you are in the SHARED checkout — STOP.
2. `git rev-parse --show-toplevel` equals that root; `git status` clean; `git merge-base HEAD origin/main` == `origin/main`.
3. `bun install`. Then `bun run pretest` — run it PLAINLY from the worktree CWD. ⚑ `bun --cwd <path> run pretest` prints the script list and **exits 0 having done nothing**; verify `samples/compilation-tests/dist/` artifacts appeared.
4. `WORKTREE_ROOT="$(pwd)"`, echo it. First commit: `WIP(type-census): start at <that pwd>` **and write this entire prompt verbatim to `docs/changes/type-annotation-enforcement-census-2026-09-06/BRIEF.md`** (single-quoted heredoc).

Edit via Edit/Write on worktree-absolute paths only. NEVER `cd` into the shared checkout. ⚑ **NEVER `git stash`** — `refs/stash` is shared across worktrees here. ⚑ **NEVER a bare `pkill -f`/`killall`** — other agents are running suites and every checkout shares the command string. Commit incrementally; append to `progress.md`. **Another agent is live in a different worktree measuring the native-parser flip — do not touch `scripts/` harnesses it may be creating; keep your probe under your own change-dir or a distinctly-named script.**

## THE METHOD — by EXECUTION, never by reading

For every position where scrml admits a type annotation, construct a MINIMAL program that VIOLATES it, compile it, and record what fires. **Reading the type-system source to decide whether a check exists is exactly the wrong method** — this project has a documented history of diagnostics that exist, have consumers, are spec'd, and never fire:

- `E-TILDE-001/002` — four consumers, **ZERO producers**; SPEC's own verbatim INVALID examples at §32.5/§32.6/§32.7 all compiled at exit 0.
- `E-UNQUOTED-DISPLAY-TEXT` (§4.18.7) — PA-verified today: every occurrence in `compiler/src` is inside the message TEXT of a *different* diagnostic; the only real emission site is the opt-in native parser.
- `E-PROGRAM-002` — cited by its own docstring as existing; unimplemented, and two of three grep hits were that docstring's own comments.

So: **a code appearing in `§34`, in a `.ts` file, or in a test is NOT evidence it fires.** Only a compile that emits it is.

## THE SURFACE TO COVER

At minimum, one violating probe per position. Add any I have missed and say so:

1. **`fn` parameter** — argument type vs declared param type at the call site (bryan's case).
2. **`fn` body vs parameter types** — `a * b` where `a: number, b: string`.
3. **`fn` declared return type** vs what the body actually returns.
4. **`function` parameters** — same three axes; `function` and `fn` are different declaration forms (§48/§33) and may differ.
5. **State-decl annotation** — `<x>: int = "not an int"`.
6. **`let` / `const` local annotation** — `let x: number = "s"`.
7. **Struct field** — constructing `type T:struct = { n: number }` with `{ n: "s" }`.
8. **Enum variant payload** — `Variant(msg: string)` constructed with a number.
9. **Refinement type** (§53) — `string(pattern(...))` given a non-conforming literal; note the three-zone model, and whether the *boundary* zone behaves differently from the trusted zone.
10. **Lifecycle** `(not to T)` (§14.12) — a pre-transition read; `E-TYPE-001` is specified for exactly this.
11. **Schema column** (§39) vs an inserted value.
12. **Map type** `[K: V]` (§59) — wrong key or value type.
13. **`snippet(name: string)`** (§14.9) — wrong lambda arity/type at the call site.
14. ⚑ **`asIs`** — the NAMED escape hatch (§14.7). Establish what it legitimately excuses, so a decorative-looking result that is actually `asIs` working as designed is not miscounted as a hole. `W-TYPE-031-UNPROVEN` is the related "inference stopped" signal — record where it fires, because an UNPROVEN type is a third state between enforced and decorative.

## CLASSIFY EACH POSITION

- **ENFORCED** — a violation produces an error. Name the code.
- **WARNED** — produces a warning/info only. Name the code. State whether that is by design.
- **DECORATIVE** — violation compiles clean, zero diagnostics. **This is the headline class.**
- **NO-SPEC** — no diagnostic is specified for it. Different from decorative: the gap is in the SPEC, not the impl. Quote the section you searched.

For every DECORATIVE result, also state whether a code EXISTS in §34 for it. "A code is specified and does not fire" and "no code was ever specified" are different findings with different fixes, and conflating them will mislead the ruling.

## THE HEADLINE NUMBER

**What fraction of the annotation surface is enforced?** Give it as `enforced / warned / decorative / no-spec` out of the positions tested. Lead your report with it. bryan needs one number and a table, not a narrative.

## ⚑ COMMIT THE PROBE

Land the fixture set and a runner under your change-dir (or a distinctly-named `scripts/` file) so this is re-runnable and the number can be re-measured after any type-system work. A measurement that cannot be repeated becomes a stale quote in six weeks — this repo has been bitten by exactly that at least three times (`docs/FACTS.md` exists because of one).

## SCOPE — out

Do NOT fix any hole you find. Do NOT add diagnostics. Do NOT touch `compiler/native-parser/` (transition-FROZEN by ruling). File defects in your report; if you find a HIGH, say so prominently rather than burying it in a table row.

## REPORT BACK — under two pages

1. **The headline fraction**, then the per-position table.
2. The DECORATIVE rows, each with: the minimal violating program, the exact compile result, and whether a §34 code exists for it.
3. Anything in the `asIs` / `W-TYPE-031-UNPROVEN` band that explains away an apparent hole — I would rather the number be smaller and true.
4. Your read on whether bryan hit an isolated hole or a floor. Label it INFERRED.
5. Final branch + SHA + files touched.
6. Anything contradicting this brief.

Label every claim `verified by execution` / `verified by reading <file> at <symbol>` / `INFERRED — not measured`. Locate by SYMBOL, never a remembered line. No `--no-verify`; never override `core.hooksPath`.
