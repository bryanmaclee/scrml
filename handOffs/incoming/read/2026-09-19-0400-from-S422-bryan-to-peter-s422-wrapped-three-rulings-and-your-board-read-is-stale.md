---
from: S422-bryan (ASUS-Vivobook)
to: peter
date: 2026-09-19
subject: "S422 is WRAPPED — you are clear to take the wrap. Three rulings landed that change what the S418/S422 ruling builds ARE, and your boot read predates them."
needs: fyi
status: unread
---

# S422 wrapped — and your board read is stale in three places that matter

You registered S423 as SUCCESSOR to a live S422 and deferred the wrap to me. **I have wrapped. The
wrap is yours from here, and my footprint is released.**

Your boot read was taken before my last several commits, so three things on your board are out of date.

## 1. dpa-047 and dpa-048 are NOT UNRUN — they DRAINED

Your board says *"dPA: 2 UNRUN (dpa-047, dpa-048 — bryan fires)"*. bryan fired them; both are now
**COMPLETE (ADVISORY)** with artifacts in `scrml-support/docs/deep-dives/`. **dpa-049 is the UNRUN one**
and it is new — *should a project-wide lint suppression taint the build?* — banked S422, unruled.

Current: **1 UNRUN · 10 ADVISORY.**

## 2. ⚑ THREE RULINGS LANDED, and they change what the ruling builds ARE

You listed the S418/S422 ruling builds as my footprint to stay off. Correct — but the builds are not
what your read describes:

- **`E-ASSIGN-003` is NARROWED to expression position, not built as S418 ruled it.** S418 ruling 1 was
  a widening past its own governing sentence: §50.8.4's trigger says *"assignment expression"*, §50.1
  scopes §50 to expression position, and §50 extended ONE code to statement form and pointedly not its
  sibling.
- **`E-ASSIGN-004` is BUILT at statement position** — it had ZERO producers, so `const x = 1; x = 2`
  compiled at exit 0 and shipped a guaranteed runtime `TypeError`.
- **Bare naming IS `const`; mutation needs `let`.** Ruled. That closes the tilde-decl semantic question
  your `phase3-wrapup.test.js:12` comment has recorded as *"needs spec ruling"* since S19.
- **Unused-binding is a LINT across all binding forms** — ruled, NOT built. `_` token granted, hard
  error as the declared destination, and the sequencing is deliberate: **ship the lint first and let its
  own false positives find the nested-container walker bugs.** Do not fix the walker first.

All four are in `user-voice-scrml.md` S422 with the measured matrices.

## 3. ⚑ THE ONE THING NOT TO BUILD ON TOP OF BLIND

**`E-ASSIGN-004`'s remedy misfires at top-level `${}`.** It tells the author *"Use `let`"*, and there:

```
let n = 1 ; n = n + 1   ->  E-CODEGEN-INVALID-LOGIC ("this is a compiler defect")
let n = 1 ; n++         ->  clean
<n> = 1 ; @n = @n + 1   ->  clean
```

**Only the `= expr` reassignment form is broken.** Pre-existing — verified byte-identical on unmodified
main. Root traced: `emit-reactive-wiring.ts:358` builds the top-level `emitOpts` with no `declaredNames`,
so `emit-logic.ts:2097`'s reassignment guard is dead there. Siblings at `:1361`, `:1852`,
`emit-library.ts:2097/:2109`. Filed HIGH.

An earlier framing of this as *"there is no valid way to express mutable top-level logic"* was **wrong**
— three forms work. Do not carry that claim forward.

## Also worth knowing

- **Review floor drained 23 → 0** at #988 (4 findings, 19 carve-outs, **0 clean**). Two findings convict
  merged work: **#983's `.sort()` is inert** (`bun test` ignores argv order — reproduced both ways), and
  **#979 shipped a third truncation** while fixing one.
- **Maps refreshed** `e74f5423` → `787d4cb4` after four stale sessions. ⚑ `e74f5423` is a commit whose
  `SPEC-INDEX.md` carried **three raw git conflict markers** — every map was stamped there.
- **flogence aggregated our gap ledger:** 28 open gaps are one bug in four costumes (13 string-masking ·
  8 interpolation · 6 comment-state · 1 angle-bracket). One shared masking pass is pointed at 27 of 28.
- ⚑ **Your clone has pre-commit REMOVED.** Mine caught a real `let`-rebinding false positive in the
  `E-ASSIGN-004` build that 41 passing unit tests had missed. Worth re-installing before you touch
  compiler source.

## Untouched and owed, so you can take it if you want it

The **two scrml-site reports** have sat `needs: action` since August — soft-nav dropping the destination
page's stylesheet, and the owed `<outlet/>` repro. I prioritised around them every turn of this session
and never got to them. Oldest unactioned inbound work on the board.

— S422-bryan, wrapped
