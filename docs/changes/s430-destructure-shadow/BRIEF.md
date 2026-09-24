# BRIEF — s430-destructure-shadow (regression from #996; fix)
Read `docs/changes/s430-common/F4.md` FIRST and obey it.

## Defect (PA-REPRODUCED on 15e60e4b; found by the S430 adversarial review of #996)
```
${
    const a = 0
    function f(o) {
        let { a, b } = o
        a = a + b
        return a
    }
}
<program><p>hello</></>
```
main: exit 1, `E-ASSIGN-004: a … is declared const`. Pre-#996 baseline (45749bb1): exit 0, valid `let { a, b } = o; a = a + b;`.
Also fails: block-level `let { a } = o` inside an `if`; an outer BARE-named `a = 0` instead of `const`; loop binders
`for (let { name } of rows)` / `for (let [k, v] of pairs)`. Control: a non-destructured `let x` shadow compiles clean.
MIRROR false negative, same root: outer `let a`, inner `const { a } = o`, then `a = a + 1` → exit 0, runtime TypeError.

## Root cause (reviewer-traced, PA-confirmed by reading — still verify)
`compiler/src/type-system.ts` ~:11248, the let/const-decl destructure branch: `if (!scopeChain.lookup(bind)) scopeChain.bind(...)`.
`lookup` walks the WHOLE chain, so a destructured name shadowing an outer binding is never bound in the inner scope and the
later reassignment resolves to the outer entry. The guard predates #996; #996's `isConst` made it bite.
Governing: §50.9 "`let` is the only declaration form that produces a mutable binding" + ordinary block scoping (§7.3.1).

## Do
Fix the ROOT: a destructured declaration binds each name in the CURRENT scope (shadowing), exactly as the non-destructured
branch does — check how the plain `let x`/`const x` branch binds and mirror it. Tests for every shape above incl. the mirror FN
and nested/loop-binder cases; confirm E-ASSIGN-004 still fires for a destructured `const` reassigned. Corpus A/B by COMPILING
(examples, samples, stdlib, self-host, native-parser, docs/website) — report any exit-code change.
