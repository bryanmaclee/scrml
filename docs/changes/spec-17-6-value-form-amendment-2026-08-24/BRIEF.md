# BRIEF — §17.6 amendment: name the value-form, admit the lift-less branch, settle no-`else`

change-id: spec-17-6-value-form-amendment-2026-08-24
authored: S371-bryan, 2026-08-24 (Tier-2 prep — NOT yet dispatched)
ruling: user-voice-scrml.md S371, bryan verbatim: "value-form b"
gaps: g-value-form-control-flow-unspecified (RULED) + g-value-form-if-no-else-renders-nothing
DONE-PROBE: grep -q 'value-form' compiler/SPEC.md
<!-- ⚑ S378: the previous DONE-PROBE was PROSE — `grep -c "value-form" compiler/SPEC.md returns > 0
     AND the three repros ...` — and scripts/threads.ts EXECUTES this line as shell. The shell read
     `> 0` as a REDIRECT and wrote a file literally named `0` into the repo root on EVERY boot,
     containing grep's output. That stray `./0` was mis-diagnosed at S375 as a random artifact and
     `git add -A` swept it into a pushed PR. This is the FOURTH prose DONE-PROBE (S376 repaired
     three) and the first one found to have a SIDE EFFECT rather than merely failing to evaluate.
     Replaced with the runnable assertion the arc actually makes: the amendment is done when
     `value-form` has a normative name in SPEC.md (0 occurrences today, so this reads OPEN — which
     is correct, and now for a real reason). The three repros stay prose BELOW, out of the probe. -->

## The ruling

bryan ruled **limb (b)**: the compiler is right and SPEC is under-written. Amend §17.6 (or add a
section) to **admit a lift-less single-expression branch as sugar for `lift`**, and **give
`value-form` a normative name**. Both halves ratified (a terse ratification adopts the full
surfaced text — S276/S130).

Limb (a) — reject the bare-branch form — is CLOSED: it bills the ADOPTER (S354: cost is acceptable
in developing the language, not as cost to the adopter) and would break the shape #670/#672/#673
just fixed.

## THREE measured divergences. All PA-EXECUTED. The amendment must settle all three.

### 1. The lift-less bare-expression branch (the ruled one)

    <p>${ if @isAdmin { "Admin" } else { "User" } }</p>

emits `(_scrml_cs_reactive_get("isAdmin") ? "Admin" : "User")` — the bare expression IS the value.

SPEC says otherwise, in two places:
- `SPEC.md:11850` §17.6.1 grammar: `arm-body ::= '{' statement* lift-stmt statement* '}'` — a
  `lift` is REQUIRED.
- `SPEC.md:11884` §17.6.2 normative: "An arm body that does not contain a `lift` statement MAY
  exist; **its contribution to the result type is `not`**."

⚑ `:11884` is the load-bearing sentence. Amending the grammar without reconciling it leaves the
contradiction standing — the sentence would still say the compiler's behaviour is wrong.

### 2. "value-form" has NO normative name

`grep -c "value-form" compiler/SPEC.md` → **0**. Against ~30 in `docs/known-gaps.md`, ~10 compiler
source files, and three merged PRs (#670/#672/#673) built on it. The operator asked what it meant
and could not be answered from the spec — that is how this was found.

The implementation's actual rule (`compiler/src/codegen/emit-html.ts:645-670`,
`isValueFormControlFlowStmt` / `isValueFormIfStmt` / `isSoleBareExprBranch`): an `if` or `match` in
a `${…}` interpolation where **every branch is exactly ONE `bare-expr`**, `else` required on every
path; `match` qualifies when every arm is `match-arm-inline`.

### 3. No-`else` renders NOTHING — silent-wrong (found while scoping this brief)

    <shown> = true
    <p>${ if @shown { "YES" } }</p>

→ exit 0, ZERO diagnostics, emits a dangling no-op statement `"YES";`, renders `<p><span
data-scrml-logic="_scrml_logic_1"></span></p>` — EMPTY.

SPEC §17.6.4 (`:11930-11935`) explicitly blesses this form: "If-as-expression without `else` is
valid and useful … It is NOT required to provide an `else` arm to make the expression valid", plus
"An if-as-expression without an `else` arm SHALL have an implicit false-path type of `not`" and
"The compiler SHALL NOT emit an error or warning for a missing `else` arm."

So the compiler neither renders it NOR refuses it. Root: `isValueFormIfStmt` returns false with no
`node.alternate` ("value-form requires an else"), an artifact of the ternary lowering needing two
arms. §17.6.4 already supplies the answer — the false path is `not`, which renders as nothing:
`(cond ? value : "")`.

## What the amendment owes

1. A **normative NAME** for the shape, used consistently in SPEC, the ledger, and source.
2. **Grammar** admitting a branch that is exactly one bare expression, as sugar for `lift`.
3. **Reconciliation of `:11884`** — do not leave it contradicting the implementation.
4. **The no-`else` case settled** per §17.6.4's own `T | not` answer.
5. A Rule 4b `provenance:` line citing this ruling: `provenance: ruling:user-voice-scrml.md S371 "value-form b"`.
6. **Conformance cases pinning the sugar form, both halves** (codes + runtime) — the standing
   merge-blocker rule for a claimed surface. Include the no-`else` case.
7. Decide and state whether the `match` limb needs the same treatment: `isValueFormControlFlowStmt`
   also accepts an all-`match-arm-inline` `match-stmt`. The JS-style value-return `match` IS spec'd
   (§18.0.1 / PRIMER §6.2), so this limb may already be covered — VERIFY rather than assume, and
   record the search either way.

## Direction of change

Newly-accepting, but **toward the contract** once amended: the amendment IS the governing sentence,
so today's behaviour is reclassified as conformance rather than widening (pa-base §8's split —
produce the sentence and you have a fix). Item 3 additionally makes a currently-silent-wrong form
render, which is a correctness fix against §17.6.4 as already written.

## Governing-sentence search already performed (do not redo — extend if you doubt it)

Searched §17.6 all subsections, §17.4, §7.4, §40.8, plus a full-file grep for `value-form`
(0 hits). **No governing sentence admits the lift-less bare-expression branch.** That OUTCOME-2
result is what converted this from a fix into a ruling.

## Sequencing

⚑ Do NOT dispatch while a sibling holds `compiler/SPEC.md`. As of authoring, the match-arity agent
owns SPEC.md §34. Fire when it clears.

Peter-lane residual item 2 (value-form `match` inside `<each>`) is BLOCKED on this amendment —
building it first would extend an unspecified surface.
