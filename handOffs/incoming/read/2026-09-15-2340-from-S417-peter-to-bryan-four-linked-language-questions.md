---
from: S417-peter
to: bryan
date: 2026-09-15
subject: Four LINKED language questions — a normative sentence is blocking a live hang, the tokenizer makes one operator unreachable, and a shipped example has not compiled since S236
needs: reply
status: unread
---

All four came out of the S417 review floor's S239 pass over the four code-bearing S416 landings.
**Nothing here was built.** Each is routed because it moves the language surface and the
governing-sentence gate either came back empty or came back pointing the other way.

They are presented as a SET because (1) and (2) are the same ruling, and (3) is the same class.

---

## 1. §34 says DO NOT WIDEN, and the live set is already wider

`g-spec-34-forbids-the-widening-the-continuation-set-already-has` (MED)

`compiler/SPEC.md:20218`, the `E-CONDITION-HEAD-UNPARENTHESIZED` catalog row, states verbatim:

> ⚑ **THE CONTINUATION SET IS DELIBERATELY CONSERVATIVE — DO NOT WIDEN IT.** The code fires only when
> the token immediately after the closing `)` is one of `<` `<=` `>` `>=` `==` `!=` `===` `!==` `&&`
> `||` `??` `*` `%` `?` — **all PUNCT, and that is the invariant.**

Fourteen members, plus an explicit prohibition. **The live set in `ast-builder.js` has nineteen** — #956
(S416, mine) added five merged shift runs. `compiler/SPEC.md` is **not in #956's file list**; the
justification went into `ast-builder.js`, `known-gaps.md` and the delta-log, all DERIVED.

Per R4 the normative source wins, so I do not think this is "the SPEC needs a refresh". It is a landed
change doing the thing the normative source forbids, with its reasoning recorded only where the
normative source is not. The **direction** is supported — §50.2.3 does mandate rejecting these heads,
I read and quoted it — it is the **enumeration** that is not.

**The question:** amend §34's enumeration (and the DO-NOT-WIDEN sentence, reconciling it with the
banner's actual test — *"can this token begin a braceless body?"*), or narrow the code back?

This rides #945, still outstanding. **If you rule the diagnostic away, #956's widening goes with it.**

---

## 2. `>>>=` still drops a loop body at exit 0 — and (1) is what blocks fixing it

`g-condition-head-set-still-misses-the-sixth-merged-run` (MED)

PA-reproduced on merged main, library mode, non-exported fn:

    while (n + 1) >>>= 2 { t = t + 1 }   exit 0, ZERO diagnostics, emits  while (n + 1) { }
    while (n + 1)  >>= 2 { t = t + 1 }   exit 1, E-CONDITION-HEAD-UNPARENTHESIZED   (control)

Body dropped, loop non-terminating. **This is verbatim the symptom the diagnostic is named after,
surviving its own fix a second time** — the fourth instance of the lexer-merge class, in the PR whose
banner declares it the third.

The tell is embarrassing and worth recording: `tokenizer.ts` MULTI_OPS lists `">>>=", "<<=", ">>="`
**adjacent on one line**. #956 took two of the three. The set was enumerated *from the reported symptom*
rather than from the tokenizer's own operator set — I wrote "fix the class" in the banner and did not do
it.

Migration population measured **0 of 2,553** tracked `.scrml` files, reach controls firing at 84 and 49.

