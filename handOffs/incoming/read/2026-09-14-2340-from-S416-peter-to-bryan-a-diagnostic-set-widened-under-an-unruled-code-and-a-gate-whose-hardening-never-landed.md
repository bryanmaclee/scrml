# S416 (peter) → bryan — one language-surface review owed, and one gate finding you should see

**Date:** 2026-09-14 · **From:** S416, peter, P-Tech1 Windows clone · **Base:** scrml `main` @ `dd6c6ff2`

Five PRs landed this session, all gate-green: **#955** (review floor 4→0), **#956** (a compiler fix),
**#957 / #958 / #959** (three instrument arcs). Only one of them touches your surface. The rest is
here because it changes what a gate you rely on is actually worth.

---

## 1. OWED TO YOU — #956 widened a diagnostic's enforcement set, and the diagnostic itself is unruled

**`E-CONDITION-HEAD-UNPARENTHESIZED` (#945) is still OUTSTANDING with you.** #956 widened the set that
decides when it fires, which is newly-rejecting, so it owes a language-surface review — and it is
built on ground you have not ruled. **If you rule the diagnostic away, this widening goes with it.**
That is a cheap loss (five set members) and I would rather it be visible than discovered.

**The defect.** `continuesConditionHead` tests **exact token-TEXT equality** against a 14-member set,
and the lexer merges an angle run into ONE token. So `>>` `>>>` `<<` `>>=` `<<=` each arrive as a
single token equal to none of the set's four angle members. Measured on `f98510f8`, library mode, in a
**non-exported** fn:

```
while (n + 1) <  2 { t = t + 1 }   E-CONDITION-HEAD-UNPARENTHESIZED, build fails
while (n + 1) >> 2 { t = t + 1 }   exit 0, ZERO diagnostics, emitting
                                       while (n + 1) {
                                       }
```

Body dropped, loop non-terminating — **the exact symptom #945 is named after, surviving its own fix.**
Third instance of the lexer-merge class.

**Why I widened a set whose banner says not to.** The banner opens *"DELIBERATELY CONSERVATIVE — do NOT
widen this set."* Every name it excludes is excluded for **one** reason: the token can also **begin a
braceless body** (`/` a regex literal, `+`/`-` a unary prefix, `.`/`(`/`[` a statement start, `:` a
label, `is` an identifier). The five added spellings are **strictly binary infix** — no statement can
start with one — so they do not touch that rationale. I wrote that test into the banner explicitly so
a future widening has to pass it rather than resemble something already present, and the new test file
re-asserts the three load-bearing exclusions so a later cut cannot widen by category.

**Evidence.** Red-before-green 10 → 0, with every control and exclusion case passing in **both**
states. Seven sibling suites on this parser path: 137/0. Population **0 of 2,553** tracked `.scrml`
under a deliberately over-broad pattern whose single-char control returned 6 hits (all benign). Corpus
emit-differential over 1,928 sources / 7,467 artifacts: **0 newly failing, 0 newly passing, 0
diagnostic-CODE changes, 0 artifact content diffs.**

⚠ **Scope, stated because the board was overstating it.** The fix reaches a **non-exported** fn only.
In an exported body the `export` re-parse swallows ast-builder parse-path diagnostics, so **every**
spelling — including the single-char controls `<` `<=` `>` `>=`, which were never part of this gap —
still compiles at exit 0 and still ships `while (n + 1) { }`. That is
`g-export-reparse-swallows-ast-builder-parse-path-diagnostics` (HIGH, yours, a 22-file migration), not
this set's bug. The PICKUP that nominated the item sold it as closing a live silent infinite loop; that
is true only off the export path, and the ledger now says so.

**Nothing else of yours was touched.** The `E-ASSIGN-003` family, §49.2.1 braceless loop bodies, the
bare-block drop, the export-reparse migration, the must-use mis-citation, your three #936 findings,
`g-library-shadowed-inner-binding`, and the §59 library-mode lowering widening are all **untouched and
still routed to you**.

⚑ One addition to the `E-ASSIGN-003` routing, found while re-measuring it rather than taking #949's
word: the claim is **understated**. Beyond the three loci the routing note cites (`:20059` §34 row,
`:27867` the §50.9 SHALL, `:28008` §50.8.4), **two further normative loci also carry it** — `:28048`,
a second SHALL in the §50.8 rule list, and `:28187`, a second catalog row. The SPEC side of the
contradiction is broader than you were told.

---

## 2. FOR YOUR AWARENESS — the landing gate's hardening never reached `main`

This is not a request; it is a fact about evidence you and I both cite in PRs.

`scripts/corpus-emit-differential.ts` is the standing pre-land gate for codegen changes. Measured by
symbol count against `origin/worktree-agent-ab7336c5da32f10ed`:

| | `main` | branch |
|---|---|---|
| HARD REQ | 2, 3, 4, 5, 7 | 2, 3, 4, 5, 7, **8, 9, 9.1, 10, 11** |
| LOC | 1,549 | 2,802 |
| `reverify` / `FLAKE_DEMOTION_RULE` | **0** | 63 |
| `corpusCleanliness` | **0** | 15 |

So `main`'s gate **cannot** tell you an enumerated source was untracked (HARD REQ 11) or modified (F2)
between captures, **cannot** check the chunk-namespace anchor (HARD REQ 8), and has **no
re-verification layer at all** — the layer whose rule, written on that branch, is *"a difference that
does not reproduce is an `errored`, NOT a flake; discarding one requires an AFFIRMATIVE POSITIVE
SIGNAL."*

The branch is **415 commits behind** with **11 commits** not in `main`, so it is a **port, not a
merge**, and I did not attempt it — filed as `g-emit-differential-hardening-never-reached-main` (MED).
Three existing gap entries were filed against that absent machinery as though it were live, and a
fourth asserted its test rig had landed; all four are corrected in place. I recovered and landed the
rig restricted to the **7 cases main actually implements**.

⚑ This is one measured instance of your standing *"96 agent branches carry work that never reached
main"* observation — and the most consequential kind, because the unmerged work is a **gate**.

---

## 3. NO ACTION NEEDED — the rest, in one line each

- **#958** — the e2e render tier *detected* the board-bug class (`S-EMPTY-WITH-DATA`) and classified it
  GREEN; now split into a red state. Ceiling finding: **no CI job runs that tier at all.**
- **#959** — the five `@marker` parsers got an import-and-pin harness in the **blocking** gate, proven
  by mutation. **Nothing widened**: live miss count measured zero, and widening `flograph` would admit
  documentation templates as real graph nodes.

## Collision note

Your **#951 is a wrap PR** and will touch `hand-off.md`, `docs/changelog.md` and
`handOffs/delta-log.md` — the same three files as this wrap. `strict:true` forces the second to
rebase; **resolve by UNION** (all three append-only) and re-run `bun scripts/delta-lint.ts --fix` if
the sequence collides.
