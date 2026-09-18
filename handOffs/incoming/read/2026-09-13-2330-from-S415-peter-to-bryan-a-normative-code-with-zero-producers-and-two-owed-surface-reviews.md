---
from: S415-peter
to: bryan
date: 2026-09-13
subject: E-ASSIGN-003 is normative, fully specified, and has zero producers — plus two owed language-surface reviews
needs: ruling
status: unread
---

# One ruling, two owed reviews, one unchanged routing

Everything below is PA-verified by execution or by a controlled grep. Nothing here is relayed.

---

## 1. ⚑ THE RULING — `E-ASSIGN-003` is specified in a SHALL and has no producer

**Gap:** `g-e-assign-003-has-zero-producers-so-a-write-to-an-undeclared-name-runs-silently` (HIGH).

The governing sentence, quoted whole (`compiler/SPEC.md:27867`, §50.9):

> *"Assignment-as-expression does not introduce new scope. It assigns to the lvalue's existing
> binding. The lvalue SHALL be declared (via `let`, `const`, `lin`, `@`, or function parameter)
> before it is used as an assignment-expression target. Using an undeclared identifier on the
> left-hand side of an assignment expression is E-ASSIGN-003."*

It is fully specified: a §34 catalog row (`:20059`) and a dedicated **§50.8.4** subsection (`:28008`)
carrying the exact message text. **`grep -rl 'E-ASSIGN-003'` over `compiler/src/` +
`compiler/native-parser/` returns 0 files.** Reach controls fire: `W-ASSIGN-001` = 1 file,
`E-SCOPE-001` = 22. The whole `E-ASSIGN-00x` family measures 0 — pre-existing and family-wide.

**Why it needs you rather than a patch.** The emitter's actual behaviour — a write to a name with no
binding in scope emits a fresh `const` and runs — is documented **only in a code comment**
(`emit-logic.ts` ~:2071–2079). SPEC says the opposite, in a SHALL. So the question is not "is this a
bug"; it is **which of the two is the language.**

⚑ **And it is now load-bearing, because #947's tests pin the non-conformant side.**
`compiler/tests/unit/declared-names-block-scope.test.js` asserts `expect(mod.render(["a","b"]))
.toBe("abQ")` across four tests — pinning *runs silently* as correct for four programs whose
SPEC-correct outcome is a diagnostic. The #947 fix itself is right (each block body getting its own
copy is exactly the scoping `let` has); what is unratified is the **acceptance** it leaves behind.

This is the root under a whole family already on the board —
`g-try-catch-finally-bodies-redeclare-every-assignment` (HIGH),
`g-match-arm-bodies-share-one-declarednames-set…` (MED),
`g-loop-head-binding-is-not-tracked…` (MED). **I have deliberately not fixed any of them by threading
the Set in**, because every one is really this same question.

**Same shape as `E-TILDE-001/002`** — dead for the project's whole life behind passing unit tests
until you ruled at S409, whose own highest-leverage recommendation was a `-neg` gate requiring every
Error code to have a conformance case that actually produces it.

**Two directions, both yours:** make the compiler fire `E-ASSIGN-003` (newly-rejecting over an
unmeasured population), or strike the SPEC text (a language change). I have built neither.

---

## 2. OWED — language-surface review on a false rejection I knowingly shipped (#952)

`g-library-shadowed-inner-binding-is-a-false-rejection` (MED). A map name re-bound by an inner arrow
parameter now makes the library guard refuse a program that previously ran:

```scrml
export fn probe(xs) { let m = ["k": 7]; return xs.map((m) => m.size) }
```

returned `[3]` at `9eb9eb24`; it is refused after #952. The byte scan keys on a NAME and cannot see
that the arrow parameter shadows it.

**The trade, stated so you can overrule it:** dropping a name from the receiver set whenever it is
re-bound anywhere in the fn would **un-guard a real top-level `m.size` in that same fn** — trading a
rare false REJECTION for a rare silent WRONG ANSWER. `emit-library.ts` has already ruled that
direction (*"silent-wrong output … is strictly worse than the raw path's honest verbatim copy"*), so
I followed it. Closing it properly needs SCOPE, not text. **Landed with the stamp OUTSTANDING.**

---

## 3. OWED, carried from S414 — `E-CONDITION-HEAD-UNPARENTHESIZED` (#945)

Minting a diagnostic decides what the language refuses, so it owes a language-surface review. Landed
with the stamp outstanding, same mechanism as #924 / issue #922. Still open.

⚑ **And it has a measured hole you should know about before you stamp it:**
`g-condition-head-continuation-set-misses-every-merged-shift-run-token` (MED). The continuation check
is exact token-TEXT equality against a 14-member set, and the lexer merges angle runs into ONE token,
so `>>` `>>>` `>>=` `<<` `<<=` escape it. `while (n + 1) >> 2 { … }` still compiles at exit 0, drops
the body, and is a **silent infinite loop** — the exact symptom #945 is named after. Third instance of
that lexer-merge class on this project.

Related, and also unruled from S413: the **§49.2.1 braceless loop body** fork, plus
`g-do-while-head-continuation-is-accepted-while-the-while-form-is-now-rejected` (LOW) — `do { … }
while (n) < 4` compiles and emits correct code while the `while` form is now an error, because that
site uses a different collector. Plausibly all one ruling.

---

## 4. UNCHANGED ROUTING — the real §59 library-mode fix is still yours

`#952` restored the **fail-closed guard** so the unlowered §59 surface refuses loudly instead of
shipping `undefined`. It did **not** make library mode lower the surface. That widening is the real
fix and `containsIndexExpr`'s own comment routes it to you verbatim — *"a language question about what
boundary a library module is — not a codegen one, and not decided here."* I left it routed.

Still open beneath it: `.size` on an alias / peer-call / parameter receiver ships `undefined`
(pre-existing, needs the receiver's TYPE), and an aliased bracket read inside a `match` arm escapes
both guard limbs.

---

Two earlier drops from me are still unread in this inbox — S412's (stdlib source-mirror correction +
the self-host coverage hole) and S413's (the §49.2.1 fork + three findings on your #936). Both still
stand.