**I did not fix it, and the reason is (1): adding the member IS the act §34 forbids.** One token, thirty
seconds, blocked on a sentence. It is pinned as a KNOWN ESCAPE by
`compiler/tests/unit/condition-head-angle-operator-coverage.test.js` (#965), which goes red the moment
you rule and someone closes it.

---

## 3. `>>>` is structurally unreachable in the tokenizer — the root of an already-filed gap

`g-multi-ops-first-match-shadows-the-longer-operator` (MED)

`tokenizer.ts` matches multi-char operators with a **first-match-wins** loop, under the comment
`// Multi-char operators (check longest first)`. There is no length sort — maximal munch is a property
of the **array's order**, maintained by hand, and nothing verified it.

Measured over all 35 members: **34 correctly ordered, exactly one violation.**

    ">>>" (index 32) is UNREACHABLE — ">>" (index 31) matches first

So `n >>> 2` never lexes as one token; it splits into `>>` + `>`.

⚑ **That is the root cause of `g-unsigned-right-shift-does-not-lower`** (LOW, open), which is filed
against `compiler/src/codegen` with its own locus field recording *"the precise lowering site was NOT
traced."* The codegen refusal is the downstream symptom. **PA-verified by execution:** swap the two
entries and `fn f(n: int) -> int { return n >>> 2 }` compiles at exit 0 emitting `return n >>> 2;`,
where on main it dies with `E-CODEGEN-INVALID-LOGIC`.

**I did not land the one-line reorder, because it is newly-accepting** — the one-way door — and that is
a bug fix only with a governing sentence. **Gate executed:** searched SPEC for the operator (**one** hit,
`:3636`, inside a *prohibition* list of compound-assignment forms, not a grant) and for "shift operator"
/ "bitwise" / "unsigned right" (**zero** hits).

**SPEC carries no shift-operator grammar at all.** That is the finding under the finding, and it is why
`g-unsigned-right-shift-does-not-lower` has never had anything to test against.

**The question:** is `>>>` in the language? If yes, the reorder is conformance restoration and §34 needs
a shift-operator grammar to point at. If no, the operator should be refused explicitly rather than by
an accident of array order.

---

## 4. NEW HIGH — a shipped example has not compiled since `E-ERROR-009` was minted

`g-examples-09-error-handling-does-not-compile` (HIGH)

`bun compiler/bin/scrml.js compile examples/09-error-handling.scrml` exits **1** with **four
`E-ERROR-009`** on `fail .SubmitFailed("message could not be queued")`. The diagnostic's own message:

> 'fail' in function 'submit' does not name a valid variant of the declared error type 'ContactError'.
> ... **Valid variants: EmptyName, EmptyEmail, InvalidEmail, SubmitFailed.**

It rejects the bare variant while listing that same variant as valid. Bare-variant inference is not
reaching `fail` position.

**This is not a recent regression.** The example is unchanged since `dd5331e2` (2026-06-22);
`E-ERROR-009` was minted later by `760e9f83 feat(s236)`. **The diagnostic broke a shipped example when
it landed and has been breaking it ever since** — invisible because the only tier that compiles the
examples corpus runs in **no CI job** (`g-e2e-render-map-tier-runs-in-no-ci-job-at-all`) *and* was
separately inert on every Windows clone until #964 this session. It surfaced the instant that tier went
live.

**The tension is genuine and I am not resolving it:**
- §14.10 grants bare-variant inference *"when the type at the LHS or parameter position is statically
  known."* A `fail` operand is literally **neither** — though the declared error type IS statically
  known, from the `!` signature.
- `:8214` says construction rules apply *"uniformly across every construction locus — `let` / `const` /
  state-cell initializers, `return`, and `fail` (§19.3)."*
- `:14498` requires only that the variant be **valid**, which it is.

So either the compiler should accept it (§14.10 extends to `fail`) or the example must be rewritten to
`ContactError.SubmitFailed`. **Those are different languages.** One of them also means auditing the rest
of the examples corpus for the same shape.

---

## What I did land, so you can see the blast radius

Three PRs, **all test-only, no compiler source touched**: **#963** (the differential gate had no test for
its primary verdict — and #956 cited that gate as its landing evidence), **#964** (the e2e-render-map
tier was a silent whole-tier no-op on Windows, reporting 12/0 while comparing nothing), **#965** (the two
drift pins referenced above).

⚑ **Four of your open PRs are older than this conversation** — #962 in particular supersedes #887 and
#899 and only you can merge it. #962 also claims delta-log `[3068]`–`[3072]`, which **this wrap also
took**; whichever merges second needs `bun scripts/delta-lint.ts --fix` and a UNION resolve on the three
append-only continuity files.

**Five of my outbound drops to you are now unread** (S412, S413, S415, S416, S417). I am not treating
that as a problem — flagging it in case the channel itself is the issue rather than the queue.
